<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Activity, Copy, Cpu, Download, ExternalLink, FileInput, Image, MonitorCog, Moon, Network, Palette, PlugZap, Plus, RefreshCw, ScanEye, Trash2 } from 'lucide-vue-next'
import { NButton, NFormItem, NInput, NInputNumber, NModal, NSelect, NSlider, NSwitch, useMessage } from 'naive-ui'
import { autoSaveOptions } from '@/features/settings/autoSave'
import { getProviderPreset, providerOptions, resolveProviderDefaults } from '@/features/settings/providerPresets'
import { AI_PROVIDER_CATALOG } from '@shared/ai-provider-catalog'
import { imageProviderOptions, resolveImageProviderDefaults, resolveImageProviderWebsite } from '@/features/settings/imageProviderPresets'
import { visionProviderOptions, resolveVisionProviderDefaults, resolveVisionProviderWebsite } from '@/features/settings/visionProviderPresets'
import { useAppStore } from '@/stores/app'
import { darkModePresets, themePresets } from '@/theme/presets'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AiProfile, AppSettings, DarkModeStyle, ImageProfile, ThemeName, VisionProfile } from '@/types/app'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

// 根据主题主色亮度自动选择对比度更高的文字颜色（深色主色用白字，浅色主色用深字）
/** 点击主题色卡即立即切换并持久化，无需再点保存设置 */
function applyThemeImmediately(themeName: ThemeName): void {
  draftTheme.value = themeName
  appStore.setTheme(themeName)
}

/** 深色模式开关即时生效并持久化，无需再点保存设置 */
function applyDarkModeImmediately(value: boolean): void {
  draftSettings.darkMode = value
  appStore.updateAppSetting('darkMode', value, { flushWorkspace: false })
}

/** 调节主题主色深浅（即时生效），替换旧的纸质纹理强度滑动条 */
function setThemeColorIntensity(value: number): void {
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
  // 即时更新内存状态并持久化，无需点保存设置即立即生效
  appStore.updateAppSetting('themeColorIntensity', safe, { flushWorkspace: false })
  // 同步草稿值，避免后续点「保存设置」时用旧值覆盖回退颜色深浅
  draftSettings.themeColorIntensity = safe
}

function themeTextColor(color: string): string {
  const match = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (!match) return '#ffffff'
  let hex = match[1]
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('')
  }
  const n = parseInt(hex, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.55 ? '#1f1f1f' : '#ffffff'
}

const appStore = useAppStore()
const message = useMessage()
const isTestingAiConnection = ref(false)
const isBenchmarkingModel = ref(false)
interface BenchmarkHistoryItem {
  model: string
  latencyMs: number
  tokensPerSec: number
  completionTokens: number
  promptTokens: number
  /** 记录时间（ISO 字符串） */
  at: string
}

/** 保留最近 N 条基准测试历史记录 */
const BENCHMARK_HISTORY_LIMIT = 5
const benchmarkHistory = ref<BenchmarkHistoryItem[]>([])

// ── 从 CC Switch 导入 ──
interface CcSwitchAiProfile {
  name: string
  type: string
  baseUrl: string
  apiKey: string
  model: string
  isCurrent: boolean
}
const isCcSwitchImporting = ref(false)
const ccSwitchImportOpen = ref(false)
const ccSwitchProfiles = ref<Array<CcSwitchAiProfile & { selected: boolean }>>([])
const ccSwitchConfigError = ref('')
const ccSwitchConfigPath = ref('')
const isTestingProxyConnection = ref(false)
const proxyTestIp = ref('')
const isFetchingModels = ref(false)
const fetchedModels = ref<Array<{ id: string; ownedBy: string | null }>>([])
const isFetchingImageModels = ref(false)
const fetchedImageModels = ref<Array<{ id: string; ownedBy: string | null }>>([])
const isTestingImageConnection = ref(false)
const isFetchingVisionModels = ref(false)
const fetchedVisionModels = ref<Array<{ id: string; ownedBy: string | null }>>([])
const isTestingVisionConnection = ref(false)
const isBenchmarkingVisionModel = ref(false)

const autoSaveSelectOptions = [...autoSaveOptions]
const uiScaleOptions = [
  { label: '75%', value: 0.75 },
  { label: '85%', value: 0.85 },
  { label: '100%', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 },
  { label: '140%', value: 1.4 }
]
const apiProtocolOptions = [
  { label: '自动（按厂商模型目录）', value: 'auto' },
  { label: 'OpenAI Responses (/v1/responses)', value: 'openai-responses' },
  { label: 'OpenAI Chat Completions (/v1/chat/completions)', value: 'openai-chat' },
  { label: 'OpenAI 文本补全 (/v1/completions 旧版)', value: 'openai-completions' },
  { label: 'Anthropic Messages (/v1/messages)', value: 'anthropic' },
  { label: 'Anthropic 旧版 (/v1/complete 已废弃)', value: 'anthropic-complete' },
  { label: 'Gemini 原生 (generateContent)', value: 'gemini' },
  { label: 'KoboldCpp (/api/v1/generate)', value: 'kobold' },
  { label: 'NovelAI (/v1/generate)', value: 'novelai' },
  { label: '阿里通义百炼原生', value: 'dashscope-native' },
  { label: '火山方舟原生 (/ark/v1/chat/completions)', value: 'volcengine-native' }
]

const draftSettings = reactive<AppSettings>({
  provider: '',
  model: '',
  apiKey: '',
  baseUrl: '',
  apiProtocol: 'auto',
  proxyUrl: '',
  temperature: undefined,
  topP: undefined,
  aiProfiles: [],
  activeAiProfileId: '',
  imageProvider: '',
  imageModel: '',
  imageApiKey: '',
  imageBaseUrl: '',
  imageProfiles: [],
  activeImageProfileId: '',
  visionProfileName: '',
  visionProvider: '',
  visionModel: '',
  visionApiKey: '',
  visionBaseUrl: '',
  visionProfiles: [],
  activeVisionProfileId: '',
  visionSavedModels: [],
  autoSaveInterval: '5m',
  editorFont: 'clear-mono',
  editorMinimap: false,
  uiScale: 1,
  darkMode: false,
  darkModeStyle: 'nord',
  aiTimeoutSeconds: 180,
  themeColorIntensity: 0.5
})
const draftTheme = ref<ThemeName>('ocean')
const editingProfileId = ref<string>('')
const editingImageProfileId = ref<string>('')
const editingVisionProfileId = ref<string>('')

const editingProfile = computed<AiProfile | undefined>(() =>
  draftSettings.aiProfiles.find((p) => p.id === editingProfileId.value)
)
const editingImageProfile = computed<ImageProfile | undefined>(() =>
  draftSettings.imageProfiles.find((p) => p.id === editingImageProfileId.value)
)
const editingVisionProfile = computed<VisionProfile | undefined>(() =>
  draftSettings.visionProfiles.find((p) => p.id === editingVisionProfileId.value)
)
const isEditingActiveProfile = computed(
  () => editingProfileId.value === draftSettings.activeAiProfileId
)
const isEditingActiveImageProfile = computed(
  () => editingImageProfileId.value === draftSettings.activeImageProfileId
)
const isEditingActiveVisionProfile = computed(
  () => editingVisionProfileId.value === draftSettings.activeVisionProfileId
)

const scrollContainer = ref<HTMLElement | null>(null)
const activeNav = ref('sec-ai')
const navItems = [
  { id: 'sec-ai', label: 'AI 接口配置', icon: Cpu },
  { id: 'sec-network', label: '网络代理', icon: Network },
  { id: 'sec-image', label: '图片生成配置', icon: Image },
  { id: 'sec-vision', label: '图片识别配置', icon: ScanEye },
  { id: 'sec-theme', label: '界面主题', icon: Palette },
  { id: 'sec-prefs', label: '应用偏好', icon: MonitorCog }
]

