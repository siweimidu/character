/**
 * 模型列表 URL 候选构建（纯函数，无外部依赖，便于单测）。
 * 用于从用户的 Base URL 推导出可尝试的 /models 端点。
 */

/** 已知的兼容性后缀路径，用于自动剥离后缀以找到真正的 /v1/models 端点 */
const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode', '/api/anthropic', '/apps/anthropic',
  '/api/coding', '/claudecode', '/anthropic',
  '/step_plan', '/coding', '/claude',
  // 第三方中转 / 镜像站常见路径
  '/api/openai', '/openai/v1', '/v1/openai',
  '/api/chat', '/api/inference', '/inference',
  '/api/v1/chat/completions', '/api/chat/completions',
  '/api/anthropic/chat', '/anthropic/chat'
]

const KNOWN_ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/api/chat/completions',
  '/api/v1/chat/completions',
  '/messages',
  '/responses',
  '/embeddings',
  '/models',
  '/v1/models',
  '/images/generations'
]

function stripKnownEndpointSuffix(baseUrl: string): string {
  for (const suffix of KNOWN_ENDPOINT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) return baseUrl.slice(0, -suffix.length)
  }
  return baseUrl
}

/** 从 baseUrl 中剥离已知的兼容性后缀，返回剥离后的 URL，无匹配时返回 null */
function stripCompatSuffix(baseUrl: string): string | null {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) return baseUrl.slice(0, baseUrl.length - suffix.length)
  }
  return null
}

/**
 * 已知的 OpenAI 兼容模型列表根路径。本地中转网关（LiteLLM/OmniRoute/FreeLLMAPI）
 * 以及部分第三方聚合通常直接暴露 /models，而官方接口则位于 /v1/models。
 * 探测时按优先级尝试多种组合以兼容各类实现。
 */
const KNOWN_OPENAI_COMPAT_SUFFIXES = [
  '/openai', // Google Gemini OpenAI 兼容入口 .../v1beta/openai
  '/v1',     // 常见中转站以 /v1 作为 OpenAI 兼容入口
  '/api/v1',
  '/api'
]

/**
 * 从 baseUrl 中剥离已知的 OpenAI 兼容入口后缀，返回其"根"路径候选。
 * 例如 `https://generativelanguage.googleapis.com/v1beta/openai`
 * 会剥离出 `https://generativelanguage.googleapis.com/v1beta`，
 * 以便探测 `.../v1beta/models` 等真实模型列表端点。
 */
function stripOpenAiCompatSuffix(baseUrl: string): string | null {
  for (const suffix of KNOWN_OPENAI_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) return baseUrl.slice(0, baseUrl.length - suffix.length)
  }
  return null
}

/** 判断是否为 Google Gemini 原生 REST API（非 OpenAI 兼容入口）地址。
 * 原生入口形如 https://generativelanguage.googleapis.com/v1beta，
 * 需使用 x-goog-api-key 头与 /models 端点；OpenAI 兼容入口则带 /openai 后缀。 */
export function isGeminiNativeBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  let host = ''
  let pathname = ''
  try {
    const url = new URL(trimmed)
    host = url.hostname
    pathname = url.pathname
  } catch {
    return false
  }
  if (!/(^|\.)generativelanguage\.googleapis\.com$/i.test(host)) return false
  // OpenAI 兼容入口 .../v1beta/openai 走 OpenAI 协议，不属于原生 API。
  if (/(^|\/)openai\/?$/i.test(pathname)) return false
  return /\/v\d+beta(?:\/|$)/i.test(pathname)
}

/** 从 baseUrl 中提取版本段（如 /v1、/v2、/v1beta），无则返回 null */
function extractVersionPath(baseUrl: string): string | null {
  const match = baseUrl.match(/(\/v\d+(?:beta)?)(?:\/|$)/i)
  return match ? match[1] : null
}

/** 归一化候选 URL 尾部的重复斜杠 */
function normUrl(u: string): string {
  return u.replace(/\/+$/, '')
}

/** 根据 baseUrl 构建候选的模型列表请求 URL，自动尝试多种路径格式 */
export function buildModelsUrlCandidates(baseUrl: string): string[] {
  const trimmed = stripKnownEndpointSuffix(baseUrl.trim().replace(/\/+$/, ''))
  if (!trimmed) return []
  const candidates: string[] = []
  if (/(^|\.)open\.bigmodel\.cn(\/|$)/i.test(trimmed) || trimmed.endsWith('/api/paas/v4')) {
    candidates.push(normUrl(`${trimmed.replace(/\/v1$/i, '')}/models`))
  }
  if (/\/v\d+$/i.test(trimmed)) {
    // 已有版本段（如 /v1、/v3、/v4），直接追加 /models
    candidates.push(normUrl(`${trimmed}/models`))
  } else {
    candidates.push(normUrl(`${trimmed}/v1/models`))
    // 不带版本段的地址同时尝试根路径 /models（兼容本地网关与部分聚合）
    candidates.push(normUrl(`${trimmed}/models`))
  }

  // Google Gemini OpenAI 兼容入口：/v1beta/openai → 剥离 /openai 后探测 /v1beta/models
  const openAiStripped = stripOpenAiCompatSuffix(trimmed)
  if (openAiStripped) {
    const root = openAiStripped.replace(/\/+$/, '')
    if (root.includes('://') && root.length > root.indexOf('://') + 3) {
      candidates.push(normUrl(`${root}/models`))
      candidates.push(normUrl(`${root}/v1/models`))
    }
  }

  const stripped = stripCompatSuffix(trimmed)
  if (stripped) {
    const root = stripped.replace(/\/+$/, '')
    if (root.includes('://') && root.length > root.indexOf('://') + 3) {
      candidates.push(normUrl(`${root}/v1/models`))
      candidates.push(normUrl(`${root}/models`))
    }
  }

  // 兜底：若 baseUrl 本身含版本段但探测结果仍未覆盖，则尝试 /v{版本}/models 与根 /models
  const versionPath = extractVersionPath(trimmed)
  if (versionPath && !candidates.some((c) => c.endsWith(`${versionPath}/models`))) {
    const idx = trimmed.indexOf(versionPath)
    if (idx > 0) {
      const prefix = normUrl(trimmed.slice(0, idx))
      candidates.push(normUrl(`${prefix}${versionPath}/models`))
      candidates.push(normUrl(`${prefix}/models`))
    }
  }

  return [...new Set(candidates)]
}
