/**
 * Gemini thought_signature 的捕获与回传。
 *
 * 背景：Gemini 的 OpenAI 兼容入口（generativelanguage.googleapis.com/v1beta/openai）
 * 在模型发出工具调用时会返回 `extra_content.google.thought_signature`，并要求客户端在
 * 下一轮请求的 assistant tool_calls 里把它原样带回，否则接口直接返回 HTTP 400
 * （INVALID_ARGUMENT，提示缺少 thought_signature）。
 *
 * 开源 @ai-sdk/openai-compatible 虽然内置了 thought_signature 的读写，但存在键不匹配的
 * 缺口：响应侧把它写入 `providerMetadata.openaiCompatible.thoughtSignature`，而请求侧
 * 却从 `providerOptions.google.thoughtSignature` 读取，两者 key 不一致，导致无法自动闭环。
 *
 * 因此本模块在自定义 fetch（传输层）直接修补 wire 协议：
 *   - 响应侧：从 tool_calls（流式 delta 或非流式 message）里提取 thought_signature，按
 *     tool_call_id 暂存；
 *   - 请求侧：把暂存的 thought_signature 注入回 assistant tool_calls 的
 *     `extra_content.google.thought_signature` 字段。
 * 这样应用层无需改动 AI SDK，即可让 Gemini 系列模型在智能体工具调用场景下正常可用。
 */

type ToolCallId = string

/** 按 tool_call_id 暂存最近一次捕获到的 thought_signature，注入后即删除。 */
const signatureByToolCallId = new Map<ToolCallId, string>()

/** 流式响应中，thought_signature 可能和 tool_call 的 id 分属不同 SSE 帧，需按 index 跨帧累积。 */
const pendingByIndex = new Map<number, { id: string; signature: string }>()

export function resetThoughtSignatureStore(): void {
  signatureByToolCallId.clear()
  pendingByIndex.clear()
}

/**
 * 从任意 OpenAI Chat 响应体中提取 thought_signature 并暂存。
 * 兼容流式（data 里带 delta.tool_calls，支持跨帧累积）与非流式（message.tool_calls）。
 * 传入的 payload 可以是完整响应对象，也可以是单个 choices[0] 对象。
 */
export function captureThoughtSignatures(payload: unknown): void {
  const choice = readChoice(payload)
  if (!choice) return

  const message = choice.message
  if (isRecord(message) && Array.isArray(message.tool_calls)) {
    // 非流式：整组 tool_calls 一次返回。
    captureCompleteToolCalls(message.tool_calls)
    return
  }

  const delta = choice.delta
  if (isRecord(delta) && Array.isArray(delta.tool_calls)) {
    // 流式：按 index 跨帧累积。
    captureStreamingToolCallDeltas(delta.tool_calls)
  }
}

/** 非流式：每个 tool_call 都带有 id，直接按 id 暂存。 */
function captureCompleteToolCalls(toolCalls: unknown[]): void {
  for (const toolCall of toolCalls) {
    if (!isRecord(toolCall)) continue
    const id = toolCall.id
    if (typeof id !== 'string' || !id) continue
    const signature = readThoughtSignature(toolCall)
    if (signature) {
      signatureByToolCallId.set(id, signature)
    }
  }
}

/**
 * 流式：Gemini 会在 tool_call 的某一帧 delta 里携带 thought_signature，
 * 该帧可能带 id、也可能只有 index。按 index 累积，凑齐 id + signature 后再入 store。
 */
function captureStreamingToolCallDeltas(toolCallDeltas: unknown[]): void {
  for (const toolCallDelta of toolCallDeltas) {
    if (!isRecord(toolCallDelta)) continue
    const index = typeof toolCallDelta.index === 'number' ? toolCallDelta.index : -1
    const id = typeof toolCallDelta.id === 'string' ? toolCallDelta.id : ''
    const signature = readThoughtSignature(toolCallDelta)

    if (id && signature) {
      // 本帧已同时携带 id 与 signature，直接落库，无需累积。
      signatureByToolCallId.set(id, signature)
      pendingByIndex.delete(index)
      continue
    }

    if (index < 0) continue
    const pending = pendingByIndex.get(index) ?? { id: '', signature: '' }
    if (id) pending.id = id
    if (signature) pending.signature = signature
    if (pending.id && pending.signature) {
      signatureByToolCallId.set(pending.id, pending.signature)
      pendingByIndex.delete(index)
    } else {
      pendingByIndex.set(index, pending)
    }
  }
}

/**
 * 从一条 OpenAI Chat 的 tool_calls 元素（流式 delta 或非流式 message）中提取
 * `extra_content.google.thought_signature`。
 */
function readThoughtSignature(toolCall: unknown): string {
  if (!isRecord(toolCall)) return ''
  const extra = toolCall.extra_content
  if (!isRecord(extra)) return ''
  const google = extra.google
  if (!isRecord(google)) return ''
  const value = google.thought_signature
  return typeof value === 'string' && value.trim() ? value : ''
}

/** 从响应体中解析出 choices[0]（若直接传入的就是 choice 对象也能识别）。 */
function readChoice(payload: unknown): Record<string, unknown> | null {
  if (isRecord(payload) && Array.isArray(payload.choices) && isRecord(payload.choices[0])) {
    return payload.choices[0] as Record<string, unknown>
  }
  // 直接传入单帧 choice（如 `{"delta":{...}}` / `{"message":{...}}`）时也接受。
  if (isRecord(payload) && (isRecord(payload.delta) || isRecord(payload.message))) {
    return payload
  }
  return null
}

/**
 * 把暂存的 thought_signature 注入到请求体（OpenAI Chat messages）的 assistant tool_calls 中。
 * 修改是就地进行的；返回是否发生过注入，便于调用方决定是否重新序列化。
 */
export function injectThoughtSignaturesIntoMessages(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false

  let injected = false
  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'assistant') continue
    if (!Array.isArray(message.tool_calls)) continue
    for (const toolCall of message.tool_calls) {
      if (!isRecord(toolCall)) continue
      const id = toolCall.id
      if (typeof id !== 'string' || !id) continue
      const signature = signatureByToolCallId.get(id)
      if (!signature) continue

      // 构造 extra_content.google.thought_signature 并回填。
      const extra = isRecord(toolCall.extra_content) ? toolCall.extra_content : {}
      const google = isRecord(extra.google) ? extra.google : {}
      google.thought_signature = signature
      extra.google = google
      toolCall.extra_content = extra

      // 注入后即删除，避免跨会话/跨请求残留串扰。
      signatureByToolCallId.delete(id)
      injected = true
    }
  }
  return injected
}

/**
 * 请求侧：解析请求体并回填 thought_signature。
 * body 是 JSON 字符串时返回改写后的字符串；body 是对象时就地修改并返回原引用。
 * 返回 undefined 表示无需改写（非 JSON 或无需注入）。
 */
export function injectThoughtSignaturesIntoRequestBody(body: unknown): unknown {
  if (typeof body === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return undefined
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return undefined
    if (!injectThoughtSignaturesIntoMessages(parsed.messages)) return undefined
    return JSON.stringify(parsed)
  }

  if (isRecord(body) && Array.isArray(body.messages)) {
    injectThoughtSignaturesIntoMessages(body.messages)
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