function scrollToSection(id: string): void {
  activeNav.value = id
  const el = document.getElementById(id)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleScroll(): void {
  const container = scrollContainer.value
  if (!container) return
  const sections = container.querySelectorAll<HTMLElement>('.settings-section')
  for (const section of sections) {
    const rect = section.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    if (rect.top - containerRect.top < 80) {
      activeNav.value = section.id
    }
  }
}

const activeProviderPreset = computed(() => getProviderPreset(editingProfile.value?.provider ?? draftSettings.provider))
const activeProviderHomepage = computed(() => activeProviderPreset.value.homepage || '')

function openProviderHomepage(): void {
  const url = activeProviderHomepage.value
  if (url) void window.characterArc.openExternalUrl(url)
}

function handleCopyProviderHomepage(): void {
  const url = activeProviderHomepage.value
  if (!url) return
  void navigator.clipboard.writeText(url).then(() => {
    message.success(`已复制 ${activeProviderPreset.value.label} 官网链接`)
  }).catch(() => {
    message.error('复制失败，请手动复制')
  })
}

/** 导出所有模型厂商官网到 Excel：一行一个，格式为「厂商名 + 官网链接」 */
async function handleExportProvidersExcel(): Promise<void> {
  const rows = AI_PROVIDER_CATALOG
    .filter((item) => item.homepage)
    .map((item) => ({ provider: item.label, homepage: item.homepage }))
  if (rows.length === 0) {
    message.warning('暂无可导出的模型厂商官网。')
    return
  }
  try {
    const result = await window.characterArc.exportProvidersExcel({ data: rows })
    if (result.success) {
      message.success(`已导出 ${rows.length} 个模型厂商官网`)
    } else if (!result.canceled) {
      message.error(result.error ?? '导出失败')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败')
  }
}
const currentVersion = window.characterArc.version
const modelSelectOptions = computed(() =>
  fetchedModels.value.map((m) => ({ label: m.id, value: m.id }))
)
const imageModelSelectOptions = computed(() =>
  fetchedImageModels.value.map((m) => ({ label: m.id, value: m.id }))
)
const visionModelSelectOptions = computed(() =>
  fetchedVisionModels.value.map((m) => ({ label: m.id, value: m.id }))
)
function syncDraftFromStore(): void {
  draftSettings.provider = appStore.appSettings.provider
  draftSettings.model = appStore.appSettings.model
  draftSettings.apiKey = appStore.appSettings.apiKey
  draftSettings.baseUrl = appStore.appSettings.baseUrl
  draftSettings.apiProtocol = appStore.appSettings.apiProtocol ?? 'auto'
  draftSettings.proxyUrl = appStore.appSettings.proxyUrl
  proxyTestIp.value = ''
  draftSettings.temperature = appStore.appSettings.temperature
  draftSettings.topP = appStore.appSettings.topP
  draftSettings.aiProfiles = appStore.appSettings.aiProfiles.map((profile) => ({ ...profile }))
  draftSettings.activeAiProfileId = appStore.appSettings.activeAiProfileId
  draftSettings.imageProvider = appStore.appSettings.imageProvider
  draftSettings.imageModel = appStore.appSettings.imageModel
  draftSettings.imageApiKey = appStore.appSettings.imageApiKey
  draftSettings.imageBaseUrl = appStore.appSettings.imageBaseUrl
  draftSettings.imageProfiles = appStore.appSettings.imageProfiles.map((p) => ({ ...p }))
  draftSettings.activeImageProfileId = appStore.appSettings.activeImageProfileId
  draftSettings.visionProfileName = appStore.appSettings.visionProfileName
  draftSettings.visionProvider = appStore.appSettings.visionProvider
  draftSettings.visionModel = appStore.appSettings.visionModel
  draftSettings.visionApiKey = appStore.appSettings.visionApiKey
  draftSettings.visionBaseUrl = appStore.appSettings.visionBaseUrl
  draftSettings.visionProfiles = appStore.appSettings.visionProfiles.map((p) => ({ ...p }))
  draftSettings.activeVisionProfileId = appStore.appSettings.activeVisionProfileId
  draftSettings.visionSavedModels = [...(appStore.appSettings.visionSavedModels ?? [])]
  draftSettings.autoSaveInterval = appStore.appSettings.autoSaveInterval
  draftSettings.editorFont = appStore.appSettings.editorFont
  draftSettings.uiScale = appStore.appSettings.uiScale
  draftSettings.darkMode = appStore.appSettings.darkMode
  draftSettings.darkModeStyle = appStore.appSettings.darkModeStyle
  draftSettings.aiTimeoutSeconds = appStore.appSettings.aiTimeoutSeconds
  draftSettings.themeColorIntensity = appStore.appSettings.themeColorIntensity ?? 0.5
  draftTheme.value = appStore.theme
}

function handleProxyUrlChange(value: string): void {
  draftSettings.proxyUrl = value
  proxyTestIp.value = ''
}

async function handleTestProxyConnection(): Promise<void> {
  if (isTestingProxyConnection.value || !draftSettings.proxyUrl.trim()) return
  isTestingProxyConnection.value = true
  proxyTestIp.value = ''
  try {
    const result = await window.characterArc.testProxyConnection(draftSettings.proxyUrl)
    if (!result.success || !result.result?.ip) {
      throw new Error(result.error ?? '代理连接测试失败')
    }
    proxyTestIp.value = result.result.ip
    message.success(`代理连接成功，当前出口 IP：${result.result.ip}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '代理连接测试失败')
  } finally {
    isTestingProxyConnection.value = false
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      syncDraftFromStore()
      editingProfileId.value = draftSettings.activeAiProfileId || draftSettings.aiProfiles[0]?.id || ''
      editingImageProfileId.value = draftSettings.activeImageProfileId || draftSettings.imageProfiles[0]?.id || ''
      editingVisionProfileId.value = draftSettings.activeVisionProfileId || draftSettings.visionProfiles[0]?.id || ''
      fetchedModels.value = []
    }
  },
  { immediate: true }
)

function closeModal(): void {
  syncDraftFromStore()
  emit('update:show', false)
}

function selectProfile(profileId: string): void {
  editingProfileId.value = profileId
  fetchedModels.value = []
}

function generateProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function generateUniqueName(base: string): string {
  const existing = new Set(draftSettings.aiProfiles.map((p) => p.name))
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

function toOptionalNumber(value: number | null): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function handleAddProfile(): void {
  const id = generateProfileId()
  const defaults = resolveProviderDefaults('deepseek')
  const newProfile: AiProfile = {
    id,
    name: generateUniqueName('DeepSeek'),
    provider: 'deepseek',
    baseUrl: defaults.baseUrl,
    apiKey: '',
    model: defaults.model,
    models: defaults.model ? [defaults.model] : [],
    apiProtocol: 'auto',
    temperature: undefined,
    topP: undefined
  }
  draftSettings.aiProfiles.push(newProfile)
  editingProfileId.value = id
  fetchedModels.value = []
}

function handleCopyProfile(): void {
  if (!editingProfile.value) return
  const source = editingProfile.value
  const id = generateProfileId()
  const copy: AiProfile = {
    id,
    name: generateUniqueName(`${source.name} 副本`),
    provider: source.provider,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    model: source.model,
    models: Array.isArray(source.models) ? [...source.models] : (source.model ? [source.model] : []),
    apiProtocol: source.apiProtocol ?? 'auto',
    temperature: source.temperature,
    topP: source.topP
  }
  draftSettings.aiProfiles.push(copy)
  editingProfileId.value = id
  fetchedModels.value = []
}

function handleDeleteProfile(): void {
  if (!editingProfile.value) return
  if (isEditingActiveProfile.value) {
    message.warning('当前激活的接口不能删除，请先在标题栏切换到其他接口')
    return
  }
  if (draftSettings.aiProfiles.length <= 1) {
    message.warning('至少保留一个接口配置')
    return
  }
  const removingId = editingProfileId.value
  draftSettings.aiProfiles = draftSettings.aiProfiles.filter((p) => p.id !== removingId)
  editingProfileId.value = draftSettings.activeAiProfileId || draftSettings.aiProfiles[0]?.id || ''
  fetchedModels.value = []
}

// ── 图片生成接口配置（新建 / 复制 / 删除，与 AI 接口配置一致） ──
function selectImageProfile(profileId: string): void {
  editingImageProfileId.value = profileId
  const profile = editingImageProfile.value
  if (profile) {
    draftSettings.imageProvider = profile.provider
    draftSettings.imageModel = profile.model
    draftSettings.imageApiKey = profile.apiKey
    draftSettings.imageBaseUrl = profile.baseUrl
  }
  fetchedImageModels.value = []
}

function generateUniqueImageName(base: string): string {
  const existing = new Set(draftSettings.imageProfiles.map((p) => p.name))
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

function handleAddImageProfile(): void {
  const id = generateProfileId()
  const defaults = resolveImageProviderDefaults('custom-openai-compatible')
  const newProfile: ImageProfile = {
    id,
    name: generateUniqueImageName('图片生成配置'),
    provider: 'custom-openai-compatible',
    baseUrl: defaults.baseUrl,
    apiKey: '',
    model: defaults.model,
    models: defaults.model ? [defaults.model] : []
  }
  draftSettings.imageProfiles.push(newProfile)
  selectImageProfile(id)
}

function handleCopyImageProfile(): void {
  if (!editingImageProfile.value) return
  const source = editingImageProfile.value
  const id = generateProfileId()
  const copy: ImageProfile = {
    id,
    name: generateUniqueImageName(`${source.name} 副本`),
    provider: source.provider,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    model: source.model,
    models: Array.isArray(source.models) ? [...source.models] : (source.model ? [source.model] : [])
  }
  draftSettings.imageProfiles.push(copy)
  selectImageProfile(id)
}

function handleDeleteImageProfile(): void {
  if (!editingImageProfile.value) return
  if (isEditingActiveImageProfile.value) {
    message.warning('当前激活的图片生成接口不能删除，请先切换到其他配置')
    return
  }
  if (draftSettings.imageProfiles.length <= 1) {
    message.warning('至少保留一个图片生成接口配置')
    return
  }
  const removingId = editingImageProfileId.value
  draftSettings.imageProfiles = draftSettings.imageProfiles.filter((p) => p.id !== removingId)
  editingImageProfileId.value = draftSettings.activeImageProfileId || draftSettings.imageProfiles[0]?.id || ''
  selectImageProfile(editingImageProfileId.value)
}

function updateEditingImageProfile(updates: Partial<ImageProfile>): void {
  const profile = editingImageProfile.value
  if (!profile) return
  Object.assign(profile, updates)
  if (isEditingActiveImageProfile.value) {
    if (updates.provider !== undefined) draftSettings.imageProvider = updates.provider
    if (updates.model !== undefined) draftSettings.imageModel = updates.model
    if (updates.apiKey !== undefined) draftSettings.imageApiKey = updates.apiKey
    if (updates.baseUrl !== undefined) draftSettings.imageBaseUrl = updates.baseUrl
  }
}

function imageProfileModels(): string[] {
  return editingImageProfile.value?.models ?? []
}

function handleSaveImageProfileModel(): void {
  const profile = editingImageProfile.value
  if (!profile) return
  const model = profile.model?.trim()
  if (!model) {
    message.warning('请先填写图片模型名称后再保存。')
    return
  }
  const models = Array.isArray(profile.models) ? [...profile.models] : []
  if (!models.includes(model)) {
    models.push(model)
    updateEditingImageProfile({ models: models.slice(0, 50) })
    message.success(`已保存图片模型：${model}`)
  } else {
    message.info(`图片模型 ${model} 已在列表中。`)
  }
}

function handleRemoveImageProfileModel(model: string): void {
  const profile = editingImageProfile.value
  if (!profile) return
  updateEditingImageProfile({ models: (profile.models ?? []).filter((m) => m !== model) })
  if (profile.model === model) updateEditingImageProfile({ model: '' })
}

function handleApplyImageProfileModel(model: string): void {
  updateEditingImageProfile({ model })
  message.success(`已切换图片模型：${model}`)
}

// ── 图片识别接口配置（新建 / 复制 / 删除，与 AI 接口配置一致） ──
function selectVisionProfile(profileId: string): void {
  editingVisionProfileId.value = profileId
  const profile = editingVisionProfile.value
  if (profile) {
    draftSettings.visionProfileName = profile.name
    draftSettings.visionProvider = profile.provider
    draftSettings.visionModel = profile.model
    draftSettings.visionApiKey = profile.apiKey
    draftSettings.visionBaseUrl = profile.baseUrl
  }
  fetchedVisionModels.value = []
}

function generateUniqueVisionName(base: string): string {
  const existing = new Set(draftSettings.visionProfiles.map((p) => p.name))
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

function handleAddVisionProfile(): void {
  const id = generateProfileId()
  const defaults = resolveVisionProviderDefaults('vision-custom')
  const newProfile: VisionProfile = {
    id,
    name: generateUniqueVisionName('图片识别配置'),
    provider: 'vision-custom',
    baseUrl: defaults.baseUrl,
    apiKey: '',
    model: defaults.model,
    models: defaults.model ? [defaults.model] : []
  }
  draftSettings.visionProfiles.push(newProfile)
  selectVisionProfile(id)
}

function handleCopyVisionProfile(): void {
  if (!editingVisionProfile.value) return
  const source = editingVisionProfile.value
  const id = generateProfileId()
  const copy: VisionProfile = {
    id,
    name: generateUniqueVisionName(`${source.name} 副本`),
    provider: source.provider,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    model: source.model,
    models: Array.isArray(source.models) ? [...source.models] : (source.model ? [source.model] : [])
  }
  draftSettings.visionProfiles.push(copy)
  selectVisionProfile(id)
}

function handleDeleteVisionProfile(): void {
  if (!editingVisionProfile.value) return
  if (isEditingActiveVisionProfile.value) {
    message.warning('当前激活的图片识别接口不能删除，请先切换到其他配置')
    return
  }
  if (draftSettings.visionProfiles.length <= 1) {
    message.warning('至少保留一个图片识别接口配置')
    return
  }
  const removingId = editingVisionProfileId.value
  draftSettings.visionProfiles = draftSettings.visionProfiles.filter((p) => p.id !== removingId)
  editingVisionProfileId.value = draftSettings.activeVisionProfileId || draftSettings.visionProfiles[0]?.id || ''
  selectVisionProfile(editingVisionProfileId.value)
}

function updateEditingVisionProfile(updates: Partial<VisionProfile>): void {
  const profile = editingVisionProfile.value
  if (!profile) return
  Object.assign(profile, updates)
  if (isEditingActiveVisionProfile.value) {
    if (updates.name !== undefined) draftSettings.visionProfileName = updates.name
    if (updates.provider !== undefined) draftSettings.visionProvider = updates.provider
    if (updates.model !== undefined) draftSettings.visionModel = updates.model
    if (updates.apiKey !== undefined) draftSettings.visionApiKey = updates.apiKey
    if (updates.baseUrl !== undefined) draftSettings.visionBaseUrl = updates.baseUrl
  }
}

function visionProfileModels(): string[] {
  return editingVisionProfile.value?.models ?? []
}

function handleSaveVisionProfileModel(): void {
  const profile = editingVisionProfile.value
  if (!profile) return
  const model = profile.model?.trim()
  if (!model) {
    message.warning('请先填写图片识别模型名称后再保存。')
    return
  }
  const models = Array.isArray(profile.models) ? [...profile.models] : []
  if (!models.includes(model)) {
    models.push(model)
    updateEditingVisionProfile({ models: models.slice(0, 50) })
    message.success(`已保存图片识别模型：${model}`)
  } else {
    message.info(`图片识别模型 ${model} 已在列表中。`)
  }
}

function handleRemoveVisionProfileModel(model: string): void {
  const profile = editingVisionProfile.value
  if (!profile) return
  updateEditingVisionProfile({ models: (profile.models ?? []).filter((m) => m !== model) })
  if (profile.model === model) updateEditingVisionProfile({ model: '' })
}

function handleApplyVisionProfileModel(model: string): void {
  updateEditingVisionProfile({ model })
  message.success(`已切换图片识别模型：${model}`)
}

function updateEditingProfile(updates: Partial<AiProfile>): void {
  const profile = editingProfile.value
  if (!profile) return
  Object.assign(profile, updates)
  if (isEditingActiveProfile.value) {
    if (updates.provider !== undefined) draftSettings.provider = updates.provider
    if (updates.model !== undefined) draftSettings.model = updates.model
    if (updates.apiKey !== undefined) draftSettings.apiKey = updates.apiKey
    if (updates.baseUrl !== undefined) draftSettings.baseUrl = updates.baseUrl
    if (updates.apiProtocol !== undefined) draftSettings.apiProtocol = updates.apiProtocol
    if ('temperature' in updates) draftSettings.temperature = updates.temperature
    if ('topP' in updates) draftSettings.topP = updates.topP
  }
}

function handleProviderChange(provider: string): void {
  const defaults = resolveProviderDefaults(provider)
  updateEditingProfile({
    provider,
    model: defaults.model,
    baseUrl: defaults.baseUrl,
    apiProtocol: 'auto'
  })
  fetchedModels.value = []
}

function handleImageProviderChange(value: string): void {
  const defaults = resolveImageProviderDefaults(value)
  const updates: Partial<ImageProfile> = {
    provider: value,
    model: defaults.model,
    baseUrl: defaults.baseUrl
  }
  if (editingImageProfile.value) {
    updateEditingImageProfile(updates)
  } else {
    draftSettings.imageProvider = value
    draftSettings.imageModel = defaults.model
    draftSettings.imageBaseUrl = defaults.baseUrl
  }
  fetchedImageModels.value = []
}

async function handleFetchImageModels(): Promise<void> {
  if (isFetchingImageModels.value) return
  isFetchingImageModels.value = true
  try {
    const result = await window.characterArc.fetchImageModels(toIpcPayload({ ...draftSettings }))
    if (!result.success) throw new Error(result.error ?? '获取图片模型列表失败')
    fetchedImageModels.value = result.result ?? []
    if (fetchedImageModels.value.length === 0) {
      message.warning('该接口未返回任何可用图片模型，请手动输入模型名称。')
    } else {
      message.success(`获取到 ${fetchedImageModels.value.length} 个可用模型`)
    }
  } catch (error) {
    fetchedImageModels.value = []
    message.error(error instanceof Error ? error.message : '获取图片模型列表失败')
  } finally {
    isFetchingImageModels.value = false
  }
}

function handleVisionProviderChange(value: string): void {
  const defaults = resolveVisionProviderDefaults(value)
  const updates: Partial<VisionProfile> = {
    provider: value,
    model: defaults.model,
    baseUrl: defaults.baseUrl
  }
  if (editingVisionProfile.value) {
    updateEditingVisionProfile(updates)
  } else {
    draftSettings.visionProvider = value
    draftSettings.visionModel = defaults.model
    draftSettings.visionBaseUrl = defaults.baseUrl
  }
  fetchedVisionModels.value = []
}

async function handleFetchVisionModels(): Promise<void> {
  if (isFetchingVisionModels.value) return
  isFetchingVisionModels.value = true
  try {
    const result = await window.characterArc.fetchVisionModels(toIpcPayload({ ...draftSettings }))
    if (!result.success) throw new Error(result.error ?? '获取图片识别模型列表失败')
    fetchedVisionModels.value = result.result ?? []
    if (fetchedVisionModels.value.length === 0) {
      message.warning('该接口未返回任何可用图片识别模型，请手动输入模型名称。')
    } else {
      message.success(`获取到 ${fetchedVisionModels.value.length} 个可用模型`)
    }
  } catch (error) {
    fetchedVisionModels.value = []
    message.error(error instanceof Error ? error.message : '获取图片识别模型列表失败')
  } finally {
    isFetchingVisionModels.value = false
  }
}

async function handleTestImageConnection(): Promise<void> {
  if (isTestingImageConnection.value) return
  isTestingImageConnection.value = true
  try {
    const profile = editingImageProfile.value
    const payload: AppSettings = {
      ...draftSettings,
      provider: 'openai',
      model: (profile?.model ?? draftSettings.imageModel).trim() || draftSettings.model,
      apiKey: (profile?.apiKey ?? draftSettings.imageApiKey).trim(),
      baseUrl: (profile?.baseUrl ?? draftSettings.imageBaseUrl).trim(),
      apiProtocol: 'auto'
    }
    const result = await window.characterArc.testAiConnection(toIpcPayload(payload))
    if (!result.success) throw new Error(result.error ?? '图片生成连接测试失败')
    const res = result.result as { provider?: string; model?: string; protocol?: string } | undefined
    message.success(`图片生成连接测试成功：${res?.model ?? payload.model} / ${res?.protocol ?? 'auto'}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片生成连接测试失败')
  } finally {
    isTestingImageConnection.value = false
  }
}

async function handleTestVisionConnection(): Promise<void> {
  if (isTestingVisionConnection.value) return
  isTestingVisionConnection.value = true
  try {
    const result = await window.characterArc.testVisionConnection(toIpcPayload({ ...draftSettings }))
    if (!result.success) throw new Error(result.error ?? '图片识别连接测试失败')
    const res = result.result as { provider?: string; model?: string; protocol?: string } | undefined
    const profile = editingVisionProfile.value
    message.success(`图片识别连接测试成功：${res?.model ?? (profile?.model ?? draftSettings.visionModel)} / ${res?.protocol ?? 'auto'}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片识别连接测试失败')
  } finally {
    isTestingVisionConnection.value = false
  }
}

async function handleBenchmarkVisionModel(): Promise<void> {
  if (isBenchmarkingVisionModel.value) return
  isBenchmarkingVisionModel.value = true
  try {
    const result = await window.characterArc.benchmarkVisionModel(toIpcPayload({ ...draftSettings }))
    if (!result.success) throw new Error(result.error ?? '图片识别模型性能测试失败')
    const res = result.result as { latencyMs?: number; tokensPerSecond?: number; totalMs?: number; outputTokens?: number } | undefined
    const latency = res?.latencyMs ?? res?.totalMs
    message.success(`图片识别模型性能测试完成${latency != null ? `，耗时 ${Math.round(latency)}ms` : ''}${res?.tokensPerSecond != null ? `，${res.tokensPerSecond.toFixed(1)} tok/s` : ''}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片识别模型性能测试失败')
  } finally {
    isBenchmarkingVisionModel.value = false
  }
}

function openVisionProviderWebsite(): void {
  const url = resolveVisionProviderWebsite(draftSettings.visionProvider)
  window.open(url, '_blank')
}

function openImageProviderWebsite(): void {
  const url = resolveImageProviderWebsite(draftSettings.imageProvider)
  window.open(url, '_blank')
}


function buildProfilePayload(): AppSettings {
  const profile = editingProfile.value
  if (!profile) return { ...draftSettings }
  return {
    ...draftSettings,
    provider: profile.provider,
    model: profile.model,
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    apiProtocol: profile.apiProtocol ?? 'auto',
    temperature: profile.temperature,
    topP: profile.topP
  }
}

async function handleFetchModels(): Promise<void> {
  if (isFetchingModels.value) return
  isFetchingModels.value = true
  try {
    const result = await window.characterArc.fetchModels(toIpcPayload(buildProfilePayload()))
    if (!result.success) throw new Error(result.error ?? '获取模型列表失败')
    fetchedModels.value = result.result ?? []
    if (fetchedModels.value.length === 0) {
      message.warning('该供应商未返回任何可用模型，请手动输入模型名称。')
    } else {
      message.success(`获取到 ${fetchedModels.value.length} 个可用模型`)
    }
  } catch (error) {
    fetchedModels.value = []
    message.error(error instanceof Error ? error.message : '获取模型列表失败')
  } finally {
    isFetchingModels.value = false
  }
}

function profileModels(): string[] {
  return editingProfile.value?.models ?? []
}

/** 把当前模型加入该接口配置的已保存模型列表 */
function handleSaveProfileModel(): void {
  const profile = editingProfile.value
  if (!profile) return
  const model = profile.model?.trim()
  if (!model) {
    message.warning('请先填写模型名称后再保存。')
    return
  }
  const models = Array.isArray(profile.models) ? [...profile.models] : []
  if (!models.includes(model)) {
    models.push(model)
    updateEditingProfile({ models: models.slice(0, 50) })
    message.success(`已保存模型：${model}`)
  } else {
    message.info(`模型 ${model} 已在列表中。`)
  }
}

/** 从已保存列表移除某个模型（若为当前模型则同时清空当前模型） */
function handleRemoveProfileModel(model: string): void {
  const profile = editingProfile.value
  if (!profile) return
  const models = (profile.models ?? []).filter((m) => m !== model)
  updateEditingProfile({ models })
  if (profile.model === model) {
    updateEditingProfile({ model: '' })
  }
}

/** 点击已保存的模型，切换到该模型作为当前模型 */
function handleApplyProfileModel(model: string): void {
  updateEditingProfile({ model })
  message.success(`已切换模型：${model}`)
}

async function handleTestAiConnection(): Promise<void> {
  if (isTestingAiConnection.value) return
  isTestingAiConnection.value = true
  try {
    const payload = buildProfilePayload()
    const result = await window.characterArc.testAiConnection(toIpcPayload(payload))
    if (!result.success) throw new Error(result.error ?? '模型连接测试失败')
    const res = result.result as { provider?: string; model?: string; protocol?: string } | undefined
    message.success(
      `模型连接测试成功：${res?.provider ?? payload.provider} / ${res?.model ?? payload.model} / ${res?.protocol ?? 'auto'}`
    )
  } catch (error) {
    message.error(error instanceof Error ? error.message : '模型连接测试失败')
  } finally {
    isTestingAiConnection.value = false
  }
}

async function handleBenchmarkModel(): Promise<void> {
  if (isBenchmarkingModel.value) return
  isBenchmarkingModel.value = true
  try {
    const payload = buildProfilePayload()
    if (!payload.model.trim()) throw new Error('请先填写模型名称后再进行性能测试。')
    const result = await window.characterArc.benchmarkModel(toIpcPayload(payload))
    if (!result.success) throw new Error(result.error ?? '模型性能测试失败')
    const res = result.result
    if (!res) throw new Error('模型性能测试未返回有效数据')
    const record: BenchmarkHistoryItem = {
      model: payload.model,
      latencyMs: res.latencyMs,
      tokensPerSec: res.tokensPerSec,
      completionTokens: res.completionTokens,
      promptTokens: res.promptTokens,
      at: new Date().toISOString()
    }
    benchmarkHistory.value = [record, ...benchmarkHistory.value].slice(0, BENCHMARK_HISTORY_LIMIT)
    message.success('模型性能测试完成')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '模型性能测试失败')
  } finally {
    isBenchmarkingModel.value = false
  }
}

// 将 CC Switch 的 type 映射为应用内 provider 值
function mapCcSwitchType(type: string): string {
  const t = type.trim().toLowerCase()
  if (t === 'anthropic' || t === 'claude') return 'anthropic'
  if (t === 'openai') return 'openai'
  if (t === 'gemini' || t === 'google') return 'gemini'
  if (t === 'deepseek') return 'deepseek'
  if (t === 'ollama') return 'ollama'
  return 'openai-compatible'
}

// 从 CC Switch（~/.cc-switch/config.json）导入 AI 接口配置与 skills
async function handleCcSwitchImport(): Promise<void> {
  if (isCcSwitchImporting.value) return
  isCcSwitchImporting.value = true
  try {
    const result = await window.characterArc.importFromCcSwitch()
    if (!result.success) {
      throw new Error(result.error ?? 'CC Switch 导入失败')
    }
    ccSwitchConfigPath.value = result.configPath ?? ''
    ccSwitchConfigError.value = result.configError ?? ''
    ccSwitchProfiles.value = (result.aiProfiles ?? []).map((profile) => ({
      ...profile,
      selected: true
    }))
    ccSwitchImportOpen.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'CC Switch 导入失败')
  } finally {
    isCcSwitchImporting.value = false
  }
}

function toggleCcSwitchProfile(profile: CcSwitchAiProfile & { selected: boolean }): void {
  profile.selected = !profile.selected
}

// 确认将勾选的 CC Switch AI 接口加入 aiProfiles
function confirmCcSwitchImport(): void {
  const selected = ccSwitchProfiles.value.filter((p) => p.selected)
  const existingKeys = new Set(
    draftSettings.aiProfiles.map((p) => `${p.provider}|${p.baseUrl}|${p.model}`.toLowerCase())
  )
  for (const profile of selected) {
    const provider = mapCcSwitchType(profile.type)
    const key = `${provider}|${profile.baseUrl}|${profile.model}`.toLowerCase()
    if (existingKeys.has(key)) continue
    const defaults = resolveProviderDefaults(provider)
    draftSettings.aiProfiles.push({
      id: generateProfileId(),
      name: generateUniqueName(profile.name.trim() || 'CC Switch'),
      provider,
      baseUrl: profile.baseUrl.trim() || defaults.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model.trim() || defaults.model,
      apiProtocol: 'auto',
      temperature: undefined,
      topP: undefined
    })
    existingKeys.add(key)
  }
  ccSwitchImportOpen.value = false
  ccSwitchProfiles.value = []
  ccSwitchConfigError.value = ''
  message.success(`已导入 ${selected.length} 个 AI 接口配置`)
}

async function saveSettings(): Promise<void> {
  const activeProfile = draftSettings.aiProfiles.find(p => p.id === draftSettings.activeAiProfileId)
  const activeImageProfile = draftSettings.imageProfiles.find(p => p.id === draftSettings.activeImageProfileId)
  const activeVisionProfile = draftSettings.visionProfiles.find(p => p.id === draftSettings.activeVisionProfileId)
  const nextSettings: AppSettings = {
    ...draftSettings,
    aiProfiles: draftSettings.aiProfiles.map((profile) => ({ ...profile })),
    activeAiProfileId: draftSettings.activeAiProfileId,
    provider: activeProfile?.provider ?? draftSettings.provider,
    model: activeProfile?.model ?? draftSettings.model,
    apiKey: activeProfile?.apiKey ?? draftSettings.apiKey,
    baseUrl: activeProfile?.baseUrl ?? draftSettings.baseUrl,
    apiProtocol: activeProfile?.apiProtocol ?? draftSettings.apiProtocol ?? 'auto',
    temperature: activeProfile?.temperature ?? draftSettings.temperature,
    topP: activeProfile?.topP ?? draftSettings.topP,
    imageProfiles: draftSettings.imageProfiles.map((profile) => ({ ...profile })),
    activeImageProfileId: draftSettings.activeImageProfileId,
    imageProvider: activeImageProfile?.provider ?? draftSettings.imageProvider,
    imageModel: activeImageProfile?.model ?? draftSettings.imageModel,
    imageApiKey: activeImageProfile?.apiKey ?? draftSettings.imageApiKey,
    imageBaseUrl: activeImageProfile?.baseUrl ?? draftSettings.imageBaseUrl,
    visionProfiles: draftSettings.visionProfiles.map((profile) => ({ ...profile })),
    activeVisionProfileId: draftSettings.activeVisionProfileId,
    visionProfileName: activeVisionProfile?.name ?? draftSettings.visionProfileName,
    visionProvider: activeVisionProfile?.provider ?? draftSettings.visionProvider,
    visionModel: activeVisionProfile?.model ?? draftSettings.visionModel,
    visionApiKey: activeVisionProfile?.apiKey ?? draftSettings.visionApiKey,
    visionBaseUrl: activeVisionProfile?.baseUrl ?? draftSettings.visionBaseUrl
  }

  const saved = await appStore.saveAppSettingsDraft(nextSettings, draftTheme.value)
  if (!saved) {
    message.error(appStore.persistenceError ?? '设置保存失败')
    return
  }

  message.success('设置已保存')
  emit('update:show', false)
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="arc-settings-modal"
    title="设置"
    :bordered="false"
    @close="closeModal"
  >
    <div class="settings-layout">
      <nav class="settings-nav">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="nav-item"
          :class="{ active: activeNav === item.id }"
          @click="scrollToSection(item.id)"
        >
          <component :is="item.icon" :size="18" />
          {{ item.label }}
        </button>
        <div class="nav-version">v{{ currentVersion }}</div>
      </nav>

      <div ref="scrollContainer" class="settings-main arc-scrollbar" @scroll="handleScroll">
        <section id="sec-ai" class="settings-section">
          <div class="section-title section-title--actions">
            <Cpu :size="18" />
            <div class="section-title-copy">
              <strong>AI 接口配置</strong>
              <p>管理多个接口配置，可在标题栏快速切换。修改后需点击右下角「保存设置」按钮才生效。</p>
            </div>
            <div class="profile-tab-actions">
              <button
                class="profile-action-btn"
                title="从 CC Switch 导入 AI 接口配置"
                :disabled="isCcSwitchImporting"
                @click="handleCcSwitchImport"
              >
                <FileInput :size="14" />
              </button>
              <button class="profile-action-btn" title="新建配置" @click="handleAddProfile">
                <Plus :size="14" />
              </button>
              <button class="profile-action-btn" title="复制当前配置" :disabled="!editingProfile" @click="handleCopyProfile">
                <Copy :size="14" />
              </button>
              <button
                class="profile-action-btn profile-action-btn--danger"
                title="删除当前配置"
                :disabled="!editingProfile || isEditingActiveProfile || draftSettings.aiProfiles.length <= 1"
                @click="handleDeleteProfile"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>

          <div class="profile-tabs">
            <div class="profile-tab-list">
              <button
                v-for="profile in draftSettings.aiProfiles"
                :key="profile.id"
                class="profile-tab"
                :class="{
                  active: editingProfileId === profile.id,
                  'is-active-profile': profile.id === draftSettings.activeAiProfileId
                }"
                @click="selectProfile(profile.id)"
              >
                <span class="profile-tab-name">{{ profile.name }}</span>
                <span v-if="profile.id === draftSettings.activeAiProfileId" class="profile-tab-badge">当前</span>
              </button>
            </div>
          </div>

          <template v-if="editingProfile">
            <div class="profile-name-row">
              <n-form-item label="配置名称">
                <n-input
                  :value="editingProfile.name"
                  placeholder="为这个接口配置起个名字"
                  @update:value="(value) => updateEditingProfile({ name: value })"
                />
              </n-form-item>
              <n-button
                quaternary
                class="provider-home-btn"
                title="导出所有模型厂商官网到 Excel"
                @click="handleExportProvidersExcel"
              >
                <template #icon>
                  <Download :size="16" />
                </template>
                导出官网
              </n-button>
              <n-button
                v-if="activeProviderHomepage"
                quaternary
                class="provider-home-btn"
                title="复制当前模型厂商官网链接"
                @click="handleCopyProviderHomepage"
              >
                <template #icon>
                  <Copy :size="16" />
                </template>
                复制官网
              </n-button>
              <n-button
                v-if="activeProviderHomepage"
                quaternary
                class="provider-home-btn"
                :title="`打开 ${activeProviderPreset.label} 官网`"
                @click="openProviderHomepage"
              >
                <template #icon>
                  <ExternalLink :size="16" />
                </template>
                {{ activeProviderPreset.label }} 官网
              </n-button>
            </div>
            <div class="settings-grid">
              <n-form-item label="模型厂商">
                <n-select
                  :options="providerOptions"
                  :value="editingProfile.provider"
                  filterable
                  placeholder="搜索或选择模型厂商"
                  @update:value="(value) => handleProviderChange(value ?? 'openai-compatible')"
                />
              </n-form-item>
              <n-form-item label="API Key">
                <n-input
                  type="password"
                  show-password-on="click"
                  :value="editingProfile.apiKey"
                  :placeholder="editingProfile.provider === 'ollama' ? '本地服务无需填写' : '填写厂商提供的 API Key / Token'"
                  @update:value="(value) => updateEditingProfile({ apiKey: value })"
                />
              </n-form-item>
            </div>
            <n-form-item v-if="activeProviderPreset.customBaseUrl" label="Base URL">
              <n-input
                :value="editingProfile.baseUrl"
                placeholder="填写完整 API Base URL，例如：https://example.com/v1"
                @update:value="(value) => updateEditingProfile({ baseUrl: value })"
              />
            </n-form-item>
            <div>
              <n-form-item label="模型名称">
                <div class="model-input-row">
                  <n-select
                    v-if="fetchedModels.length > 0"
                    :options="modelSelectOptions"
                    :value="editingProfile.model"
                    filterable
                    tag
                    placeholder="选择或输入模型名称"
                    @update:value="(value: string) => updateEditingProfile({ model: value })"
                  />
                  <n-input
                    v-else
                    :value="editingProfile.model"
                    placeholder="填写 Key 后可点右侧按钮拉取或手动输入"
                    @update:value="(value) => updateEditingProfile({ model: value })"
                  />
                  <n-button
                    quaternary
                    class="model-fetch-btn"
                    title="获取模型列表"
                    :disabled="isFetchingModels || !editingProfile.baseUrl.trim() || (editingProfile.provider !== 'ollama' && !editingProfile.apiKey.trim())"
                    @click="handleFetchModels"
                  >
                    <template #icon>
                      <RefreshCw v-if="fetchedModels.length > 0" :size="16" :class="{ 'spin-icon': isFetchingModels }" />
                      <Download v-else :size="16" :class="{ 'spin-icon': isFetchingModels }" />
                    </template>
                  </n-button>
                </div>
              </n-form-item>
            </div>
            <div class="saved-models-block">
              <div class="saved-models-head">
                <span class="saved-models-title">已保存的模型</span>
                <span class="saved-models-count">{{ profileModels().length }} 个</span>
                <button
                  class="saved-models-add"
                  type="button"
                  title="把当前模型保存到列表"
                  :disabled="!editingProfile.model.trim()"
                  @click="handleSaveProfileModel"
                >
                  <Plus :size="13" />
                  保存当前模型
                </button>
              </div>
              <div v-if="profileModels().length === 0" class="saved-models-empty">
                暂无已保存的模型。输入模型名称后点击「保存当前模型」，即可在同一接口下维护多个模型 ID 并快速切换。
              </div>
              <div v-else class="saved-models-list">
                <button
                  v-for="model in profileModels()"
                  :key="model"
                  class="saved-model-chip"
                  :class="{ 'is-current': model === editingProfile.model }"
                  type="button"
                  :title="`切换到 ${model}`"
                  @click="handleApplyProfileModel(model)"
                >
                  <span class="saved-model-name">{{ model }}</span>
                  <span
                    class="saved-model-remove"
                    title="移除该模型"
                    @click.stop="handleRemoveProfileModel(model)"
                  >
                    <Trash2 :size="12" />
                  </span>
                </button>
              </div>
            </div>
            <div class="provider-hint-block">
              <p>{{ activeProviderPreset.hint }}</p>
            </div>
            <details class="advanced-settings">
              <summary>API 高级设置</summary>
              <div class="advanced-settings-body">
                <n-form-item label="API 协议">
                  <n-select
                    :options="apiProtocolOptions"
                    :value="editingProfile.apiProtocol ?? 'auto'"
                    @update:value="(value) => updateEditingProfile({ apiProtocol: value ?? 'auto' })"
                  />
                </n-form-item>
                <div class="settings-grid">
                  <n-form-item label="Temperature">
                    <n-input-number
                      :value="editingProfile.temperature"
                      :min="0"
                      :max="2"
                      :step="0.1"
                      clearable
                      placeholder="默认"
                      @update:value="(value) => updateEditingProfile({ temperature: toOptionalNumber(value) })"
                    />
                  </n-form-item>
                  <n-form-item label="Top P">
                    <n-input-number
                      :value="editingProfile.topP"
                      :min="0"
                      :max="1"
                      :step="0.05"
                      clearable
                      placeholder="默认"
                      @update:value="(value) => updateEditingProfile({ topP: toOptionalNumber(value) })"
                    />
                  </n-form-item>
                </div>
                <p class="advanced-settings-hint">留空时使用模型默认值；温度越高表达越发散，Top P 越低输出越保守。</p>
              </div>
            </details>
            <div class="section-actions">
              <n-button round strong secondary :disabled="isTestingAiConnection" @click="handleTestAiConnection">
                <template #icon>
                  <PlugZap :size="16" />
                </template>
                {{ isTestingAiConnection ? '测试中...' : '测试模型连接' }}
              </n-button>
              <n-button
                round
                strong
                secondary
                :disabled="isBenchmarkingModel || isTestingAiConnection || !editingProfile?.model.trim()"
                :title="'测速与测延迟，展示该模型每秒 token 数与毫秒级延迟'"
                @click="handleBenchmarkModel"
              >
                <template #icon>
                  <Activity :size="16" />
                </template>
                {{ isBenchmarkingModel ? '测试中...' : '测试模型性能' }}
              </n-button>
            </div>
            <div v-if="benchmarkHistory.length" class="benchmark-history">
              <div class="benchmark-history-title">最近 {{ benchmarkHistory.length }} 次性能测试（最多保留 {{ BENCHMARK_HISTORY_LIMIT }} 条，新测试覆盖最旧）</div>
              <div v-for="(item, idx) in benchmarkHistory" :key="item.at + idx" class="benchmark-result">
                <div class="benchmark-model">
                  <strong>{{ item.model }}</strong>
                  <span class="benchmark-time">{{ new Date(item.at).toLocaleTimeString() }}</span>
                </div>
                <div class="benchmark-item">
                  <span class="benchmark-label">延迟</span>
                  <strong>{{ item.latencyMs.toFixed(0) }} ms</strong>
                </div>
                <div class="benchmark-item">
                  <span class="benchmark-label">测速</span>
                  <strong>{{ item.tokensPerSec.toFixed(1) }} tokens/s</strong>
                </div>
                <div class="benchmark-item">
                  <span class="benchmark-label">本次输出</span>
                  <strong>{{ item.completionTokens }} tokens</strong>
                </div>
              </div>
            </div>
          </template>
        </section>

        <section id="sec-network" class="settings-section">
          <div class="section-title">
            <Network :size="18" />
            <div>
              <strong>网络代理</strong>
              <p>让模型、Embedding 与图片请求通过本地代理服务访问。</p>
            </div>
          </div>
          <n-form-item label="HTTP 代理地址">
            <div class="preset-field">
              <n-input
                :value="draftSettings.proxyUrl"
                placeholder="例如：http://127.0.0.1:7890（留空直连）"
                clearable
                @update:value="handleProxyUrlChange"
              />
              <span class="preset-hint">Clash 请填写 HTTP 或 Mixed 端口；可省略 http://。</span>
            </div>
          </n-form-item>
          <div class="proxy-test-row">
            <n-button
              strong
              secondary
              :disabled="!draftSettings.proxyUrl.trim() || isTestingProxyConnection"
              @click="handleTestProxyConnection"
            >
              <template #icon>
                <PlugZap :size="16" />
              </template>
              {{ isTestingProxyConnection ? '测试中...' : '测试代理连接' }}
            </n-button>
            <div v-if="proxyTestIp" class="proxy-ip-result">
              <span>当前出口 IP</span>
              <code>{{ proxyTestIp }}</code>
            </div>
          </div>
        </section>

        <section id="sec-image" class="settings-section">
          <div class="section-title section-title--actions">
            <Image :size="18" />
            <div class="section-title-copy">
              <strong>图片生成配置</strong>
              <p>封面工作台使用专用的图片生成接口，支持多套配置新建、复制与删除。</p>
            </div>
            <div class="profile-tab-actions">
              <button class="profile-action-btn" title="新建配置" @click="handleAddImageProfile">
                <Plus :size="14" />
              </button>
              <button class="profile-action-btn" title="复制当前配置" :disabled="!editingImageProfile" @click="handleCopyImageProfile">
                <Copy :size="14" />
              </button>
              <button
                class="profile-action-btn profile-action-btn--danger"
                title="删除当前配置"
                :disabled="!editingImageProfile || isEditingActiveImageProfile || draftSettings.imageProfiles.length <= 1"
                @click="handleDeleteImageProfile"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>

          <div class="profile-tabs">
            <div class="profile-tab-list">
              <button
                v-for="profile in draftSettings.imageProfiles"
                :key="profile.id"
                class="profile-tab"
                :class="{
                  active: editingImageProfileId === profile.id,
                  'is-active-profile': profile.id === draftSettings.activeImageProfileId
                }"
                @click="selectImageProfile(profile.id)"
              >
                <span class="profile-tab-name">{{ profile.name }}</span>
                <span v-if="profile.id === draftSettings.activeImageProfileId" class="profile-tab-badge">当前</span>
              </button>
            </div>
          </div>

          <template v-if="editingImageProfile">
            <div class="profile-name-row">
              <n-form-item label="配置名称">
                <n-input
                  :value="editingImageProfile.name"
                  placeholder="为这个图片生成接口配置起个名字"
                  @update:value="(value) => updateEditingImageProfile({ name: value })"
                />
              </n-form-item>
            </div>
            <div class="settings-grid">
              <n-form-item label="图片服务预设">
                <n-select
                  :options="imageProviderOptions"
                  :value="editingImageProfile.provider"
                  placeholder="选择预设快速填充模型和地址"
                  clearable
                  @update:value="(value) => handleImageProviderChange(value ?? '')"
                />
              </n-form-item>
              <n-form-item label="图片模型名称">
                <div class="model-input-row">
                  <n-select
                    v-if="fetchedImageModels.length > 0"
                    :options="imageModelSelectOptions"
                    :value="editingImageProfile.model"
                    filterable
                    tag
                    placeholder="选择或输入图片模型名称"
                    @update:value="(value: string) => updateEditingImageProfile({ model: value })"
                  />
                  <n-input
                    v-else
                    :value="editingImageProfile.model"
                    placeholder="例如：gpt-image-1 / flux.1-dev"
                    @update:value="(value) => updateEditingImageProfile({ model: value })"
                  />
                  <n-button
                    quaternary
                    class="model-fetch-btn"
                    :disabled="isFetchingImageModels || !editingImageProfile.baseUrl.trim()"
                    @click="handleFetchImageModels"
                  >
                    <template #icon>
                      <RefreshCw v-if="fetchedImageModels.length > 0" :size="16" :class="{ 'spin-icon': isFetchingImageModels }" />
                      <Download v-else :size="16" :class="{ 'spin-icon': isFetchingImageModels }" />
                    </template>
                  </n-button>
                </div>
              </n-form-item>
            </div>
            <p class="settings-grid-hint">切换预设仅更新模型名和 Base URL，API Key 不会被覆盖。</p>
            <div class="settings-grid">
              <n-form-item label="图片 Base URL">
                <n-input
                  :value="editingImageProfile.baseUrl"
                  placeholder="例如：https://api.openai.com/v1"
                  @update:value="(value) => updateEditingImageProfile({ baseUrl: value })"
                />
              </n-form-item>
              <n-form-item label="图片 API Key">
                <n-input
                  type="password"
                  show-password-on="click"
                  :value="editingImageProfile.apiKey"
                  placeholder="图片接口专用 API Key"
                  @update:value="(value) => updateEditingImageProfile({ apiKey: value })"
                />
              </n-form-item>
            </div>
            <div class="saved-models-block">
              <div class="saved-models-head">
                <span class="saved-models-title">已保存的模型</span>
                <span class="saved-models-count">{{ imageProfileModels().length }} 个</span>
                <button
                  class="saved-models-add"
                  type="button"
                  :disabled="!editingImageProfile.model.trim()"
                  @click="handleSaveImageProfileModel"
                >
                  <Plus :size="13" />
                  保存当前模型
                </button>
              </div>
              <div v-if="imageProfileModels().length === 0" class="saved-models-empty">
                暂无已保存的图片模型，输入模型名称后点击「保存当前模型」即可维护多个模型 ID。
              </div>
              <div v-else class="saved-models-list">
                <button
                  v-for="model in imageProfileModels()"
                  :key="model"
                  class="saved-model-chip"
                  :class="{ 'is-current': model === editingImageProfile.model }"
                  type="button"
                  @click="handleApplyImageProfileModel(model)"
                >
                  <span class="saved-model-name">{{ model }}</span>
                  <span class="saved-model-remove" title="移除该模型" @click.stop="handleRemoveImageProfileModel(model)">
                    <Trash2 :size="12" />
                  </span>
                </button>
              </div>
            </div>
            <div class="model-test-row">
              <n-button
                strong
                secondary
                :disabled="!editingImageProfile.model.trim() || !editingImageProfile.baseUrl.trim() || isTestingImageConnection"
                @click="handleTestImageConnection"
              >
                <template #icon><PlugZap :size="16" /></template>
                {{ isTestingImageConnection ? '测试中...' : '测试模型连接' }}
              </n-button>
              <n-button strong secondary @click="openImageProviderWebsite">
                <template #icon><ExternalLink :size="16" /></template>
                打开模型厂商官网
              </n-button>
            </div>
          </template>
        </section>

        <section id="sec-vision" class="settings-section">
          <div class="section-title section-title--actions">
            <ScanEye :size="18" />
            <div class="section-title-copy">
              <strong>图片识别配置</strong>
              <p>识别人物图片并反推为人物卡片，支持多套视觉模型配置新建、复制与删除。</p>
            </div>
            <div class="profile-tab-actions">
              <button class="profile-action-btn" title="新建配置" @click="handleAddVisionProfile">
                <Plus :size="14" />
              </button>
              <button class="profile-action-btn" title="复制当前配置" :disabled="!editingVisionProfile" @click="handleCopyVisionProfile">
                <Copy :size="14" />
              </button>
              <button
                class="profile-action-btn profile-action-btn--danger"
                title="删除当前配置"
                :disabled="!editingVisionProfile || isEditingActiveVisionProfile || draftSettings.visionProfiles.length <= 1"
                @click="handleDeleteVisionProfile"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>

          <div class="profile-tabs">
            <div class="profile-tab-list">
              <button
                v-for="profile in draftSettings.visionProfiles"
                :key="profile.id"
                class="profile-tab"
                :class="{
                  active: editingVisionProfileId === profile.id,
                  'is-active-profile': profile.id === draftSettings.activeVisionProfileId
                }"
                @click="selectVisionProfile(profile.id)"
              >
                <span class="profile-tab-name">{{ profile.name }}</span>
                <span v-if="profile.id === draftSettings.activeVisionProfileId" class="profile-tab-badge">当前</span>
              </button>
            </div>
          </div>

          <template v-if="editingVisionProfile">
            <div class="settings-grid">
              <n-form-item label="配置名称">
                <n-input
                  :value="editingVisionProfile.name"
                  placeholder="例如：我的视觉识别接口"
                  @update:value="(value) => updateEditingVisionProfile({ name: value })"
                />
              </n-form-item>
              <n-form-item label="模型厂商">
                <n-select
                  :options="visionProviderOptions"
                  :value="editingVisionProfile.provider"
                  placeholder="选择预设快速填充模型和地址"
                  clearable
                  @update:value="(value) => handleVisionProviderChange(value ?? '')"
                />
              </n-form-item>
            </div>
            <p class="settings-grid-hint">切换预设仅更新模型名和 Base URL，API Key 不会被覆盖。</p>
            <div class="settings-grid">
              <n-form-item label="模型名称">
                <div class="model-input-row">
                  <n-select
                    v-if="fetchedVisionModels.length > 0"
                    :options="visionModelSelectOptions"
                    :value="editingVisionProfile.model"
                    filterable
                    tag
                    placeholder="选择或输入图片识别模型名称"
                    @update:value="(value: string) => updateEditingVisionProfile({ model: value })"
                  />
                  <n-input
                    v-else
                    :value="editingVisionProfile.model"
                    placeholder="例如：gpt-4o / glm-4v / qwen-vl-plus"
                    @update:value="(value) => updateEditingVisionProfile({ model: value })"
                  />
                  <n-button
                    quaternary
                    class="model-fetch-btn"
                    :disabled="isFetchingVisionModels || !editingVisionProfile.baseUrl.trim()"
                    @click="handleFetchVisionModels"
                  >
                    <template #icon>
                      <RefreshCw v-if="fetchedVisionModels.length > 0" :size="16" :class="{ 'spin-icon': isFetchingVisionModels }" />
                      <Download v-else :size="16" :class="{ 'spin-icon': isFetchingVisionModels }" />
                    </template>
                  </n-button>
                </div>
              </n-form-item>
              <n-form-item label="API Key">
                <n-input
                  type="password"
                  show-password-on="click"
                  :value="editingVisionProfile.apiKey"
                  placeholder="图片识别接口专用 API Key"
                  @update:value="(value) => updateEditingVisionProfile({ apiKey: value })"
                />
              </n-form-item>
            </div>
            <div class="settings-grid">
              <n-form-item label="Base URL">
                <n-input
                  :value="editingVisionProfile.baseUrl"
                  placeholder="例如：https://api.openai.com/v1"
                  @update:value="(value) => updateEditingVisionProfile({ baseUrl: value })"
                />
              </n-form-item>
            </div>
            <p class="settings-grid-hint">识别接口使用 OpenAI 兼容的 /chat/completions 图片输入格式。</p>
            <div class="saved-models-block">
              <div class="saved-models-head">
                <span class="saved-models-title">已保存的模型</span>
                <span class="saved-models-count">{{ visionProfileModels().length }} 个</span>
                <button
                  class="saved-models-add"
                  type="button"
                  :disabled="!editingVisionProfile.model.trim()"
                  @click="handleSaveVisionProfileModel"
                >
                  <Plus :size="13" />
                  保存当前模型
                </button>
              </div>
              <div v-if="visionProfileModels().length === 0" class="saved-models-empty">
                暂无已保存的图片识别模型，输入模型名称后点击「保存当前模型」即可维护多个模型 ID。
              </div>
              <div v-else class="saved-models-list">
                <button
                  v-for="model in visionProfileModels()"
                  :key="model"
                  class="saved-model-chip"
                  :class="{ 'is-current': model === editingVisionProfile.model }"
                  type="button"
                  @click="handleApplyVisionProfileModel(model)"
                >
                  <span class="saved-model-name">{{ model }}</span>
                  <span class="saved-model-remove" title="移除该模型" @click.stop="handleRemoveVisionProfileModel(model)">
                    <Trash2 :size="12" />
                  </span>
                </button>
              </div>
            </div>
            <div class="model-test-row">
              <n-button
                strong
                secondary
                :disabled="!editingVisionProfile.model.trim() || !editingVisionProfile.baseUrl.trim() || isTestingVisionConnection"
                @click="handleTestVisionConnection"
              >
                <template #icon><PlugZap :size="16" /></template>
                {{ isTestingVisionConnection ? '测试中...' : '测试模型连接' }}
              </n-button>
              <n-button
                strong
                secondary
                :disabled="!editingVisionProfile.model.trim() || isBenchmarkingVisionModel"
                @click="handleBenchmarkVisionModel"
              >
                <template #icon><Activity :size="16" /></template>
                {{ isBenchmarkingVisionModel ? '测试中...' : '测试模型性能' }}
              </n-button>
              <n-button strong secondary @click="openVisionProviderWebsite">
                <template #icon><ExternalLink :size="16" /></template>
                打开模型厂商官网
              </n-button>
            </div>
          </template>
        </section>

        <section id="sec-theme" class="settings-section">
          <div class="section-title">
            <Palette :size="18" />
            <div>
              <strong>界面主题</strong>
              <p>多套完整风格主题，覆盖主色、背景与文字配色。点击色卡即刻生效，无需保存。</p>
            </div>
          </div>
          <div class="theme-swatches">
            <button
              v-for="preset in themePresets"
              :key="preset.name"
              class="theme-card"
              :class="{ active: draftTheme === preset.name }"
              :style="{ background: preset.primary, color: themeTextColor(preset.primary) }"
              @click="applyThemeImmediately(preset.name)"
            >
              <span class="theme-card__label">{{ preset.label }}</span>
            </button>
          </div>

          <div v-if="draftTheme" class="paper-texture-card theme-color-intensity-card">
            <div class="paper-texture-card__head">
              <div>
                <strong>颜色深浅</strong>
                <p>调节当前选中主题的主色深浅，向左更浅淡、向右更浓重，即刻生效。</p>
              </div>
            </div>
            <div class="paper-texture-card__control">
              <span class="paper-texture-card__label">颜色深浅</span>
              <div class="paper-texture-card__slider">
                <n-slider
                  :value="appStore.appSettings.themeColorIntensity ?? 0.5"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  @update:value="setThemeColorIntensity"
                />
                <span class="paper-texture-card__value">
                  {{ Math.round((appStore.appSettings.themeColorIntensity ?? 0.5) * 100) }}%
                </span>
              </div>
            </div>
          </div>
        </section>

        <section id="sec-prefs" class="settings-section">
          <div class="section-title">
            <MonitorCog :size="18" />
            <div>
              <strong>应用偏好</strong>
              <p>保存节奏与显示比例。</p>
            </div>
          </div>
          <div class="settings-grid">
            <n-form-item label="自动保存时间间隔">
              <n-select
                :options="autoSaveSelectOptions"
                :value="draftSettings.autoSaveInterval"
                @update:value="(value) => { draftSettings.autoSaveInterval = value ?? '5m' }"
              />
            </n-form-item>
            <n-form-item label="界面缩放比例">
              <n-select
                :options="uiScaleOptions"
                :value="draftSettings.uiScale"
                @update:value="(value) => { draftSettings.uiScale = value ?? 1 }"
              />
            </n-form-item>
          </div>
          <div class="dark-mode-row">
            <div class="dark-mode-label">
              <Moon :size="15" />
              <div>
                <span class="dark-mode-text">深色模式</span>
                <span class="dark-mode-hint">适合夜间长时间写作，开关即刻生效，无需保存</span>
              </div>
            </div>
            <n-switch
              :value="draftSettings.darkMode"
              @update:value="(value) => applyDarkModeImmediately(value)"
            />
          </div>
          <div v-if="draftSettings.darkMode" class="dark-style-grid">
            <button
              v-for="preset in darkModePresets"
              :key="preset.name"
              type="button"
              class="dark-style-card"
              :class="{ active: draftSettings.darkModeStyle === preset.name }"
              @click="draftSettings.darkModeStyle = preset.name as DarkModeStyle"
            >
              <div
                class="dark-style-swatch"
                :style="{
                  background: preset.bgBody,
                  borderColor: preset.border,
                  color: preset.textPrimary
                }"
              >
                <span
                  class="dark-style-swatch-surface"
                  :style="{ background: preset.bgSurface, borderColor: preset.border }"
                ></span>
                <span
                  class="dark-style-swatch-text"
                  :style="{ color: preset.textPrimary }"
                >Aa</span>
              </div>
              <div class="dark-style-meta">
                <strong>{{ preset.label }}</strong>
                <p>{{ preset.description }}</p>
              </div>
            </button>
          </div>
