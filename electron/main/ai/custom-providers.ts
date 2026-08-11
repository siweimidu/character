/**
 * 自定义线协议的通用 LanguageModel 工厂。
 *
 * 这类协议（Anthropic 废弃的 /v1/complete、KoboldCpp、NovelAI、阿里百炼原生等）
 * 都没有官方 AI SDK provider，但都属于“POST JSON → 返回文本”的单次生成型接口。
 * 这里用 request/response 适配器把各协议差异收敛到纯函数上，
 * 并统一实现 doGenerate（非流式）与 doStream（整包文本一次性下发，兼容流式调用方）。
 *
 * 返回对象在 protocol-adapter 中按 LanguageModelV2 结构使用，避免直接依赖
 * @ai-sdk/provider 的类型，从而不被传递依赖的解析问题影响构建。
 */

export interface CustomProtocolAdapter {
  /** 构造请求体。messages 为 AI SDK 标准化后的消息序列（role + content）。 */
  buildBody: (options: {
    messages: Array<{ role: string; content: string }>
    model: string
    maxTokens?: number
    temperature?: number
  }) => Record<string, unknown>
  /** 构造请求头。 */
  buildHeaders: (apiKey: string) => Record<string, string>
  /** 追加到 baseUrl 之后的完整路径。 */
  path: string
  /** 从 JSON 响应中提取生成文本。 */
  extractText: (data: unknown) => string
  /** 从 JSON 响应中提取 finishReason（'stop' | 'length' | ...）。 */
  extractFinishReason: (data: unknown) => string
  /** 从 JSON 响应中提取用量（可选）。 */
  extractUsage?: (data: unknown) => { inputTokens?: number; outputTokens?: number } | undefined
}

interface SimplePromptMessage {
  role: string
  content: string | Array<{ type?: string; text?: string }>
}

function textFromMessage(message: SimplePromptMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) => (part && typeof part === 'object' && part.type === 'text' ? part.text ?? '' : ''))
    .join('')
}

/** 把消息序列序列化成文本提示词（用于仅接受 prompt 文本的协议）。 */
function serializePromptToText(prompt: SimplePromptMessage[]): string {
  return prompt
    .map((message) => `${message.role.toUpperCase()}: ${textFromMessage(message)}`)
    .join('\n\n')
}

function estimateTokens(text: string): number {
  // 中文/英文混合粗略估算：约 1 token ≈ 1.5 个字符。
  return Math.max(0, Math.round(text.length / 1.5))
}

/**
 * 构建一个单次生成的 LanguageModelV2 结构对象。
 */
