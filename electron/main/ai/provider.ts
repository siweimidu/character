import type { LanguageModel } from 'ai'
import type { AppSettings } from './shared-types'
import { isAnthropicProtocol, resolveAiProviderProtocol } from '@shared/ai-provider-catalog'
import { createProxyFetch } from './proxy-fetch'
import { createProviderTransportFetch } from './sse'
import { createProtocolModel } from './protocol-adapter'

const ANTHROPIC_PROMPT_CACHE = {
  type: 'ephemeral' as const,
  ttl: '5m' as const
}

function isOfficialOpenAIProvider(settings: AppSettings): boolean {
  return settings.provider === 'openai'
}

export function providerSupportsNativeStructuredOutput(settings: AppSettings): boolean {
  // Anthropic's SDK object streaming can produce an empty text stream or fail
  // object parsing for otherwise recoverable JSON tasks. Keep Claude JSON tasks
  // on the text path and let task normalizers/repair prompts handle the JSON.
  if (isAnthropicProtocol(settings.provider, settings.model, settings.apiProtocol)) return false
  return isOfficialOpenAIProvider(settings)
}

export function createModel(
  settings: AppSettings,
  options?: { requestFetch?: typeof fetch }
): LanguageModel {
  const requestFetch = options?.requestFetch ?? createProxyFetch(settings.proxyUrl)
  const customFetch = createProviderTransportFetch(requestFetch)
  return createProtocolModel({
    protocol: resolveAiProviderProtocol(settings.provider, settings.model, settings.apiProtocol),
    providerName: settings.provider === 'ollama' ? 'ollama' : settings.provider,
    model: settings.model,
    apiKey: settings.apiKey.trim(),
    baseUrl: settings.baseUrl || undefined,
    fetch: customFetch
  })
}

function buildRuntimeModelIdentity(settings: AppSettings): string {
  return [
    '【运行时模型信息】',
    `当前请求配置的供应商标识：${settings.provider}`,
    `当前请求配置的模型标识：${settings.model}`,
    '如果用户询问“你是什么模型”或类似问题，只能依据这里的运行时模型标识回答。不要沿用历史对话中其他模型的自我介绍，也不要把自己说成 Claude 或 Anthropic，除非这里的模型标识明确是 Claude。'
  ].join('\n')
}

export function buildSystemPrompt(settings: AppSettings, systemPrompt: string) {
  const promptWithIdentity = `${systemPrompt}\n\n${buildRuntimeModelIdentity(settings)}`
  if (!isAnthropicProtocol(settings.provider, settings.model, settings.apiProtocol)) {
    return promptWithIdentity
  }

  return {
    role: 'system' as const,
    content: promptWithIdentity,
    providerOptions: {
      anthropic: {
        cacheControl: ANTHROPIC_PROMPT_CACHE
      }
    }
  }
}

export function isToolUseNotSupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  const patterns = [
    'tools are not supported',
    'tool use is not supported',
    'does not support tools',
    'does not support function',
    'function calling is not supported',
    'tool_use is not supported',
    'tooluse is not supported',
    'unrecognized request argument.*tools',
    'invalid parameter.*tools',
    '不支持.*工具',
    '不支持.*tool',
    'thought_signature',
    '缺少 thought_signature',
    'functioncall.*thought_signature'
  ]
  return patterns.some((p) => new RegExp(p, 'i').test(msg))
}