<!--          <div class="storage-note">-->
<!--            <Save :size="16" />-->
<!--            <span>{{ appStore.persistenceError || '当前工作区内容已接入本地 SQLite 持久化。' }}</span>-->
<!--          </div>-->
        </section>
      </div>
    </div>

    <template #footer>
      <div class="settings-footer-actions">
        <n-button round strong @click="closeModal">取消</n-button>
        <n-button type="primary" round strong @click="saveSettings">保存设置</n-button>
      </div>
    </template>
  </n-modal>

  <!-- 从 CC Switch 导入 AI 接口配置的确认弹窗 -->
  <n-modal
    :show="ccSwitchImportOpen"
    preset="card"
    class="arc-settings-modal cc-switch-modal"
    title="从 CC Switch 导入"
    :bordered="false"
    @close="ccSwitchImportOpen = false"
  >
    <div class="cc-switch-intro">
      <p>已读取 CC Switch 配置（{{ ccSwitchConfigPath || '~/.cc-switch/cc-switch.db' }}）。选择要导入的 AI 接口配置。</p>
      <p v-if="ccSwitchConfigError" class="cc-switch-warn">
        配置读取提示：{{ ccSwitchConfigError }}
      </p>
    </div>

    <div class="cc-switch-section-title">AI 接口配置</div>
    <div v-if="ccSwitchProfiles.length" class="cc-switch-profile-list">
      <label
        v-for="profile in ccSwitchProfiles"
        :key="profile.name + profile.baseUrl + profile.model"
        class="cc-switch-profile-item"
        :class="{ checked: profile.selected }"
      >
        <input type="checkbox" :checked="profile.selected" @change="toggleCcSwitchProfile(profile)" />
        <span class="cc-switch-profile-main">
          <strong>{{ profile.name }}</strong>
          <span class="cc-switch-profile-sub">{{ profile.type }} · {{ profile.model || '默认模型' }}</span>
        </span>
        <code class="cc-switch-profile-url">{{ profile.baseUrl || '默认地址' }}</code>
      </label>
    </div>
    <div v-else class="cc-switch-empty">
      未在配置文件中识别到可导入的 AI 接口配置。
    </div>

    <template #footer>
      <div class="cc-switch-footer">
        <n-button round strong @click="ccSwitchImportOpen = false">取消</n-button>
        <n-button type="primary" round strong @click="confirmCcSwitchImport">导入选中</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 192px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
}

