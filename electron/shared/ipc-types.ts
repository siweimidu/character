export interface IpcResult<T = void> {
  success: boolean
  error?: string
  result?: T
}

export interface IpcPayloadResult<T = unknown> {
  success: boolean
  error?: string
  payload?: T
}

export interface AppSettingsPayload {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  apiProtocol?: 'auto' | 'openai-responses' | 'openai-chat' | 'openai-completions' | 'anthropic' | 'anthropic-complete' | 'gemini' | 'kobold' | 'novelai' | 'dashscope-native' | 'volcengine-native'
  proxyUrl: string
  temperature?: number
  topP?: number
  aiProfiles: Array<{ id: string; name: string; provider: string; baseUrl: string; apiKey: string; model: string; models?: string[]; apiProtocol?: 'auto' | 'openai-responses' | 'openai-chat' | 'openai-completions' | 'anthropic' | 'anthropic-complete' | 'gemini' | 'kobold' | 'novelai' | 'dashscope-native' | 'volcengine-native'; temperature?: number; topP?: number }>
  activeAiProfileId: string
  imageProvider: string
  imageModel: string
  imageApiKey: string
  imageBaseUrl: string
  autoSaveInterval: string
  uiScale: number
  darkMode: boolean
  darkModeStyle: string
}

export interface SaveAppSettingsRequest {
  theme: string
  selectedProjectId: string
  appSettings: AppSettingsPayload
}

export const IPC_CHANNELS = {
  LOAD_WORKSPACE: 'characterarc:load-workspace',
  SAVE_WORKSPACE: 'characterarc:save-workspace',
  SAVE_APP_SETTINGS: 'characterarc:save-app-settings'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]
