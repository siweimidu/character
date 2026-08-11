const MAX_ERROR_DETAIL_LENGTH = 1200

/**
 * Google Gemini OpenAI 兼容接口（generativelanguage.googleapis.com/v1beta/openai）
 * 对函数调用返回 thought_signature（思考签名），并要求客户端在回传工具结果时把它一并带回。
 * 开源 @ai-sdk/openai-compatible 虽然内置了 thought_signature 读写，但响应侧把它写入
 * providerMetadata.openaiCompatible.thoughtSignature，请求侧却从 providerOptions.google
 * 读取，键不匹配导致无法自动闭环。项目已通过传输层（thought-signature.ts + sse.ts）在
 * fetch 拦截处补全该签名。
 * 此处的提示仅作为兜底：当所用中转站本身不支持/不转发该签名，或签名修补仍无法满足接口要求时，
 * 才给出可操作指引，避免用户在 Gemini 工具调用失败时不知所措。
 */
export const GEMINI_THOUGHT_SIGNATURE_HINT =
  '当前 OpenAI 兼容接口仍无法完成 Gemini 的工具调用（thought_signature 思考签名未正确回传）。' +
  '已尝试在传输层自动补全该签名；若仍失败，可能是中转站不支持该字段。' +
  '请切换到支持工具调用的模型（如 Claude / GPT 系列），或更换/升级到能正确处理 Gemini thought_signature 的兼容接口后重试。'

type ErrorRecord = Record<string, unknown>

/** 识别 Gemini 函数调用缺少 thought_signature 的 HTTP 400 错误。 */
export function isGeminiThoughtSignatureError(error: unknown): boolean {
  const text = String(
    error instanceof Error ? error.message : (error ?? '')
  )
  const body = parseBodySafe(findResponseBody(error))
  const haystack = `${text} ${body}`.toLowerCase()
  return (
    haystack.includes('thought_signature')
    && (
      haystack.includes('缺少') || haystack.includes('missing')
      || haystack.includes('函数调用') || haystack.includes('functioncall')
      || haystack.includes('function call')
    )
    && (
      haystack.includes('gemini') || haystack.includes('googleapis')
      || haystack.includes('ai.google.dev') || haystack.includes('generativelanguage')
    )
  )
}

function parseBodySafe(value: unknown): string {
  try { return parseBody(value) } catch { return '' }
}

function asRecord(value: unknown): ErrorRecord | null {
  return value && typeof value === 'object' ? value as ErrorRecord : null
}

function trimDetail(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_ERROR_DETAIL_LENGTH) return normalized
  return `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`
}

function parseBody(value: unknown): string {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    try {
      return parseBody(JSON.parse(text)) || trimDetail(text)
    } catch {
      return trimDetail(text)
    }
  }

  const record = asRecord(value)
  if (!record) return ''

  for (const key of ['error', 'message', 'detail', 'msg', 'description']) {
    const nested = record[key]
    if (typeof nested === 'string' && nested.trim()) return trimDetail(nested)
    const nestedMessage = parseBody(nested)
    if (nestedMessage) return nestedMessage
  }

  try {
    return trimDetail(JSON.stringify(record))
  } catch {
    return ''
  }
}

function findResponseBody(error: unknown): unknown {
  let current: unknown = error
  const visited = new Set<unknown>()
  for (let depth = 0; depth < 4 && current && !visited.has(current); depth += 1) {
    visited.add(current)
    const record = asRecord(current)
    if (!record) return undefined
    for (const key of ['responseBody', 'response_body', 'data', 'body']) {
      if (record[key] !== undefined && record[key] !== null) return record[key]
    }
    current = record.cause
  }
  return undefined
}

/**
 * Preserve the upstream API message when AI SDK only exposes a generic status
 * text such as "Not Found". This is the user-facing error string; raw details
 * remain available in ai-prompts.log for diagnostics.
 */
export function formatAiErrorMessage(error: unknown, fallback: string): string {
  // Gemini OpenAI 兼容接口的 thought_signature 缺口：直接给出清晰、可操作的指引。
  if (isGeminiThoughtSignatureError(error)) {
    return GEMINI_THOUGHT_SIGNATURE_HINT
  }
  const record = asRecord(error)
  const statusCode = record?.statusCode ?? asRecord(record?.cause)?.statusCode
  const upstreamDetail = parseBody(findResponseBody(error))
  const baseMessage = error instanceof Error ? error.message.trim() : String(error ?? '').trim()
  const genericMessages = new Set(['not found', 'bad request', 'unauthorized', 'forbidden', 'internal server error'])

  if (upstreamDetail && upstreamDetail.toLowerCase() !== baseMessage.toLowerCase()) {
    const status = statusCode ? `（HTTP ${statusCode}）` : ''
    return `接口返回${status}：${upstreamDetail}`
  }

  if (baseMessage && baseMessage !== fallback) {
    const status = statusCode && genericMessages.has(baseMessage.toLowerCase()) ? `（HTTP ${statusCode}）` : ''
    return `${baseMessage}${status}`
  }

  return fallback
}
