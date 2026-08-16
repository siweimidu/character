import type { AppSettings } from '../shared-types'
import { isLocalBaseUrl, normalizeSettings } from '../settings'
import { createProxyFetch } from '../proxy-fetch'
import { buildModelsUrlCandidates, isGeminiNativeBaseUrl } from './model-urls'
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

/** GitCode / AtomGit 等基于分页的模型列表接口，单页返回有限，需遍历多页获取完整列表 */
const GITCODE_MODELS_PAGE_SIZE = 100
const GITCODE_MODELS_MAX_PAGES = 30

function isGitCodeModelsBaseUrl(baseUrl: string): boolean {
  return /(^|\.)(api-ai\.)?gitcode\.com(\/|$)/i.test(baseUrl.trim())
}

/** 模型列表返回体的字段形状归一化：兼容 data[] / models[] / 顶层数组等结构 */
function extractModelItems(payload: unknown): Array<{ id?: unknown; owned_by?: unknown; name?: unknown }> {
  if (Array.isArray(payload)) return payload as Array<{ id?: unknown; owned_by?: unknown; name?: unknown }>
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data as Array<{ id?: unknown; owned_by?: unknown; name?: unknown }>
  if (Array.isArray(record.models)) return record.models as Array<{ id?: unknown; owned_by?: unknown; name?: unknown }>
  return []
}

/** 把响应体映射为统一的 FetchedModel，忽略缺少 id 的条目 */
function normalizeFetchedModels(items: Array<{ id?: unknown; owned_by?: unknown; name?: unknown }>): FetchedModel[] {
  const out: FetchedModel[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim()
      : (typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '')
    if (!id) continue
    out.push({ id, ownedBy: typeof item.owned_by === 'string' ? item.owned_by : null })
  }
  return out
}

/** GitCode/AtomGit 已知可用的视觉模型，作为拉取不到或结果不全时的保底项 */
const GITCODE_KNOWN_MODELS: FetchedModel[] = [
  { id: 'Qwen/Qwen3-VL-8B-Instruct', ownedBy: 'atomgit' }
]

/** ModelScope / models 接口域名判断：https://api-inference.modelscope.cn */
export function isModelScopeBaseUrl(baseUrl: string): boolean {
  return /(^|\.)(api-inference\.)?modelscope\.cn(\/|$)/i.test(baseUrl.trim())
}

/**
 * ModelScope（魔搭/魔塔社区）已知可用的模型，作为拉取不到或结果不全时的保底项。
 * ModelScope 的 /models 接口只返回部分模型，很多模型需手动指定模型 ID 才能调用，
 * 这里把常用（文本/视觉/图片生成）模型全部登记进来，确保下拉列表不会缺失。
 */
