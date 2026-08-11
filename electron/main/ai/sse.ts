import { captureThoughtSignatures, injectThoughtSignaturesIntoRequestBody } from './thought-signature'

export function splitCompleteSseEvents(buffer: string): {
  events: string[]
  remainder: string
} {
  const events: string[] = []
  let remainder = buffer
  let delimiter: RegExpMatchArray | null

  while ((delimiter = remainder.match(/\r?\n\r?\n/)) !== null) {
    const end = (delimiter.index ?? 0) + delimiter[0].length
    events.push(remainder.slice(0, end))
    remainder = remainder.slice(end)
  }

  return { events, remainder }
}

const TERMINAL_SSE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message_stop',
  'response.completed',
  'response.failed',
  'response.incomplete'
])

/**
 * 判断一条完整 SSE event 是否已代表模型响应终止。
 * 部分兼容网关发完终止事件后会继续保持 HTTP 连接，不能依赖 EOF 收尾。
 */
export function isTerminalSseEvent(event: string): boolean {
  for (const line of event.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('event:')) {
      const eventType = trimmed.slice(6).trim().toLowerCase()
      if (TERMINAL_SSE_EVENT_TYPES.has(eventType)) return true
      continue
    }
    if (!trimmed.startsWith('data:')) continue

    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') return true
    if (!data.startsWith('{')) continue
    try {
      const parsed = JSON.parse(data) as {
        type?: unknown
        finish_reason?: unknown
        choices?: Array<{ finish_reason?: unknown }>
      }
      if (typeof parsed.type === 'string' && TERMINAL_SSE_EVENT_TYPES.has(parsed.type.toLowerCase())) {
        return true
      }
      // OpenAI Chat Completions 的最终数据帧已经携带 finish_reason。
      // 部分兼容网关随后直接关闭连接，不再补发 `data: [DONE]`。
      if (typeof parsed.finish_reason === 'string' && parsed.finish_reason.trim()) return true
      if (parsed.choices?.some((choice) => (
        typeof choice.finish_reason === 'string' && choice.finish_reason.trim().length > 0
      ))) return true
    } catch {
      // 非 JSON data 不是已知终止事件。
    }
  }
  return false
}

export function takeSseEventsThroughTerminal(events: string[]): {
  events: string[]
  terminalSeen: boolean
} {
  const terminalIndex = events.findIndex(isTerminalSseEvent)
  return terminalIndex < 0
    ? { events, terminalSeen: false }
    : { events: events.slice(0, terminalIndex + 1), terminalSeen: true }
}

export class AiStreamProtocolError extends Error {
  constructor() {
    super('AI 流式响应在完成事件到达前已断开，已保留收到的内容，但不会将其标记为完整回答。')
    this.name = 'AiStreamProtocolError'
  }
}

export function createTerminalAwareSseStream(
  source: ReadableStream<Uint8Array>,
  idleTimeoutMs = 0,
  transformEvent: (event: string) => string = (event) => event
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let settled = false

  return new ReadableStream({
    async pull(controller) {
      if (settled) return

      try {
        // 一个 SSE event 可能被拆成多个很小的网络 chunk。若尚未读到事件分隔符，
        // 必须在本次 pull 内继续读取；直接返回且没有 enqueue 会令下游永久停住。
        while (!settled) {
          const { done, value } = idleTimeoutMs > 0
            ? await readStreamChunkWithIdleTimeout(reader, idleTimeoutMs)
            : await reader.read()
          if (settled) return

          buffer += done
            ? decoder.decode()
            : decoder.decode(value, { stream: true })

          const split = splitCompleteSseEvents(buffer)
          const completeEvents = [...split.events]
          let remainder = split.remainder

          // A few gateways omit the final blank line. Accept an otherwise complete
          // terminal marker, but never accept an unterminated content event.
          if (done && remainder && isTerminalSseEvent(remainder)) {
            completeEvents.push(remainder)
            remainder = ''
          }

          const batch = takeSseEventsThroughTerminal(completeEvents)
          const output = batch.events.map(transformEvent).join('')
          if (output) controller.enqueue(encoder.encode(output))

          if (batch.terminalSeen) {
            settled = true
            buffer = ''
            controller.close()
            void reader.cancel('terminal SSE event received').catch(() => {})
            return
          }

          buffer = remainder
          if (done) {
            throw new AiStreamProtocolError()
          }
          if (output) return
        }
      } catch (error) {
        if (settled) return
        settled = true
        void reader.cancel(error).catch(() => {})
        controller.error(error)
      }
    },
    cancel(reason) {
      settled = true
      return reader.cancel(reason).catch(() => {})
    }
  })
}