export function createCustomProtocolModel(options: {
  adapter: CustomProtocolAdapter
  provider: string
  modelId: string
  apiKey: string
  baseUrl: string
  fetch: typeof globalThis.fetch
}): Record<string, unknown> {
  const { adapter, provider, modelId, apiKey, baseUrl, fetch: doFetch } = options
  const url = `${baseUrl.replace(/\/+$/, '')}${adapter.path}`

  async function request(
    prompt: SimplePromptMessage[],
    maxTokens: number | undefined,
    temperature: number | undefined,
    signal: AbortSignal | undefined
  ): Promise<{ data: unknown; status: number; statusText: string }> {
    const body = adapter.buildBody({
      messages: prompt.map((message) => ({ role: message.role, content: textFromMessage(message) })),
      model: modelId,
      maxTokens,
      temperature
    })
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...adapter.buildHeaders(apiKey)
    }
    const response = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })
    const text = await response.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!response.ok) {
      throw new Error(
        `${provider} 请求失败：HTTP ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 300)}` : ''}`
      )
    }
    return { data, status: response.status, statusText: response.statusText }
  }

  return {
    specificationVersion: 'v2',
    provider,
    modelId,
    supportedUrls: {},
    doGenerate: async (callOptions: {
      prompt: SimplePromptMessage[]
      maxOutputTokens?: number
      temperature?: number
      abortSignal?: AbortSignal
    }) => {
      const { data } = await request(
        callOptions.prompt,
        callOptions.maxOutputTokens,
        callOptions.temperature,
        callOptions.abortSignal
      )
      const text = adapter.extractText(data)
      const outputTokens = adapter.extractUsage?.(data)?.outputTokens ?? estimateTokens(text)
      return {
        content: [{ type: 'text', text }],
        finishReason: adapter.extractFinishReason(data),
        usage: {
          inputTokens: adapter.extractUsage?.(data)?.inputTokens ?? estimateTokens(serializePromptToText(callOptions.prompt)),
          outputTokens,
          totalTokens: undefined
        },
        warnings: [],
        response: { id: `${provider}-${Date.now()}` }
      }
    },
    doStream: async (callOptions: {
      prompt: SimplePromptMessage[]
      maxOutputTokens?: number
      temperature?: number
      abortSignal?: AbortSignal
    }) => {
      const { data } = await request(
        callOptions.prompt,
        callOptions.maxOutputTokens,
        callOptions.temperature,
        callOptions.abortSignal
      )
      const text = adapter.extractText(data)
      const finishReason = adapter.extractFinishReason(data)
      const id = 'chunk-1'
      const parts = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id },
        { type: 'text-delta', id, delta: text },
        { type: 'text-end', id },
        {
          type: 'finish',
          finishReason,
          usage: {
            inputTokens: undefined,
            outputTokens: estimateTokens(text),
            totalTokens: undefined
          }
        }
      ]
      return {
        stream: new ReadableStream<Record<string, unknown>>({
          start(controller) {
            for (const part of parts) controller.enqueue(part)
            controller.close()
          }
        }),
        response: { id: `${provider}-${Date.now()}` }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 具体协议适配器
// ─────────────────────────────────────────────────────────────────────────────

/** Anthropic 废弃版 /v1/complete（旧版 text completion）。 */
export const anthropicCompleteAdapter: CustomProtocolAdapter = {
  path: '/complete',
  buildHeaders: (apiKey) => ({
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  }),
  buildBody: ({ messages, model, maxTokens, temperature }) => ({
    model,
    prompt: serializePromptToText(messages),
    max_tokens_to_sample: maxTokens ?? 4096,
    ...(temperature !== undefined ? { temperature } : {})
  }),
  extractText: (data) =>
    data && typeof data === 'object' ? String((data as { completion?: unknown }).completion ?? '') : '',
  extractFinishReason: (data) => {
    const stop = data && typeof data === 'object' ? (data as { stop_reason?: unknown }).stop_reason : undefined
    return typeof stop === 'string' && /max|length/i.test(stop) ? 'length' : 'stop'
  }
}

/** KoboldCpp /api/v1/generate（非流式）或 /api/v1/stream。 */
export const koboldAdapter: CustomProtocolAdapter = {
  path: '/api/v1/generate',
  buildHeaders: () => ({}),
  buildBody: ({ messages, maxTokens, temperature }) => ({
    prompt: serializePromptToText(messages),
    max_length: maxTokens ?? 512,
    ...(temperature !== undefined ? { temperature } : {})
  }),
  extractText: (data) => {
    if (data && typeof data === 'object') {
      const results = (data as { results?: Array<{ text?: unknown }> }).results
      if (Array.isArray(results) && results[0] && typeof results[0].text === 'string') {
        return results[0].text
      }
      const text = (data as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
    return ''
  },
  extractFinishReason: () => 'stop'
}

/** NovelAI /v1/generate（文本生成，返回 output 或 tokens）。 */
export const novelAiAdapter: CustomProtocolAdapter = {
  path: '/v1/generate',
  buildHeaders: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
  buildBody: ({ messages, model, maxTokens, temperature }) => ({
    input: serializePromptToText(messages),
    model,
    parameters: {
      max_length: maxTokens ?? 300,
      ...(temperature !== undefined ? { temperature } : {})
    }
  }),
  extractText: (data) => {
    if (data && typeof data === 'object') {
      const text = (data as { output?: unknown }).output
      if (typeof text === 'string') return text
      const tokens = (data as { output?: { tokens?: Array<{ text?: string }> } }).output?.tokens
      if (Array.isArray(tokens)) {
        return tokens.map((t) => t.text ?? '').join('')
      }
    }
    return ''
  },
  extractFinishReason: () => 'stop'
}

/** 阿里通义百炼原生 /api/v1/services/aigc/text-generation/generation。 */
export const dashscopeNativeAdapter: CustomProtocolAdapter = {
  path: '/api/v1/services/aigc/text-generation/generation',
  buildHeaders: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
  buildBody: ({ messages, model, maxTokens, temperature }) => ({
    model,
    input: {
      messages: messages.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: typeof message.content === 'string' ? message.content : textFromMessage(message)
      }))
    },
    parameters: {
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {})
    }
  }),
  extractText: (data) => {
    if (data && typeof data === 'object') {
      const output = (data as { output?: { text?: unknown } }).output
      if (output && typeof output.text === 'string') return output.text
    }
    return ''
  },
  extractFinishReason: (data) => {
    if (data && typeof data === 'object') {
      const output = (data as { output?: { finish_reason?: unknown } }).output
      if (output && typeof output.finish_reason === 'string' && /length|max/i.test(output.finish_reason)) {
        return 'length'
      }
    }
    return 'stop'
  },
  extractUsage: (data) => {
    const usage = data && typeof data === 'object' ? (data as { usage?: unknown }).usage : undefined
    if (usage && typeof usage === 'object') {
      const u = usage as { input_tokens?: number; output_tokens?: number }
      return {
        inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : undefined,
        outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : undefined
      }
    }
    return undefined
  }
}
