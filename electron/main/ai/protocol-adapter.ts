import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import {
  anthropicCompleteAdapter,
  createCustomProtocolModel,
  dashscopeNativeAdapter,
  koboldAdapter,
  novelAiAdapter
} from './custom-providers'

export type AiWireProtocol =
  | 'openai-responses'
  | 'openai-chat'
  | 'openai-completions'
  | 'anthropic'
  | 'anthropic-complete'
  | 'gemini'
  | 'kobold'
  | 'novelai'
  | 'dashscope-native'
  | 'volcengine-native'

export interface ProtocolModelOptions {
  protocol: AiWireProtocol
  providerName: string
  model: string
  apiKey: string
  baseUrl?: string
  fetch: typeof globalThis.fetch
}

/** 只有 Anthropic Messages / Gemini 原生走官方 SDK provider；其余走 OpenAI 兼容或自定义模型。 */
function createGeminiModel(options: ProtocolModelOptions): LanguageModel {
  const gemini = createGoogleGenerativeAI({
    apiKey: options.apiKey || undefined,
    baseURL: options.baseUrl || undefined,
    fetch: options.fetch
  })
  return gemini(options.model)
}

function createCustomModel(
  options: ProtocolModelOptions,
  adapter: Parameters<typeof createCustomProtocolModel>[0]['adapter'],
  provider: string
): LanguageModel {
  return createCustomProtocolModel({
    adapter,
    provider,
    modelId: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl || '',
    fetch: options.fetch
  }) as unknown as LanguageModel
}

/**
 * 多种线协议到开源 AI SDK provider / 自定义模型的唯一映射入口。
 * 这里不做模型判断、SSE 解析或产品级降级。
 */
export function createProtocolModel(options: ProtocolModelOptions): LanguageModel {
  const { protocol } = options

  // Anthropic Messages（现行原生协议）
  if (protocol === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl || undefined,
      fetch: options.fetch
    })
    return anthropic(options.model)
  }

  // Anthropic 废弃旧版 /v1/complete
  if (protocol === 'anthropic-complete') {
    return createCustomModel(options, anthropicCompleteAdapter, 'anthropic-complete')
  }

  // Google Gemini 原生 generateContent / streamGenerateContent
  if (protocol === 'gemini') {
    return createGeminiModel(options)
  }

  // OpenAI Responses（新一代协议）
  if (protocol === 'openai-responses') {
    const openai = createOpenAI({
      apiKey: options.apiKey || undefined,
      baseURL: options.baseUrl || undefined,
      fetch: options.fetch
    })
    return openai(options.model)
  }

  // OpenAI 废弃旧式 /v1/completions 文本补全
  if (protocol === 'openai-completions') {
    const openai = createOpenAI({
      apiKey: options.apiKey || undefined,
      baseURL: options.baseUrl || undefined,
      fetch: options.fetch
    })
    return openai.completion(options.model)
  }

  // KoboldCpp /api/v1/generate
  if (protocol === 'kobold') {
    return createCustomModel(options, koboldAdapter, 'kobold')
  }

  // NovelAI /v1/generate
  if (protocol === 'novelai') {
    return createCustomModel(options, novelAiAdapter, 'novelai')
  }

  // 阿里通义百炼原生 /api/v1/services/aigc/text-generation/generation
  if (protocol === 'dashscope-native') {
    return createCustomModel(options, dashscopeNativeAdapter, 'dashscope')
  }

  // 火山方舟原生 /ark/v1/chat/completions（OpenAI Chat 兼容格式）
  // 及 OpenAI Chat Completions（主流通用老协议），统一走 openai-compatible。
  const compatible = createOpenAICompatible({
    name: options.providerName,
    apiKey: options.apiKey || undefined,
    baseURL: options.baseUrl || 'https://api.openai.com/v1',
    fetch: options.fetch
  })
  return compatible.chatModel(options.model)
}
