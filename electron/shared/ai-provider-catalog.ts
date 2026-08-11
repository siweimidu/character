export type AiProviderProtocol =
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
export type AiProtocolPreference = 'auto' | AiProviderProtocol

export interface AiProviderCatalogEntry {
  label: string
  value: string
  protocol: AiProviderProtocol
  baseUrl: string
  model: string
  customBaseUrl: boolean
  supportsEmbedding: boolean
  hint: string
}

export const AI_PROVIDER_CATALOG: readonly AiProviderCatalogEntry[] = [
  { label: 'OpenAI', value: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', model: '', customBaseUrl: false, supportsEmbedding: true, hint: '官方接口，填写 API Key 后即可使用，也可拉取账号可用模型。' },
  { label: 'Anthropic', value: 'anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'Claude 官方接口，使用 Anthropic Messages 协议。' },
  { label: 'DeepSeek', value: 'deepseek', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'DeepSeek 官方接口，支持 deepseek-chat 和 deepseek-reasoner。' },
  { label: '阿里云百炼（通义千问）', value: 'qwen', protocol: 'openai-chat', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '', customBaseUrl: false, supportsEmbedding: true, hint: '阿里云百炼 OpenAI 兼容接口。' },
  { label: '智谱 BigModel', value: 'zhipu', protocol: 'openai-chat', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '', customBaseUrl: false, supportsEmbedding: true, hint: '智谱官方 OpenAI 兼容接口。' },
  { label: 'Moonshot（月之暗面）', value: 'moonshot', protocol: 'openai-chat', baseUrl: 'https://api.moonshot.cn/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'Moonshot 官方 OpenAI 兼容接口。' },
  { label: 'SiliconFlow（硅基流动）', value: 'siliconflow', protocol: 'openai-chat', baseUrl: 'https://api.siliconflow.cn/v1', model: '', customBaseUrl: false, supportsEmbedding: true, hint: '硅基流动官方接口，填写 Key 后拉取可用模型。' },
  { label: 'OpenRouter', value: 'openrouter', protocol: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'OpenRouter 聚合接口，可拉取其提供的模型列表。' },
  { label: 'Groq', value: 'groq', protocol: 'openai-chat', baseUrl: 'https://api.groq.com/openai/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'Groq 官方 OpenAI 兼容接口。' },
  { label: 'Mistral AI', value: 'mistral', protocol: 'openai-chat', baseUrl: 'https://api.mistral.ai/v1', model: '', customBaseUrl: false, supportsEmbedding: true, hint: 'Mistral 官方 OpenAI 兼容接口。' },
  { label: 'xAI', value: 'xai', protocol: 'openai-chat', baseUrl: 'https://api.x.ai/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'xAI 官方 OpenAI 兼容接口。' },
  { label: 'Google Gemini', value: 'gemini', protocol: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'Google 官方 OpenAI 兼容入口。' },
  { label: '火山方舟', value: 'volcengine', protocol: 'openai-chat', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', customBaseUrl: false, supportsEmbedding: false, hint: '火山方舟官方接口，模型名称请填写推理接入点 ID。' },
  { label: '腾讯混元 Hunyuan', value: 'hunyuan', protocol: 'openai-chat', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: '', customBaseUrl: false, supportsEmbedding: true, hint: '腾讯混元官方 OpenAI 兼容接口。' },
  { label: '百度千帆 Qianfan', value: 'qianfan', protocol: 'openai-chat', baseUrl: 'https://qianfan.baidubce.com/v2', model: '', customBaseUrl: false, supportsEmbedding: false, hint: '百度千帆 OpenAI 兼容接口（v2 兼容模式）。' },
  { label: 'MiniMax', value: 'minimax', protocol: 'openai-chat', baseUrl: 'https://api.minimax.chat/v1', model: '', customBaseUrl: false, supportsEmbedding: true, hint: 'MiniMax 官方 OpenAI 兼容接口，支持 abab 系列模型。' },
  { label: '阶跃星辰 StepFun', value: 'stepfun', protocol: 'openai-chat', baseUrl: 'https://api.stepfun.com/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: '阶跃星辰官方 OpenAI 兼容接口，支持 step-2 系列。' },
  { label: '零一万物 Yi', value: 'lingyiwanwu', protocol: 'openai-chat', baseUrl: 'https://api.lingyiwanwu.com/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: '零一万物 Yi 官方 OpenAI 兼容接口。' },
  { label: '百川智能 Baichuan', value: 'baichuan', protocol: 'openai-chat', baseUrl: 'https://api.baichuan-ai.com/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: '百川智能官方 OpenAI 兼容接口。' },
  { label: '昆仑万维天工', value: 'tiangong', protocol: 'openai-chat', baseUrl: 'https://api.tiangong.tech/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: '昆仑万维天工官方 OpenAI 兼容接口。' },
  { label: 'NVIDIA NIM', value: 'nvidia', protocol: 'openai-chat', baseUrl: 'https://integrate.api.nvidia.com/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'NVIDIA NIM 推理平台 OpenAI 兼容接口。' },
  { label: 'Together AI', value: 'together', protocol: 'openai-chat', baseUrl: 'https://api.together.xyz/v1', model: '', customBaseUrl: false, supportsEmbedding: true, hint: 'Together AI 聚合接口，支持海量开源模型。' },
  { label: 'Fireworks AI', value: 'fireworks', protocol: 'openai-chat', baseUrl: 'https://api.fireworks.ai/inference/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'Fireworks AI 高性能推理 OpenAI 兼容接口。' },
  { label: 'Cerebras', value: 'cerebras', protocol: 'openai-chat', baseUrl: 'https://api.cerebras.ai/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'Cerebras 超高速推理 OpenAI 兼容接口。' },
  { label: 'Perplexity', value: 'perplexity', protocol: 'openai-chat', baseUrl: 'https://api.perplexity.ai', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'Perplexity 官方 OpenAI 兼容接口。' },
  { label: 'Midjourney 中转（通用）', value: 'mj-proxy', protocol: 'openai-chat', baseUrl: '', model: '', customBaseUrl: true, supportsEmbedding: false, hint: '各类 Midjourney 第三方中转站，填写其 OpenAI 兼容 Base URL。' },
  { label: 'One-API / New-API（自建中转）', value: 'one-api', protocol: 'openai-chat', baseUrl: 'http://localhost:3000', model: '', customBaseUrl: true, supportsEmbedding: true, hint: 'One-API / New-API 等自建多模型中转站，支持聚合各家模型，默认端口 3000。' },
  { label: 'OpenCode Go', value: 'opencode-go', protocol: 'openai-chat', baseUrl: 'https://opencode.ai/zen/go/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: 'Go 订阅接口，自动按模型选择 Responses、Messages 或 Chat Completions 协议。' },
  { label: 'OpenCode Zen', value: 'opencode-zen', protocol: 'openai-chat', baseUrl: 'https://opencode.ai/zen/v1', model: '', customBaseUrl: false, supportsEmbedding: false, hint: '自动按模型选择 Responses、Messages 或 Chat Completions 协议。' },
  { label: 'Ollama（本地）', value: 'ollama', protocol: 'openai-chat', baseUrl: 'http://localhost:11434/v1', model: '', customBaseUrl: false, supportsEmbedding: true, hint: '本地 Ollama 服务，不需要 API Key。' },
  { label: 'LiteLLM（本地路由）', value: 'litellm', protocol: 'openai-chat', baseUrl: 'http://localhost:4000/v1', model: '', customBaseUrl: true, supportsEmbedding: false, hint: 'LiteLLM 本地模型路由（OpenAI 兼容），默认端口 4000，可在 /v1 拉取代理后的模型列表。' },
  { label: 'OmniRouter（本地路由）', value: 'omnirouter', protocol: 'openai-chat', baseUrl: 'http://localhost:20128/v1/models', model: '', customBaseUrl: true, supportsEmbedding: false, hint: 'OmniRouter 本地模型路由（OpenAI 兼容），默认端口 20128，可在此拉取路由后的模型列表。' },
  { label: 'OmniRoute（本地路由·旧版）', value: 'omniroute', protocol: 'openai-chat', baseUrl: 'http://localhost:3000/v1', model: '', customBaseUrl: true, supportsEmbedding: false, hint: 'OmniRoute 本地模型路由旧版默认端口 3000，兼容历史配置。' },
  { label: 'FreeLLMAPI（本地路由）', value: 'freellmapi', protocol: 'openai-chat', baseUrl: 'http://localhost:3001/v1', model: '', customBaseUrl: true, supportsEmbedding: false, hint: 'FreeLLMAPI 本地模型网关（OpenAI 兼容），默认端口 3001，可在 /v1 拉取可用模型。' },
  { label: '自定义 OpenAI 兼容接口', value: 'openai-compatible', protocol: 'openai-chat', baseUrl: '', model: '', customBaseUrl: true, supportsEmbedding: true, hint: '填写完整 API Base URL，例如 https://example.com/v1。' },
  { label: '自定义 Anthropic 兼容接口', value: 'anthropic-compatible', protocol: 'anthropic', baseUrl: '', model: '', customBaseUrl: true, supportsEmbedding: false, hint: '填写完整 API Base URL，系统将通过 Messages 协议调用。' }
]

export function getAiProviderCatalogEntry(provider: string): AiProviderCatalogEntry | undefined {
  const normalized = provider.trim().toLowerCase()
  return AI_PROVIDER_CATALOG.find((item) => item.value === normalized)
}

const KNOWN_ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/messages',
  '/responses',
  '/embeddings',
  '/models',
  '/images/generations'
]

function stripKnownEndpointSuffix(baseUrl: string): string {
  const lower = baseUrl.toLowerCase()
  const suffix = KNOWN_ENDPOINT_SUFFIXES.find((item) => lower.endsWith(item))
  return suffix ? baseUrl.slice(0, -suffix.length) : baseUrl
}

export function isOpenCodeZenBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/opencode\.ai\/zen(?!(?:\/go)(?:\/|$))(?:\/|$)/i.test(baseUrl.trim())
}

export function isOpenCodeGoBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/opencode\.ai\/zen\/go(?:\/|$)/i.test(baseUrl.trim())
}

export function isOpenCodeProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase()
  return normalized === 'opencode-go' || normalized === 'opencode-zen'
}

export function normalizeAiProviderName(provider: string, baseUrl: string): string {
  const normalized = provider.trim().toLowerCase() || 'openai-compatible'
  if (isOpenCodeGoBaseUrl(baseUrl)) return 'opencode-go'
  return isOpenCodeZenBaseUrl(baseUrl) ? 'opencode-zen' : normalized
}

export function normalizeAiBaseUrl(provider: string, rawBaseUrl: string): string {
  let baseUrl = stripKnownEndpointSuffix(rawBaseUrl.trim().replace(/\/+$/, ''))
  if (!baseUrl) return ''

  if (provider === 'opencode-go' || isOpenCodeGoBaseUrl(baseUrl)) {
    return baseUrl.replace(/\/zen\/go(?:\/v1)?$/i, '/zen/go/v1')
  }

  if (provider === 'opencode-zen' || isOpenCodeZenBaseUrl(baseUrl)) {
    return baseUrl.replace(/\/zen(?:\/v1)?$/i, '/zen/v1')
  }

  if (provider === 'zhipu' || /(^|\.)open\.bigmodel\.cn(\/|$)/i.test(baseUrl)) {
    return baseUrl.replace(/\/v1$/i, '')
  }

  let path = ''
  try {
    path = new URL(baseUrl).pathname.replace(/\/+$/, '')
  } catch {
    // 非标准地址交给请求层返回更具体的错误。
  }
  return !path && !/\/v\d+$/i.test(baseUrl) ? `${baseUrl}/v1` : baseUrl
}

const AI_PROTOCOL_VALUES: readonly AiProviderProtocol[] = [
  'openai-responses',
  'openai-chat',
  'openai-completions',
  'anthropic',
  'anthropic-complete',
  'gemini',
  'kobold',
  'novelai',
  'dashscope-native',
  'volcengine-native'
]

export function normalizeAiProtocolPreference(value: unknown): AiProtocolPreference {
  return AI_PROTOCOL_VALUES.includes(value as AiProviderProtocol) ? (value as AiProviderProtocol) : 'auto'
}

export function resolveAiProviderProtocol(
  provider: string,
  model = '',
  preference: AiProtocolPreference = 'auto'
): AiProviderProtocol {
  if (preference !== 'auto') return preference
  const normalizedProvider = provider.trim().toLowerCase()
  const normalizedModel = model.trim().toLowerCase()

  if (normalizedProvider === 'opencode-go') {
    if (/^gpt-5\.6-luna(?:[.-]|$)/.test(normalizedModel)) return 'openai-responses'
    if (/^(minimax-|qwen3(?:[.-]|$))/.test(normalizedModel)) return 'anthropic'
    return 'openai-chat'
  }

  if (normalizedProvider === 'opencode-zen') {
    if (/^(claude-|qwen3(?:[.-]|$))/.test(normalizedModel)) return 'anthropic'
    if (/^(gpt-|grok-)/.test(normalizedModel)) return 'openai-responses'
    return 'openai-chat'
  }

  return getAiProviderCatalogEntry(normalizedProvider)?.protocol ?? 'openai-chat'
}

export function isAnthropicProtocol(
  provider: string,
  model = '',
  preference: AiProtocolPreference = 'auto'
): boolean {
  return resolveAiProviderProtocol(provider, model, preference) === 'anthropic'
}

export function isOpenAIChatProtocol(
  provider: string,
  model = '',
  preference: AiProtocolPreference = 'auto'
): boolean {
  return resolveAiProviderProtocol(provider, model, preference) === 'openai-chat'
}

export function shouldTryStreamingAgent(
  task: string,
  provider: string,
  model: string,
  protocol: AiProtocolPreference = 'auto'
): boolean {
  if (task === 'global-assistant') return true
  if (task !== 'chapter-first-draft') return false

  // OpenCode Chat 长正文保持单次流式生成；全局助手仍使用标准 tools Agent。
  return !(isOpenCodeProvider(provider) && isOpenAIChatProtocol(provider, model, protocol))
}

export function isSupportedProviderModel(provider: string, model: string): boolean {
  if (provider.trim().toLowerCase() !== 'opencode-zen') return true
  return !model.trim().toLowerCase().startsWith('gemini-')
}
