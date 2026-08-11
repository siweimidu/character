/**
 * 模型列表 URL 候选构建（纯函数，无外部依赖，便于单测）。
 * 用于从用户的 Base URL 推导出可尝试的 /models 端点。
 */

/** 已知的兼容性后缀路径，用于自动剥离后缀以找到真正的 /v1/models 端点 */
const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode', '/api/anthropic', '/apps/anthropic',
  '/api/coding', '/claudecode', '/anthropic',
  '/step_plan', '/coding', '/claude'
]

const KNOWN_ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/messages',
  '/responses',
  '/embeddings',
  '/models',
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

/** 根据 baseUrl 构建候选的模型列表请求 URL，自动尝试多种路径格式 */
export function buildModelsUrlCandidates(baseUrl: string): string[] {
  const trimmed = stripKnownEndpointSuffix(baseUrl.trim().replace(/\/+$/, ''))
  if (!trimmed) return []
  const candidates: string[] = []
  if (/(^|\.)open\.bigmodel\.cn(\/|$)/i.test(trimmed) || trimmed.endsWith('/api/paas/v4')) {
    candidates.push(`${trimmed.replace(/\/v1$/i, '')}/models`)
  }
  if (/\/v\d+$/i.test(trimmed)) {
    // 已有版本段（如 /v1、/v3、/v4），直接追加 /models
    candidates.push(`${trimmed}/models`)
  } else {
    candidates.push(`${trimmed}/v1/models`)
    // 不带版本段的地址同时尝试根路径 /models（兼容本地网关与部分聚合）
    candidates.push(`${trimmed}/models`)
  }

  // Google Gemini OpenAI 兼容入口：/v1beta/openai → 剥离 /openai 后探测 /v1beta/models
  const openAiStripped = stripOpenAiCompatSuffix(trimmed)
  if (openAiStripped) {
    const root = openAiStripped.replace(/\/+$/, '')
    if (root.includes('://') && root.length > root.indexOf('://') + 3) {
      candidates.push(`${root}/models`)
      candidates.push(`${root}/v1/models`)
    }
  }

  const stripped = stripCompatSuffix(trimmed)
  if (stripped) {
    const root = stripped.replace(/\/+$/, '')
    if (root.includes('://') && root.length > root.indexOf('://') + 3) {
      candidates.push(`${root}/v1/models`)
      candidates.push(`${root}/models`)
    }
  }
  return [...new Set(candidates)]
}