/* ── Left Nav ── */
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 12px;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 13.5px;
  font-weight: 550;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s;
}

.nav-item:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.nav-item.active {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-primary);
}

.nav-item :deep(svg) {
  opacity: 0.7;
  flex-shrink: 0;
}

.nav-item.active :deep(svg) {
  opacity: 1;
}

.nav-version {
  margin-top: auto;
  padding: 12px 12px 4px;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 500;
}

/* ── Right Content ── */
.settings-main {
  max-height: min(76vh, 720px);
  overflow-y: auto;
  padding: 24px 28px;
  scroll-behavior: smooth;
}

.settings-section {
  padding-bottom: 28px;
  margin-bottom: 28px;
  border-bottom: 1px solid var(--arc-bg-surface-hover);
}

.settings-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 8px;
}

.section-title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
}

/* AI 接口配置：标题与右侧四个操作按钮同行对齐 */
.section-title--actions {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.section-title--actions .section-title-copy {
  flex: 1 1 auto;
  min-width: 0;
}
.section-title--actions .profile-tab-actions {
  margin-left: auto;
  padding-top: 0;
}

.section-title :deep(svg) {
  margin-top: 2px;
  color: var(--arc-primary);
}
.section-title--actions :deep(svg) {
  margin-top: 0;
}

.section-title strong {
  display: block;
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 700;
}

.section-title p {
  margin: 4px 0 0;
  color: var(--arc-text-hint);
  font-size: 12.5px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.provider-hint-block {
  margin: -2px 0 16px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.7;
}

.provider-hint-block p {
  margin: 0;
}

.saved-models-block {
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
}

/* 图片识别配置下的已保存模型卡片：与上方操作按钮拉开间距，避免重叠 */
.vision-saved-models {
  margin: 18px 0 0;
  padding: 12px 14px;
}

/* 模型数量较多时可纵向滚动，避免撑高页面 */
.vision-saved-models-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 132px;
  overflow-y: auto;
  padding-right: 4px;
}

.saved-models-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.saved-models-title {
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.saved-models-count {
  color: var(--arc-text-hint);
  font-size: 11px;
}

.saved-models-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 3px 10px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.saved-models-add:hover {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-surface));
}