export class AiStreamIdleTimeoutError extends Error {
  constructor(timeoutMs: number, phase: 'response-start' | 'stream-idle' = 'stream-idle') {
    super(phase === 'response-start'
      ? `AI 请求等待响应超过 ${Math.round(timeoutMs / 1000)} 秒，请检查网络、代理或接口限流状态。`
      : `AI 流式响应已连续 ${Math.round(timeoutMs / 1000)} 秒没有新数据。`)
    this.name = 'AiStreamIdleTimeoutError'
  }
}

export function isAiStreamIdleTimeoutError(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (!(current instanceof Error)) return false
    if (current.name === 'AiStreamIdleTimeoutError') return true
    current = (current as Error & { cause?: unknown }).cause
  }
  return false
}

export function readStreamChunkWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiStreamIdleTimeoutError(timeoutMs)), timeoutMs)
    reader.read().then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export async function fetchWithResponseStartTimeout(
  requestFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const timeoutController = new AbortController()
  const externalSignal = init?.signal ?? undefined
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutController.signal])
    : timeoutController.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeoutController.abort()
      reject(new AiStreamIdleTimeoutError(timeoutMs, 'response-start'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      requestFetch(input, { ...init, signal }),
      timeoutPromise
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 从一条完整 SSE event 的 data 帧中读取 JSON 载荷（首个 `data:` 行）。
 * 用于在透传的同时窥探 Gemini 的 thought_signature，不改变原始内容。
 */
export function parseSseEventJson(event: string): unknown | undefined {
  for (const line of event.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return undefined
    if (!data.startsWith('{')) return undefined
    try {
      return JSON.parse(data)
    } catch {
      return undefined
    }
  }
  return undefined
}

/** 是否可能承载 OpenAI Chat 的 choices（流式 delta 或非流式 message）。 */
function looksLikeChatResponse(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const record = payload as Record<string, unknown>
  return Array.isArray(record.choices)
}

/**
 * 为 AI SDK provider 增加 SSE 完成事件感知，并允许调用方按需显式启用超时。
 * 默认不按时间中止请求，由网络错误、协议结束事件或用户取消决定生命周期。
 *
 * 同时负责 Gemini thought_signature 的传输层修补：
 *  - 请求前把暂存的 thought_signature 注入到 assistant tool_calls；
 *  - 响应时从 tool_calls（流式 delta / 非流式 message）中捕获 thought_signature。
 */
export function createProviderTransportFetch(
  requestFetch: typeof fetch,
  idleTimeoutMs = 0,
  responseStartTimeoutMs = 0
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // 请求前回填 thought_signature（仅当请求体是 OpenAI Chat JSON）。
    let requestInit = init
    if (init?.body) {
      const rewritten = injectThoughtSignaturesIntoRequestBody(init.body)
      if (rewritten !== undefined && typeof rewritten === 'string') {
        requestInit = { ...init, body: rewritten }
      }
    }

    const response = responseStartTimeoutMs > 0
      ? await fetchWithResponseStartTimeout(requestFetch, input, requestInit, responseStartTimeoutMs)
      : await requestFetch(input, requestInit)
    if (!response.ok || !response.body) return response

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream')) {
      return new Response(createTerminalAwareSseStream(response.body, idleTimeoutMs, (event) => {
        const payload = parseSseEventJson(event)
        if (payload !== undefined && looksLikeChatResponse(payload)) {
          captureThoughtSignatures(payload)
        }
        return event
      }), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    }

    // 非流式 JSON 响应：读取并窥探 thought_signature 后重放，避免打断下游消费。
    if (contentType.includes('application/json')) {
      const text = await response.text()
      if (text) {
        try {
          const payload = JSON.parse(text)
          if (looksLikeChatResponse(payload)) {
            captureThoughtSignatures(payload)
          }
        } catch {
          // 非 JSON 或解析失败时直接透传原文。
        }
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        })
      }
    }

    return response
  }
}
