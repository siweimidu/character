import type { AppSettings, AiRunUsage } from '../shared-types'
import { performAiRequest } from './http'
import { createProxyFetch } from '../proxy-fetch'
import { isGeminiNativeBaseUrl } from './model-urls'

/** 图片生成接口的返回结果 */
export type GeneratedImageResult = {
  dataUrl: string
  revisedPrompt?: string
  /** 部分图片模型（如 gpt-image-1）会返回 token 用量 */
  usage?: AiRunUsage
}

/** 将图片生成相关的配置项（imageModel、imageApiKey、imageBaseUrl）提取到通用字段中 */
function normalizeImageSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    model: settings.imageModel?.trim() || '',
    apiKey: settings.imageApiKey?.trim() || '',
    baseUrl: settings.imageBaseUrl?.trim() || ''
  }
}

/** 根据 base64 数据的头部特征推断图片 MIME 类型 */
function inferMimeType(base64: string): string {
  if (base64.startsWith('/9j/')) {
    return 'image/jpeg'
  }

  if (base64.startsWith('UklGR')) {
    return 'image/webp'
  }

  return 'image/png'
}

/** 判断错误是否为「provider 不支持 response_format 参数」，用于决定是否去掉该参数重试。 */
function isUnsupportedResponseFormatError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  return message.includes('response_format') && (
    message.includes('not supported')
    || message.includes('unsupportedparams')
    || message.includes('unsupported')
    || message.includes('drop_params')
  )
}

/**
 * 调用 OpenAI 兼容的图片生成接口，返回 data URL 格式的图片。
 *
 * @param settings - 应用配置（需包含 imageModel、imageBaseUrl、imageApiKey）
 * @param prompt - 图片生成提示词
 * @returns 包含 dataUrl 和可选 revisedPrompt 的结果
 */