.saved-models-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.saved-models-empty {
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.7;
}

.saved-models-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.saved-model-tag {
  cursor: pointer;
}

.saved-model-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 8px 4px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.saved-model-chip:hover {
  border-color: var(--arc-primary);
  color: var(--arc-text-primary);
}

.saved-model-chip.is-current {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-weight: 600;
}

.saved-model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved-model-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: var(--arc-text-hint);
  transition: background 0.15s, color 0.15s;
}

.saved-model-remove:hover {
  background: color-mix(in srgb, #ef4444 18%, transparent);
  color: #ef4444;
}

.advanced-settings {
  margin: 0 0 16px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
}

.advanced-settings summary {
  display: flex;
  align-items: center;
  min-height: 42px;
  padding: 0 14px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;
  user-select: none;
}

.advanced-settings-body {
  padding: 0 14px 14px;
}

.advanced-settings :deep(.n-input-number) {
  width: 100%;
}

.advanced-settings-hint {
  margin: -2px 0 0;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
}

.section-actions {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.benchmark-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.benchmark-history-title {
  font-size: 12px;
  color: var(--arc-text-muted);
}

.benchmark-result {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.benchmark-model {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
}

.benchmark-model strong {
  font-size: 13px;
  color: var(--arc-text);
}

.benchmark-time {
  font-size: 12px;
  color: var(--arc-text-muted);
}

.benchmark-item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-soft);
}

.benchmark-label {
  font-size: 12px;
  color: var(--arc-text-muted);
}

.benchmark-item strong {
  font-size: 13px;
  color: var(--arc-text);
}

/* ── Profile Tabs ── */
.profile-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--arc-border);
}