const MODELSCOPE_KNOWN_MODELS: FetchedModel[] = [
  // 文本（Instruct / Chat）
  { id: 'Qwen/Qwen2.5-7B-Instruct', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen2.5-14B-Instruct', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen2.5-32B-Instruct', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen2.5-72B-Instruct', ownedBy: 'qwen' },
  { id: 'Qwen/QwQ-32B-Preview', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen2.5-Coder-7B-Instruct', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen2.5-Coder-14B-Instruct', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', ownedBy: 'qwen' },
  { id: 'deepseek-ai/DeepSeek-R1', ownedBy: 'deepseek-ai' },
  { id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', ownedBy: 'deepseek-ai' },
  { id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B', ownedBy: 'deepseek-ai' },
  { id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', ownedBy: 'deepseek-ai' },
  { id: 'deepseek-ai/DeepSeek-V3', ownedBy: 'deepseek-ai' },
  { id: '01ai/Yi-9B-Chat', ownedBy: '01ai' },
  { id: 'internlm/internlm3-8b-instruct', ownedBy: 'internlm' },
  { id: 'baichuan-inc/Baichuan4-Aither-7B-Chat', ownedBy: 'baichuan-inc' },
  { id: 'MiniMax/MiniMax-M1-80k', ownedBy: 'minimax' },
  // 视觉（图片识别）
  { id: 'Qwen/Qwen2.5-VL-7B-Instruct', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen2.5-VL-14B-Instruct', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen2.5-VL-72B-Instruct', ownedBy: 'qwen' },
  // 图片生成
  { id: 'Qwen/Qwen-Image', ownedBy: 'qwen' },
  { id: 'Qwen/Qwen-Image-Edit', ownedBy: 'qwen' },
  { id: 'black-forest-labs/FLUX.1-dev', ownedBy: 'black-forest-labs' },
  { id: 'MAILAND/majicflus_v1', ownedBy: 'mailand' },
  { id: 'ChaosMY/MYkawaii4MJ', ownedBy: 'chaosmy' }
]

function mergeKnownModels(models: FetchedModel[]): FetchedModel[] {
  const byId = new Map(models.map((m) => [m.id, m]))
  for (const known of GITCODE_KNOWN_MODELS) {
    if (!byId.has(known.id)) byId.set(known.id, known)
  }
  const merged = [...byId.values()]
  merged.sort((a, b) => a.id.localeCompare(b.id))
  return merged
}

/** 把 ModelScope 的保底模型合并进拉取结果，保证列表完整 */
function mergeModelScopeModels(models: FetchedModel[]): FetchedModel[] {
  const byId = new Map(models.map((m) => [m.id, m]))
  for (const known of MODELSCOPE_KNOWN_MODELS) {
    if (!byId.has(known.id)) byId.set(known.id, known)
  }
  const merged = [...byId.values()]
  merged.sort((a, b) => a.id.localeCompare(b.id))
  return merged
}

/** 导出 ModelScope 保底模型 ID 集合（供测试与校验使用） */
export function getModelScopeFallbackModels(): FetchedModel[] {
  return [...MODELSCOPE_KNOWN_MODELS]
}

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
      const data: unknown = await response.json()
      const models = normalizeFetchedModels(extractModelItems(data))
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

/**
 * 通过 OpenAI 兼容接口获取 GitCode / AtomGit 模型列表。
 * GitCode 的 /models 走 OpenAI 兼容协议，但个别账号返回结果可能分页或字段结构不同，
 * 因此先按标准无分页方式请求，若一页返回已满 100 条则继续按 page 递增补拉，保证完整。
 */
async function fetchModelsGitCode(baseUrl: string, apiKey: string, requestFetch: typeof fetch): Promise<FetchedModel[]> {
  const candidates = buildModelsUrlCandidates(baseUrl)
  if (candidates.length === 0) throw new Error('Base URL 为空，无法获取模型列表。')
  const seen = new Map<string, FetchedModel>()
  let lastError: string | null = null
  for (const base of candidates) {
    try {
      // 先按标准 OpenAI 兼容 /models 请求一次，避免无意义的分页参数导致部分网关报错。
      for (let page = 1; page <= GITCODE_MODELS_MAX_PAGES; page++) {
        const separator = base.includes('?') ? '&' : '?'
        const url = page === 1
          ? base
          : `${base}${separator}page=${page}&per_page=${GITCODE_MODELS_PAGE_SIZE}`
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)
        let pageModels: Array<{ id?: unknown; owned_by?: unknown; name?: unknown }> = []
        try {
          const response = await requestFetch(url, {
            method: 'GET',
            headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            signal: controller.signal
          })
          if (response.status === 404 || response.status === 405) { lastError = `HTTP ${response.status}`; break }
          if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
          const data: unknown = await response.json()
          pageModels = extractModelItems(data)
        } finally {
          clearTimeout(timer)
        }
        for (const m of normalizeFetchedModels(pageModels)) {
          seen.set(m.id, m)
        }
        // 第一页不足 100 条说明接口未分页或已到末尾，直接停止。
        if (pageModels.length === 0 || pageModels.length < GITCODE_MODELS_PAGE_SIZE) break
      }
      if (seen.size > 0) {
        return mergeKnownModels([...seen.values()])
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('获取模型列表超时，请检查网络或代理设置。')
      if (lastError !== null) continue
      throw error
    }
  }
  // 即使网络请求没有返回可用模型，也回退到已知模型，确保 Qwen/Qwen3-VL-8B-Instruct 一定能被选中。
  return mergeKnownModels([])
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

/** 原生 Gemini /models 列表单页条数上限 */
const GEMINI_MODELS_PAGE_SIZE = 100
/** 原生 Gemini /models 列表最大翻页数 */
const GEMINI_MODELS_MAX_PAGES = 20

/**
 * 通过 Google Gemini 原生 REST API 获取模型列表。
 * 原生接口使用 x-goog-api-key 头鉴权，端点形如 {base}/models，
 * 返回体字段为 models[].name（带 models/ 前缀），并可基于 nextPageToken 翻页。
 */
async function fetchModelsGeminiNative(baseUrl: string, apiKey: string, requestFetch: typeof fetch): Promise<FetchedModel[]> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const models: FetchedModel[] = []
  let pageToken = ''
  for (let page = 0; page < GEMINI_MODELS_MAX_PAGES; page++) {
    const sep = pageToken ? '&' : '?'
    const url = `${trimmed}/models${pageToken ? `${sep}pageToken=${encodeURIComponent(pageToken)}` : `?pageSize=${GEMINI_MODELS_PAGE_SIZE}`}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)
    try {
      const response = await requestFetch(url, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
        signal: controller.signal
      })
      if (response.status === 404 || response.status === 405) {
        throw new Error('Google Gemini 原生接口不支持拉取模型列表，请手动输入模型名称（如 imagen-3.0-generate-002）。')
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      const data = (await response.json()) as {
        models?: Array<{ name?: string }>
        nextPageToken?: string
      }
      for (const item of data.models ?? []) {
        const raw = (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : ''
        if (!raw) continue
        // 原生接口 name 形如 models/imagen-3.0-generate-002，剥离前缀后作为模型 ID
        const id = raw.replace(/^models\//i, '').trim()
        if (!id) continue
        models.push({ id, ownedBy: 'google' })
      }
      pageToken = data.nextPageToken ?? ''
      if (!pageToken) break
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('获取模型列表超时，请检查网络或代理设置。')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  if (models.length === 0) {
    throw new Error('Google Gemini 模型列表返回为空，请检查 API Key 是否有图片模型权限，或手动输入模型名称。')
  }
  models.sort((a, b) => a.id.localeCompare(b.id))
  return models
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
  const effectiveBaseUrl = rawBaseUrl || normalized.baseUrl
  const models = isAnthropicProtocol(normalized.provider, normalized.model, normalized.apiProtocol) && !isOpenCodeProvider(normalized.provider)
    ? await fetchModelsAnthropic(effectiveBaseUrl, normalized.apiKey, requestFetch)
    : isGitCodeModelsBaseUrl(effectiveBaseUrl)
      ? await fetchModelsGitCode(effectiveBaseUrl, normalized.apiKey, requestFetch)
      : await fetchModelsOpenAiCompatible(effectiveBaseUrl, normalized.apiKey, requestFetch)
  // ModelScope（魔搭/魔塔社区）的 /models 接口返回不全，补充已登记的可选模型，确保下拉列表完整。
  const withFallback = isModelScopeBaseUrl(effectiveBaseUrl) ? mergeModelScopeModels(models) : models
  return withFallback.filter((model) => isSupportedProviderModel(normalized.provider, model.id))
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
  const requestFetch = createProxyFetch(settings.proxyUrl)
  if (isGeminiNativeBaseUrl(baseUrl)) return fetchModelsGeminiNative(baseUrl, apiKey, requestFetch)
  if (isModelScopeBaseUrl(baseUrl)) {
    const models = await fetchModelsOpenAiCompatible(baseUrl, apiKey, requestFetch)
    return mergeModelScopeModels(models)
  }
  return isGitCodeModelsBaseUrl(baseUrl)
    ? fetchModelsGitCode(baseUrl, apiKey, requestFetch)
    : fetchModelsOpenAiCompatible(baseUrl, apiKey, requestFetch)
}