export async function generateImage(settings: AppSettings, prompt: string): Promise<GeneratedImageResult> {
  const normalized = normalizeImageSettings(settings)
  if (!normalized.model.trim()) {
    throw new Error('请先在设置中填写专用的图片生成模型（不会自动回退到文本模型）。')
  }
  if (!normalized.baseUrl.trim()) {
    throw new Error('请先在设置中填写专用的图片生成 Base URL。')
  }
  if (!normalized.apiKey.trim()) {
    throw new Error('请先在设置中填写专用的图片生成 API Key。')
  }

  // Google Gemini 原生 REST API（如 https://generativelanguage.googleapis.com/v1beta）
  // 使用 generateContent 端点与 x-goog-api-key 鉴权，而非 OpenAI 兼容的 /images/generations。
  if (isGeminiNativeBaseUrl(normalized.baseUrl)) {
    return generateImageGeminiNative(normalized, prompt)
  }

  const url = `${normalized.baseUrl.replace(/\/$/, '')}/images/generations`
  const requestFetch = createProxyFetch(settings.proxyUrl)

  // 默认请求 b64_json 以获得可本地保存的自包含图片；部分 provider（如 gpt-image-1、
  // 经 litellm 代理的 agnes 等）不支持 response_format，命中后去掉该参数重试一次。
  const buildBody = (includeResponseFormat: boolean): string => JSON.stringify({
    model: normalized.model,
    prompt,
    size: '1024x1536',
    ...(includeResponseFormat ? { response_format: 'b64_json' } : {})
  })

  const requestOnce = (includeResponseFormat: boolean): Promise<Response> => performAiRequest({
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalized.apiKey}`
      },
      body: buildBody(includeResponseFormat)
    },
    providerLabel: '图片生成接口',
    requestFetch
  })

  let response: Response
  try {
    response = await requestOnce(true)
  } catch (error) {
    if (!isUnsupportedResponseFormatError(error)) {
      throw error
    }
    response = await requestOnce(false)
  }

  const data = (await response.json()) as {
    data?: Array<{
      b64_json?: string
      revised_prompt?: string
      url?: string
    }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      prompt_tokens?: number
      completion_tokens?: number
    }
  }
  const first = data.data?.[0]
  if (!first) {
    throw new Error('图片生成成功，但没有返回图片数据。')
  }

  const rawUsage = data.usage
  const usage: AiRunUsage | undefined = rawUsage
    ? {
        promptTokens: Number.isFinite(rawUsage.input_tokens) ? rawUsage.input_tokens : (Number.isFinite(rawUsage.prompt_tokens) ? rawUsage.prompt_tokens : undefined),
        completionTokens: Number.isFinite(rawUsage.output_tokens) ? rawUsage.output_tokens : (Number.isFinite(rawUsage.completion_tokens) ? rawUsage.completion_tokens : undefined),
        totalTokens: Number.isFinite(rawUsage.total_tokens) ? rawUsage.total_tokens : undefined
      }
    : undefined

  if (first.b64_json?.trim()) {
    const base64 = first.b64_json.trim()
    return {
      dataUrl: `data:${inferMimeType(base64)};base64,${base64}`,
      revisedPrompt: first.revised_prompt?.trim() || undefined,
      usage
    }
  }

  if (first.url?.trim()) {
    // 部分 provider 返回远程 URL；本地保存功能只接受 data URL，这里下载并转 base64 兜底。
    const dataUrl = await remoteImageToDataUrl(first.url.trim(), requestFetch)
    return {
      dataUrl,
      revisedPrompt: first.revised_prompt?.trim() || undefined,
      usage
    }
  }

  throw new Error('图片生成成功，但返回结果中没有可用图片。')
}

/** 下载远程图片并转成 base64 data URL；失败时回退为原始 URL。 */
async function remoteImageToDataUrl(url: string, requestFetch: typeof fetch): Promise<string> {
  try {
    const response = await performAiRequest({
      url,
      init: { method: 'GET' },
      providerLabel: '图片下载',
      requestFetch
    })
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || ''
    const base64 = Buffer.from(await response.arrayBuffer()).toString('base64')
    const mimeType = contentType.startsWith('image/') ? contentType : `image/${inferMimeType(base64).replace('image/', '')}`
    return `data:${mimeType};base64,${base64}`
  } catch {
    return url
  }
}

/**
 * 构建 Google Gemini 原生图片生成的请求体（generateContent）。
 *
 * @param prompt - 图片生成提示词
 * @returns 序列化后的请求体
 */
export function buildGeminiImageRequestBody(prompt: string): string {
  return JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseModalities: ['IMAGE']
    }
  })
}

/** Gemini generateContent 响应中图片所在的数据结构 */
type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string }
        text?: string
      }>
    }
    finishReason?: string
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: { message?: string }
}

/**
 * 解析 Google Gemini generateContent 响应，提取图片 data URL 与用量。
 *
 * @param payload - 已解析的 Gemini 响应 JSON
 * @returns 图片 data URL、可选 revisedPrompt 与用量；无图片时返回 null
 */
export function parseGeminiImageResponse(payload: unknown): { dataUrl: string; revisedPrompt?: string; usage?: AiRunUsage } | null {
  const data = payload as GeminiGenerateContentResponse
  if (!data || typeof data !== 'object') return null
  if (data.error?.message) {
    throw new Error(data.error.message)
  }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const inline = parts.find((p) => p?.inlineData?.data)
  if (inline?.inlineData?.data) {
    const mimeType = inline.inlineData.mimeType?.trim() || 'image/png'
    const dataUrl = `data:${mimeType};base64,${inline.inlineData.data}`
    const revisedPrompt = parts.map((p) => p?.text?.trim()).filter(Boolean).join('\n') || undefined
    const rawUsage = data.usageMetadata
    const usage: AiRunUsage | undefined = rawUsage
      ? {
          promptTokens: Number.isFinite(rawUsage.promptTokenCount) ? rawUsage.promptTokenCount : undefined,
          completionTokens: Number.isFinite(rawUsage.candidatesTokenCount) ? rawUsage.candidatesTokenCount : undefined,
          totalTokens: Number.isFinite(rawUsage.totalTokenCount) ? rawUsage.totalTokenCount : undefined
        }
      : undefined
    return { dataUrl, revisedPrompt, usage }
  }
  // 无 inline 图片时，尝试从文本 parts 提取提示（便于排查），否则返回 null 由调用方给出可读错误。
  const text = parts.map((p) => p?.text?.trim()).filter(Boolean).join('\n')
  if (text) {
    throw new Error(`Gemini 未返回图片数据。返回内容：${text.slice(0, 200)}`)
  }
  return null
}

/**
 * 调用 Google Gemini 原生 REST API 生成图片（如 gemini-2.5-flash-image / imagen 系列）。
 *
 * 原生接口与 OpenAI 兼容协议不同：使用 `:generateContent` 端点与 `x-goog-api-key` 头鉴权，
 * 返回体中的图片位于 candidates[].content.parts[].inlineData.data（base64）。
 *
 * @param settings - 已归一化的图片生成配置（需包含 imageModel、imageBaseUrl、imageApiKey）
 * @param prompt - 图片生成提示词
 * @returns 包含 dataUrl 和可选 revisedPrompt 的结果
 */
async function generateImageGeminiNative(settings: AppSettings, prompt: string): Promise<GeneratedImageResult> {
  const base = settings.baseUrl.trim().replace(/\/+$/, '')
  const model = settings.model.trim()
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent`
  const requestFetch = createProxyFetch(settings.proxyUrl)

  const response = await performAiRequest({
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': settings.apiKey
      },
      body: buildGeminiImageRequestBody(prompt)
    },
    providerLabel: '图片生成接口',
    requestFetch
  })

  const parsed = parseGeminiImageResponse(await response.json())
  if (parsed) {
    return parsed
  }
  throw new Error('Gemini 图片生成成功，但没有返回图片数据。')
}