.profile-tab-list {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.profile-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 550;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.profile-tab:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.profile-tab.active {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  border-color: color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  color: var(--arc-primary);
}

.profile-tab-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-tab-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
  color: var(--arc-primary);
}

.profile-tab-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.profile-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.profile-action-btn:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
  background: var(--arc-bg-weak);
}

.profile-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.profile-action-btn--danger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--arc-danger) 48%, var(--arc-border));
  color: var(--arc-danger);
  background: color-mix(in srgb, var(--arc-danger) 9%, var(--arc-bg-surface));
}

.profile-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.profile-name-row .n-form-item {
  max-width: 320px;
  margin-bottom: 0;
}

.provider-home-btn {
  flex-shrink: 0;
  color: var(--arc-primary, inherit);
}

.model-input-row {
  display: flex;
  gap: 6px;
  width: 100%;
}

.model-input-row .n-select,
.model-input-row .n-input {
  flex: 1;
}

.model-fetch-btn {
  flex-shrink: 0;
}

.preset-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.preset-hint {
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.5;
}

.settings-grid-hint {
  margin: -2px 0 14px;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.5;
}

.proxy-test-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 34px;
}

.model-test-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 34px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.proxy-ip-result {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.proxy-ip-result code {
  color: var(--arc-primary);
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.spin-icon {
  animation: arc-spin 1s linear infinite;
}

@keyframes arc-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.theme-swatches {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.theme-card {
  display: flex;
  min-height: 56px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 650;
  padding: 10px;
  transition:
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.18s,
    border-color 0.18s,
    filter 0.18s;
}

.theme-card__label {
  font-size: 11.5px;
  font-weight: 650;
  line-height: 1.2;
  text-align: center;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.theme-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
  filter: brightness(1.06);
}

.theme-card:active {
  transform: scale(0.97);
}

.theme-card.active {
  border-color: color-mix(in srgb, var(--arc-primary) 70%, var(--arc-border));
  box-shadow: 0 0 0 2px var(--arc-bg-surface), 0 0 0 4px color-mix(in srgb, var(--arc-primary) 34%, transparent);
}

/* 主题主色深浅卡片（选中任意主题后显示） */
.theme-color-intensity-card {
  margin-top: 18px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  border-radius: 10px;
  padding: 14px 16px;
  background:
    radial-gradient(ellipse at 90% 0%, color-mix(in srgb, var(--arc-primary) 8%, transparent), transparent 60%),
    var(--arc-bg-surface);
  box-shadow: 0 2px 10px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.paper-texture-card__head strong {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--arc-text-primary);
}

.paper-texture-card__head p {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--arc-text-hint);
}

.paper-texture-card__control {
  margin-top: 12px;
}

.paper-texture-card__label {
  display: block;
  font-size: 12.5px;
  font-weight: 620;
  color: var(--arc-text-secondary);
  margin-bottom: 6px;
}

.paper-texture-card__slider {
  display: flex;
  align-items: center;
  gap: 12px;
}

.paper-texture-card__slider :deep(.n-slider) {
  flex: 1;
}

.paper-texture-card__value {
  width: 40px;
  text-align: right;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  color: var(--arc-text-primary);
}

.dark-mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  padding: 12px 16px;
}

.dark-mode-label {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dark-mode-label :deep(svg) {
  color: var(--arc-primary);
  flex-shrink: 0;
}

.dark-mode-text {
  font-size: 13.5px;
  font-weight: 620;
  color: var(--arc-text-primary);
}

.dark-mode-hint {
  display: block;
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 400;
}

.dark-style-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.dark-style-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.dark-style-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 36%, var(--arc-border));
  transform: translateY(-1px);
}

