import type { AppSettings } from '../shared-types'
import { isLocalBaseUrl, normalizeSettings } from '../settings'
import { createProxyFetch } from '../proxy-fetch'
import { buildModelsUrlCandidates } from './model-urls'
import {
  isAnthropicProtocol,
  isOpenCodeProvider,
  isSupportedProviderModel
} from '@shared/ai-provider-catalog'

/** 从模型列表接口获取到的模型信息 */
export interface FetchedModel {
  id: string
  ownedBy: string | null
}

/** 获取模型列表的超时时间（毫秒） */
const FETCH_MODELS_TIMEOUT_MS = 15_000

/** 通过 OpenAI 兼容接口获取模型列表，自动尝试多个候选 URL */
async function fetchModelsOpenAiCompatible(baseUrl: string, apiKey: string, requestFetch: typeof fetch): Promise<FetchedModel[]> {
  const candidates = buildModelsUrlCandidates(baseUrl)
  if (candidates.length === 0) throw new Error('Base URL 为空，无法获取模型列表。')
  let lastError: string | null = null
  for (const url of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)
    try {
      const response = await requestFetch(url, {
        method: 'GET',
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        signal: controller.signal
      })
      if (response.status === 404 || response.status === 405) { lastError = `HTTP ${response.status}`; continue }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      const data = (await response.json()) as { data?: Array<{ id: string; owned_by?: string | null }> }
      const models = (data.data ?? []).map((m) => ({ id: m.id, ownedBy: m.owned_by ?? null }))
      models.sort((a, b) => a.id.localeCompare(b.id))
      return models
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('获取模型列表超时，请检查网络或代理设置。')
      if (lastError !== null) continue
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`所有候选端点均返回 ${lastError ?? '错误'}，该供应商可能未开放模型列表接口。`)
}

/** 通过 Anthropic 原生接口获取模型列表 */
async function fetchModelsAnthropic(baseUrl: string, apiKey: string, requestFetch: typeof fetch): Promise<FetchedModel[]> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const url = `${trimmed}/models`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)
  try {
    const response = await requestFetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: controller.signal
    })
    if (response.status === 404) throw new Error('该接口不支持拉取模型列表，请手动输入模型名称（如 claude-sonnet-4-6）。')
    if (!response.ok) throw new Error(`Anthropic 模型列表请求失败：HTTP ${response.status} ${response.statusText}`)
    const data = (await response.json()) as { data?: Array<{ id: string; owned_by?: string | null }> }
    const models = (data.data ?? []).map((m) => ({ id: m.id, ownedBy: m.owned_by ?? null }))
    models.sort((a, b) => a.id.localeCompare(b.id))
    return models
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('获取 Anthropic 模型列表超时，请检查网络或代理设置。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 根据当前 provider 获取可用的模型列表。
 *
 * @param settings - 应用配置（需包含 baseUrl、provider，Anthropic 还需 apiKey）
 * @returns 模型列表，按 id 排序
 */
export async function fetchModels(settings: AppSettings): Promise<FetchedModel[]> {
  const normalized = normalizeSettings(settings)
  if (!normalized.baseUrl.trim()) throw new Error('请先填写 Base URL。')
  // 本地地址（127.0.0.1 / localhost）与 Ollama 无需 API Key 即可拉取模型列表；
  // 兼容 LiteLLM / OmniRoute / FreeLLMAPI 等本地中转网关默认不配置密钥的场景。
  if (!normalized.apiKey.trim() && normalized.provider !== 'ollama' && !isLocalBaseUrl(normalized.baseUrl)) {
    throw new Error('需要 API Key 才能获取模型列表。')
  }
  const rawBaseUrl = (settings.baseUrl?.trim() || '').replace(/\/+$/, '')
  const requestFetch = createProxyFetch(normalized.proxyUrl)
  const models = isAnthropicProtocol(normalized.provider, normalized.model, normalized.apiProtocol) && !isOpenCodeProvider(normalized.provider)
    ? await fetchModelsAnthropic(rawBaseUrl || normalized.baseUrl, normalized.apiKey, requestFetch)
    : await fetchModelsOpenAiCompatible(rawBaseUrl || normalized.baseUrl, normalized.apiKey, requestFetch)
  return models.filter((model) => isSupportedProviderModel(normalized.provider, model.id))
}

/**
 * 获取图片生成专用的模型列表（使用独立的图片生成配置）。
 *
 * @param settings - 应用配置（需包含 imageBaseUrl、imageApiKey）
 * @returns 模型列表，按 id 排序
 */
export async function fetchImageModels(settings: AppSettings): Promise<FetchedModel[]> {
  const baseUrl = settings.imageBaseUrl?.trim()
  const apiKey = settings.imageApiKey?.trim()
  if (!baseUrl) throw new Error('请先填写图片生成 Base URL。')
  if (!apiKey) throw new Error('请先填写图片生成 API Key。')
  return fetchModelsOpenAiCompatible(baseUrl, apiKey, createProxyFetch(settings.proxyUrl))
}