.dark-style-card.active {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
}

.dark-style-swatch {
  position: relative;
  height: 58px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  overflow: hidden;
}

.dark-style-swatch-surface {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 40%;
  height: 58%;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
}

.dark-style-swatch-text {
  position: absolute;
  left: 10px;
  top: 8px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.dark-style-meta strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.dark-style-meta p {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--arc-text-secondary);
}

.storage-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  margin-top: 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-weak));
  color: var(--arc-text-secondary);
  font-size: 12px;
  padding: 0 12px;
}

.storage-note :deep(svg) {
  color: var(--arc-primary);
}

.settings-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@media (max-width: 960px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    display: none;
  }
}

@media (max-width: 720px) {
  .settings-grid,
  .theme-swatches {
    grid-template-columns: 1fr;
  }

  .dark-style-grid {
    grid-template-columns: 1fr;
  }

  .settings-footer-actions {
    width: 100%;
  }

  .settings-footer-actions :deep(.n-button) {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-dot {
    transition: none;
  }
}

/* ── CC Switch 导入弹窗 ── */
.cc-switch-modal {
  width: min(620px, calc(100vw - 48px));
}

.cc-switch-intro p {
  margin: 0 0 8px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.cc-switch-warn {
  color: var(--arc-danger);
}

.cc-switch-section-title {
  margin: 16px 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--arc-text-primary);
}

.cc-switch-profile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.cc-switch-profile-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.cc-switch-profile-item.checked {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
}

.cc-switch-profile-item input {
  accent-color: var(--arc-primary);
}

.cc-switch-profile-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.cc-switch-profile-main strong {
  font-size: 13px;
  color: var(--arc-text-primary);
}

.cc-switch-profile-sub {
  color: var(--arc-text-secondary);
  font-size: 11px;
}

.cc-switch-profile-url {
  margin-left: auto;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--arc-text-secondary);
}

.cc-switch-empty {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.cc-switch-skill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cc-switch-skill-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
}

.cc-switch-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
