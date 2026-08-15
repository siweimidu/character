<script setup lang="ts">
/**
 * GlobalAgentPage · 全局智能体（DeepSeek Harness × Doubao 全新重写）
 *
 * 本页完全参考 DeepSeek Harness 的 Web UI 骨架（sidebar | conversation |
 * details 三栏 shell），并叠加 Doubao 设计 token（圆角 19.2px / 品牌蓝 / 
 * 紧凑间距），同时深度适配本小说编辑器：全部颜色走 var(--arc-*) 主题变量，
 * 任意明暗主题下按钮与文字都会自动跟随。
 *
 * 相对上一版的修复：
 *   1. 历史对话宽度加最小约束 + 主区 min-width:0，宽度缩到很小也不会乱排；
 *   2. 历史对话列表用独立滚动容器，保证可上下滑动；
 *   3. 批量删除按钮提升 z-index 并挂在固定层，悬浮可显示、可点击；
 *   4. 移除「暂存变更审阅」整块（右栏改为「能力与市场」设置面板）；
 *   5. 收敛到单个「新建会话」入口，不再重复出现「新建对话」。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderTree,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Puzzle
} from 'lucide-vue-next'
import type { SurfaceDefinition, TurnTruncateResult } from '@shared/assistant-runtime'
import type { AgentModuleRuntime } from '@shared/agent-modules'
import DeepSeekFishLogo from '@/components/assistantV2/DeepSeekFishLogo.vue'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import { createSpeechRecorder, startBrowserSpeech, toPlainSpeechSettings, uint8ArrayToBase64 } from '@/features/settings/speechInput'
import AssistantSessionList from '@/components/assistantV2/AssistantSessionList.vue'
import AssistantComposer from '@/components/assistantV2/AssistantComposer.vue'
import AgentSelector from '@/components/assistantV2/AgentSelector.vue'
import AgentMemoryDialog from '@/components/assistantV2/AgentMemoryDialog.vue'
import ReferencePickerDialog from '@/components/assistantV2/ReferencePickerDialog.vue'
import PromptLibrary from '@/components/assistantV2/PromptLibrary.vue'
import FlowNodeView from '@/components/assistantV2/FlowNodeView.vue'
import AgentModuleManager from '@/components/assistantV2/AgentModuleManager.vue'
import AgentFileExplorer from '@/components/assistantV2/AgentFileExplorer.vue'
import AgentMcpMarket from '@/components/assistantV2/AgentMcpMarket.vue'
import AgentPluginMarket from '@/components/assistantV2/AgentPluginMarket.vue'
import { toSlashSkills, useProjectSkillsLoader } from '@/features/projectSkills/useProjectSkills'

const appStore = useAppStore()
const { projects, selectedProjectId } = storeToRefs(appStore)
const message = useMessage()

// ============================================================================
// 全局智能体会话（作用于当前选中的小说项目）
// ============================================================================
const SURFACE: SurfaceDefinition = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 12
}

const assistant = useAssistant({
  projectId: () => selectedProjectId.value,
  surface: SURFACE
})

const composerValue = computed({
  get: () => assistant.composerValue.value,
  set: (value) => { assistant.composerValue.value = value }
})

const selectedAgentId = ref<string>('')
// 当前选中智能体的作用范围（'local' 本小说 / 'global' 全局），发送时一并传递。
const selectedAgentScope = ref<'local' | 'global' | undefined>(undefined)
const AGENT_SELECT_KEY = 'arc-global-agent-active-agent'
function persistAgentSelection(id: string): void {
  selectedAgentId.value = id
  try { window.localStorage.setItem(AGENT_SELECT_KEY, id) } catch { /* ignore */ }
}
function restoreAgentSelection(): void {
  try {
    const saved = window.localStorage.getItem(AGENT_SELECT_KEY)
    if (saved) selectedAgentId.value = saved
  } catch { /* ignore */ }
}

// ============================================================================
// 能力模块状态（供输入框展示已启用能力 + 语音按钮等）
// ============================================================================
const enabledModules = ref<AgentModuleRuntime[]>([])
async function refreshEnabledModules(): Promise<void> {
  try {
    const all = await window.characterArc.agentModules.list()
    enabledModules.value = all.filter((m) => m.enabled)
  } catch {
    enabledModules.value = []
  }
}

/** 是否有语音转文字能力启用。 */
const hasSpeechEnabled = computed(() =>
  enabledModules.value.some((m) => m.kind === 'speech' && m.enabled)
)

// ============================================================================
// 右栏「能力与市场」设置面板（替代原侧栏折叠抽屉，避免拥挤）
// ============================================================================
type SettingsTab = 'modules' | 'files' | 'mcp' | 'plugins'
const settingsTab = ref<SettingsTab>('modules')
const SETTINGS_TABS: Array<{ key: SettingsTab; label: string; icon: unknown }> = [
  { key: 'modules', label: '能力模块', icon: Puzzle },
  { key: 'files', label: '系统文件', icon: FolderTree },
  { key: 'mcp', label: 'MCP 市场', icon: Plug },
  { key: 'plugins', label: '插件市场', icon: Package }
]
// 创作记忆 / 引用选择对话框
const memoryDialogVisible = ref(false)
const referencePickerVisible = ref(false)
type PickedReference = { kind: 'chapter' | 'volume' | 'resource' | 'resource-dir'; id: string; label: string; path?: string }
function handleReferenceConfirm(refs: PickedReference[]): void {
  for (const ref of refs) {
    if (ref.kind === 'volume') {
      assistant.addPendingAttachment({ kind: 'chapter', ref: `volume:${ref.id}`, label: `分卷《${ref.label}》` })
    } else if (ref.kind === 'chapter') {
      assistant.addPendingAttachment({ kind: 'chapter', ref: `chapter:${ref.id}`, label: `章节《${ref.label}》` })
    } else if (ref.kind === 'resource' || ref.kind === 'resource-dir') {
      // 资源区文件/文件夹：复用资源读取逻辑
      if (ref.path) {
        void handleAddResource({ kind: ref.kind, path: ref.path, label: ref.label })
      }
    }
  }
}

/**
 * 处理资源区（文件/文件夹）拖拽或引用：读取资源内容后作为「文件」附件加入待发送区。
 * - 文件：读取文本内容内联携带，并附相对路径供 AI 用文件工具读取。
 * - 文件夹：读取目录结构作为提示内容，供 AI 了解该文件夹下有什么。
 */
async function handleAddResource(ref: { kind: 'resource' | 'resource-dir'; path: string; label: string }): Promise<void> {
  const refKey = `file:${ref.path}`
  // 防重复：同一资源只允许引用一次
  if (assistant.pendingAttachments.value.some((a) => `${a.kind}:${a.ref}` === refKey)) {
    message.warning('该资源已在待发送引用中')
    return
  }
  // 先立刻上抛「文件名芯片」，让用户第一时间看到反馈
  assistant.addPendingAttachment({
    kind: 'file',
    ref: `file:${ref.path}`,
    label: `资源：${ref.label}`,
    path: ref.path
  })

  // 资源路径兼容两种来源：
  //  - 绝对路径：来自「添加引用」对话框选择的智能体资源区（工作区根目录）文件
  //  - 相对路径：来自「项目资源」面板拖拽的项目资源（project-resources 根）文件
  const isAbsPath = /^([a-zA-Z]:[\\/]|\\\/|\/)/.test(ref.path)

  if (ref.kind === 'resource-dir') {
    // 文件夹：读取目录结构作为提示内容
    try {
      const entries = isAbsPath
        ? (await window.characterArc.agentModules.fsList({ path: ref.path }))?.entries
        : (await window.characterArc.projectResourceList({ projectId: selectedProjectId.value, path: ref.path }))?.entries
      if (entries?.length) {
        const lines = entries
          .sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hans-CN')))
          .map((e) => `${e.isDirectory ? '[文件夹] ' : '[文件] '}${e.name}`)
        const content = `【资源文件夹：${ref.label}】\n包含 ${entries.length} 项：\n${lines.join('\n')}`
        assistant.updatePendingAttachment(refKey, { content })
      }
    } catch {
      // 忽略读取失败，仅以文件名引用
    }
  } else {
    // 文件：读取文本内容内联携带
    try {
      const res = isAbsPath
        ? await window.characterArc.agentModules.fsRead({ path: ref.path })
        : await window.characterArc.projectResourceRead({ projectId: selectedProjectId.value, path: ref.path })
      if (res) {
        const content = typeof res.content === 'string' ? res.content.slice(0, 60000) : ''
        assistant.updatePendingAttachment(refKey, { content, size: res.size })
      }
    } catch {
      // 忽略读取失败，仅以文件名引用
    }
  }
}

// ============================================================================
// 当前项目上下文
// ============================================================================
const currentProject = computed(() =>
  projects.value.find((item) => item.id === selectedProjectId.value) ?? projects.value[0] ?? null
)
const projectPickerOpen = ref(false)
const projectPickerEl = ref<HTMLElement | null>(null)
function toggleProjectPicker(): void {
  projectPickerOpen.value = !projectPickerOpen.value
}
function onDocClick(event: MouseEvent): void {
  if (projectPickerOpen.value && projectPickerEl.value && !projectPickerEl.value.contains(event.target as Node)) {
    projectPickerOpen.value = false
  }
}
function selectProject(projectId: string): void {
  if (projectId !== selectedProjectId.value) {
    appStore.openProject(projectId)
    appStore.currentView = 'global-agent'
    message.success(`已切换上下文至《${currentProject.value?.title || '该小说'}》`)
  }
  projectPickerOpen.value = false
}

// ============================================================================
// 全局智能体「文件区」：选择具体文件夹作为对话产物保存的工作目录
// ============================================================================
const FILE_AREA_KEY = 'arc-global-agent-file-area'
const fileAreaPath = ref('')
function restoreFileArea(): void {
  try {
    const saved = window.localStorage.getItem(FILE_AREA_KEY)
    if (saved) fileAreaPath.value = saved
  } catch { /* ignore */ }
}
async function pickFileArea(): Promise<void> {
  try {
    const result = await window.characterArc.agentModules.pickFileAreaFolder()
    if (!result?.success || !result.path) return
    fileAreaPath.value = result.path
    try { window.localStorage.setItem(FILE_AREA_KEY, result.path) } catch { /* ignore */ }
    message.success('已设置文件区：对话产物将保存到此目录')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '选择文件区失败')
  }
}
function clearFileArea(): void {
  fileAreaPath.value = ''
  try { window.localStorage.removeItem(FILE_AREA_KEY) } catch { /* ignore */ }
  message.success('已清除文件区，产物保存回项目工作区')
}
function fileAreaName(): string {
  const p = fileAreaPath.value.trim()
  if (!p) return ''
  const segs = p.split(/[\\/]/).filter(Boolean)
  return segs[segs.length - 1] || p
}

// ============================================================================
// 发送 / 快捷操作
// ============================================================================
function sendWithMode(intentHint?: string): void {
  void assistant.send({
    intentHint: intentHint || 'global-assistant-v2:standard',
    agentId: selectedAgentId.value || undefined,
    agentScope: selectedAgentScope.value,
    fileAreaPath: fileAreaPath.value.trim() || undefined
  })
}
// 全局智能体：内置 + 项目扩展 skills 均可在 / 斜杠命令中列出（含 scope，便于分组展示）。
// 直接扫描磁盘，确保新导入的 skills 立即可见，并合并已持久化的启用状态。
const { skills: projectSkillItems } = useProjectSkillsLoader()
const availableSkills = computed(() => toSlashSkills(projectSkillItems.value))

async function handleUploadFile(): Promise<void> {
  try {
    const result = await window.characterArc.pickAssistantTextFile()
    if (!result?.success) {
      if (result?.error) message.warning(result.error)
      return
    }
    const name = result.name ?? '本地文件'
    const content = result.content ?? ''
    if (content.length > 60000) message.warning('文件内容过长，已截断前 6 万字')
    composerValue.value = `【已上传本地文件：${name}】\n${content.slice(0, 60000)}\n${composerValue.value}`
  } catch (e) {
    message.error(e instanceof Error ? e.message : '上传文件失败')
  }
}
function handleUploadFiles(files: File[]): void {
  const readers = files.map(
    (file) =>
      new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => resolve('')
        reader.readAsText(file)
      })
  )
  void Promise.all(readers).then((contents) => {
    const parts: string[] = []
    files.forEach((file, idx) => {
      const content = (contents[idx] ?? '').slice(0, 60000)
      parts.push(`【已上传本地文件：${file.name}】\n${content}`)
    })
    composerValue.value = `${parts.join('\n\n')}\n${composerValue.value}`
    message.success(`已上传 ${files.length} 个文件`)
  })
}

// ============================================================================
// 侧栏折叠 / 宽度控制（修复：宽度过小时不再乱排）
// ============================================================================
const sessionCollapsed = ref(false)
const detailsCollapsed = ref(false)
const SESSION_WIDTH_KEY = 'global-agent-session-width'
const DETAILS_WIDTH_KEY = 'global-agent-details-width'
const SESSION_DEFAULT_WIDTH = 280
const SESSION_MIN_WIDTH = 240
const SESSION_MAX_WIDTH = 360
const DETAILS_DEFAULT_WIDTH = 380
const DETAILS_MIN_WIDTH = 320
const DETAILS_MAX_WIDTH = 560

const sessionWidth = ref(SESSION_DEFAULT_WIDTH)
const detailsWidth = ref(DETAILS_DEFAULT_WIDTH)
const isSessionResizing = ref(false)
const isDetailsResizing = ref(false)

const pageStyle = computed<Record<string, string>>(() => ({
  '--session-col-width': sessionCollapsed.value ? '52px' : `${sessionWidth.value}px`,
  '--details-col-width': detailsCollapsed.value ? '48px' : `${detailsWidth.value}px`
}))

let activeResizeCleanup: (() => void) | null = null
function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const stored = window.localStorage.getItem(key)
    const parsed = stored == null ? Number.NaN : Number.parseInt(stored, 10)
    return Number.isFinite(parsed) ? clampWidth(parsed, min, max) : fallback
  } catch { return fallback }
}
function saveStoredWidth(key: string, value: number): void {
  try { window.localStorage.setItem(key, String(Math.round(value))) } catch { /* ignore */ }
}
function reopenSessionPanel(): void {
  sessionCollapsed.value = false
  sessionWidth.value = clampWidth(sessionWidth.value, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
}
function reopenDetailsPanel(): void {
  detailsCollapsed.value = false
  detailsWidth.value = clampWidth(detailsWidth.value, DETAILS_MIN_WIDTH, DETAILS_MAX_WIDTH)
}

/** 打开右侧「能力与市场」面板并切换到指定标签页。 */
function openSettings(tab: SettingsTab = 'modules'): void {
  settingsTab.value = tab
  reopenDetailsPanel()
}
function startColumnResize(side: 'session' | 'details', event: MouseEvent): void {
  event.preventDefault()
  activeResizeCleanup?.()
  const startX = event.clientX
  const startWidth = side === 'session' ? sessionWidth.value : detailsWidth.value
  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect
  isSessionResizing.value = side === 'session'
  isDetailsResizing.value = side === 'details'
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  const handleMove = (moveEvent: MouseEvent): void => {
    const delta = moveEvent.clientX - startX
    if (side === 'session') sessionWidth.value = clampWidth(startWidth + delta, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
    else detailsWidth.value = clampWidth(startWidth - delta, DETAILS_MIN_WIDTH, DETAILS_MAX_WIDTH)
  }
  const finishResize = (): void => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', finishResize)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
    saveStoredWidth(SESSION_WIDTH_KEY, sessionWidth.value)
    saveStoredWidth(DETAILS_WIDTH_KEY, detailsWidth.value)
    isSessionResizing.value = false
    isDetailsResizing.value = false
    activeResizeCleanup = null
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', finishResize)
  activeResizeCleanup = finishResize
}
function startSessionResize(event: MouseEvent): void { startColumnResize('session', event) }
function startDetailsResize(event: MouseEvent): void { startColumnResize('details', event) }

onMounted(() => {
  restoreAgentSelection()
  restoreFileArea()
  sessionWidth.value = readStoredWidth(SESSION_WIDTH_KEY, SESSION_DEFAULT_WIDTH, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
  detailsWidth.value = readStoredWidth(DETAILS_WIDTH_KEY, DETAILS_DEFAULT_WIDTH, DETAILS_MIN_WIDTH, DETAILS_MAX_WIDTH)
  document.addEventListener('click', onDocClick)
  void refreshEnabledModules()
})
onBeforeUnmount(() => {
  activeResizeCleanup?.()
  document.removeEventListener('click', onDocClick)
  // 退出全局智能体页面时，自动清理所有没有实际内容的空会话（含未发送消息的草稿会话）。
  void assistant.cleanupEmptySessions()
})

async function copyMessage(text: string): Promise<void> {
  try { await navigator.clipboard?.writeText(text); message.success('已复制') } catch { /* ignore */ }
}

function notifyTruncate(result: TurnTruncateResult, action: '撤回' | '重新分叉'): void {
  if (result.keptCommitted > 0) message.warning(`${action}完成，但 ${result.keptCommitted} 项已写回项目的改动未回滚`)
  else if (result.discardedStaged > 0) message.success(`${action}完成，已丢弃 ${result.discardedStaged} 项暂存变更`)
  else message.success(`${action}完成`)
}
async function handleUndoTurn(turnId: string): Promise<void> {
  const result = await assistant.undoTurn(turnId)
  if (result) notifyTruncate(result, '撤回')
}

// ============================================================================
// 对话流右侧透明横条：悬浮放大、点击跳转、悬浮显示缩略内容
// ============================================================================
const gaFlowRef = ref<HTMLElement | null>(null)
const turnNodes = ref<Record<string, HTMLElement | null>>({})
const railHoverIdx = ref<number | null>(null)
/** 对话流滚动标记，用于刷新横条 active 高亮。 */
const railScrollTick = ref(0)
function onFlowScroll(): void {
  railScrollTick.value++
}

function setTurnNode(turnId: string, el: unknown): void {
  if (el) {
    // FlowNodeView 为单根组件，Vue 会把根元素暴露给函数式 ref。
    const root = (el as { $el?: HTMLElement }).$el ?? (el as HTMLElement)
    turnNodes.value[turnId] = root as HTMLElement
  }
}

/** 点击横条，滚动到对应轮次对话。 */
function jumpToTurnIndex(idx: number): void {
  const msg = assistant.messages.value[idx]
  if (!msg) return
  const el = turnNodes.value[msg.turnId]
  if (el && gaFlowRef.value) {
    const top = el.offsetTop - gaFlowRef.value.clientHeight * 0.28
    gaFlowRef.value.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }
}

/** 该轮对话当前是否位于可视区内（用于高亮对应横条）。 */
function isTurnInView(turnId: string): boolean {
  // 依赖 railScrollTick 使滚动时重新计算（仅用于建立响应式依赖）
  void railScrollTick.value
  const el = turnNodes.value[turnId]
  if (!el || !gaFlowRef.value) return false
  const containerRect = gaFlowRef.value.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const top = elRect.top - containerRect.top
  const h = gaFlowRef.value.clientHeight
  return top > -40 && top < h + 40
}

/** 悬浮横条时展示的缩略内容（优先取用户提问，否则取助手回复摘要）。 */
const railHoverText = computed(() => {
  if (railHoverIdx.value === null) return ''
  const msg = assistant.messages.value[railHoverIdx.value]
  if (!msg) return ''
  const raw = (msg.userMessage || msg.assistantMessage || '').replace(/\s+/g, ' ').trim()
  return raw.length > 120 ? raw.slice(0, 120) + '…' : raw
})

/** 缩略内容浮层定位：跟随当前悬浮横条，避免超出右侧/顶部。 */
const railTipStyle = computed(() => {
  const idx = railHoverIdx.value
  const msg = idx !== null ? assistant.messages.value[idx] : undefined
  if (!msg || !gaFlowRef.value) return {}
  const el = turnNodes.value[msg.turnId]
  if (!el || !gaFlowRef.value) return {}
  // tooltip 定位在右侧 rail 旁：把当前轮次在可视区内的位置作为 tooltip 的 top，
  // 使缩略内容贴近对应对话出现，便于对照。
  const containerRect = gaFlowRef.value.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  // 相对可视区（滚动容器）的垂直位置，作为绝对定位的 top，使浮层贴近对应对话。
  const top = elRect.top - containerRect.top + gaFlowRef.value.scrollTop
  const clamped = Math.max(8, Math.min(top, gaFlowRef.value.clientHeight - 8 + gaFlowRef.value.scrollTop))
  return { top: `${clamped}px` }
})

async function handleResendTurn(): Promise<void> {
  const result = await assistant.resendEditedTurn({ intentHint: 'global-assistant-v2:chat' })
  if (result) notifyTruncate(result, '重新分叉')
}

/**
 * 点击消息上的「编辑」按钮：直接把该条用户消息复制粘贴到智能体对话框（Composer）中，
 * 不再进入内联编辑模式，避免 Composer 被置为禁用、无法输入文字。
 */
function handleEditStart(message: { userMessage: string }): void {
  assistant.cancelEditing()
  composerValue.value = message.userMessage ?? ''
}

// ============================================================================
// 语音输入（语音转文字）
// ============================================================================
const speechListening = ref(false)
let speechRecognition: {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
} | null = null
let speechRecorder: ReturnType<typeof createSpeechRecorder> | null = null
const isTranscribing = ref(false)

/** 是否已配置语音识别厂商（使用厂商 API 而非浏览器原生） */
function hasSpeechProviderConfig(): boolean {
  const s = appStore.appSettings
  return Boolean(s.speechBaseUrl?.trim() && s.speechApiKey?.trim() && s.speechModel?.trim())
}

/** 返回语音识别配置中缺失的字段提示（全部齐全返回空字符串）。 */
function speechConfigMissingHint(): string {
  const s = appStore.appSettings
  const missing: string[] = []
  if (!s.speechBaseUrl?.trim()) missing.push('Base URL')
  if (!s.speechApiKey?.trim()) missing.push('API Key')
  if (!s.speechModel?.trim()) missing.push('模型名称')
  return missing.length ? `「设置 → 语音识别配置」中尚未填写：${missing.join('、')}` : ''
}

/**
 * 将语音识别到的文本以「追加」方式写入输入框：
 * 在已有文字后补一个逗号，再接本次识别到的新句子（实时追加，而非覆盖）。
 */
function appendSpeechText(text: string): void {
  const prev = composerValue.value.trim()
  if (!prev) {
    composerValue.value = text
    return
  }
  // 已有内容以标点收尾时不额外加逗号，避免出现「，。」之类的重复标点。
  const endsWithPunct = /[，。！？；：,。!?;:]$/.test(prev)
  composerValue.value = endsWithPunct ? `${prev}${text}` : `${prev}，${text}`
}

/** 使用配置的语音识别厂商进行识别（OpenAI 兼容 /audio/transcriptions）。 */
function startProviderSpeechRecognition(): void {
  const settings = appStore.appSettings
  if (speechRecorder) {
    speechRecorder.abort()
    speechRecorder = null
    speechListening.value = false
    return
  }
  speechRecorder = createSpeechRecorder(async (audioData, mimeType) => {
    isTranscribing.value = true
    try {
      const res = await window.characterArc.transcribeSpeech({
        settings: toPlainSpeechSettings(settings),
        audioData: uint8ArrayToBase64(audioData),
        audioType: mimeType
      })
      if (!res.success) throw new Error(res.error ?? '语音识别失败')
      const text = res.result?.text?.trim()
      if (text) {
        appendSpeechText(text)
        message.success('语音识别完成')
      } else {
        message.warning('未识别到语音内容')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '语音识别失败')
    } finally {
      isTranscribing.value = false
      speechRecorder = null
      speechListening.value = false
    }
  })
  speechRecorder.start().then(() => {
    speechListening.value = true
    message.success('开始录音，请说话…（再次点击停止）')
  }).catch(() => {
    speechRecorder = null
    message.error('无法访问麦克风，请检查系统权限；或改用浏览器原生语音输入。')
  })
}

/** 语音输入（优先使用配置的语音识别厂商，否则回退浏览器 Web Speech API）。 */
function handleVoiceInput(): void {
  if (speechListening.value || isTranscribing.value) {
    speechRecognition?.stop()
    speechRecorder?.stop()
    speechListening.value = false
    return
  }
  // 已配置语音识别厂商：走厂商 API
  if (hasSpeechProviderConfig()) {
    startProviderSpeechRecognition()
    return
  }
  // 回退：浏览器原生 Web Speech API（其 onresult 回调传入的是自录音起累积的完整文本，
  // 已包含此前所有已识别内容，直接覆盖即可得到最新完整识别结果，无需也不应追加）。
  const browser = startBrowserSpeech((text) => {
    if (text) composerValue.value = text
  }, () => {
    speechListening.value = false
  })
  if (!browser.supported) {
    const missing = speechConfigMissingHint()
    message.warning(
      missing
        ? `当前环境不支持浏览器语音输入，且${missing}。请补齐后重试，或在「设置 → 语音识别配置」中填写厂商信息。`
        : '未配置语音识别厂商且当前环境不支持浏览器语音输入，请使用 Chrome/Edge，或在「设置 → 语音识别配置」中填写厂商信息。'
    )
    return
  }
  speechRecognition = browser as unknown as typeof speechRecognition
  speechListening.value = true
  message.success('开始录音，请说话…（再次点击停止）')
}

</script>

<template>
  <div
    class="ga-page"
    :class="{
      'details-collapsed': detailsCollapsed,
      'session-collapsed': sessionCollapsed,
      'session-resizing': isSessionResizing,
      'details-resizing': isDetailsResizing
    }"
    :style="pageStyle"
  >
    <!-- 左侧折叠窄条 / 侧栏 共用第一列 -->
    <div v-if="sessionCollapsed" class="ga-session-mini">
      <button type="button" class="ga-mini-expand" title="展开对话历史" @click="reopenSessionPanel">
        <PanelLeftOpen :size="16" />
      </button>
    </div>
    <div v-else class="ga-sidebar">
      <div class="ga-logo-row">
        <button
          type="button"
          class="ga-brand"
          title="新建会话"
          aria-label="新建会话"
          @click="assistant.createSession()"
        >
          <DeepSeekFishLogo :size="20" class="ga-brand-icon" />
          <span class="ga-brand-name">全局智能体</span>
          <span class="ga-brand-badge">HARNESS</span>
        </button>
        <button type="button" class="ga-back" title="收起左侧" @click="sessionCollapsed = true">
          <PanelLeftClose :size="16" />
        </button>
      </div>

      <!-- 唯一「新建会话」入口（不再重复出现） -->
      <button
        type="button"
        class="ga-new-session"
        title="新建会话"
        @click="assistant.createSession()"
      >
        <Plus :size="14" />
        <span>新建会话</span>
      </button>

      <!-- 会话历史（独立滚动，修复上下无法滑动） -->
      <div class="ga-session-region arc-scrollbar">
        <AssistantSessionList
          :sessions="assistant.sessions.value"
          :active-session-id="assistant.activeSessionId.value"
          hide-new-button
          @switch="(id) => assistant.switchSession(id)"
          @create="() => assistant.createSession()"
          @delete="(id) => assistant.deleteSession(id)"
          @delete-batch="(ids) => assistant.deleteSessions(ids)"
          @rename="(id, title) => assistant.renameSession(id, title)"
          @collapse="reopenSessionPanel"
        />
      </div>

      <!-- 侧栏底部 -->
      <div class="ga-sidebar-foot">
        <!-- 文件区（工作目录）：对话产物保存位置 -->
        <div class="ga-file-area-card">
          <div class="ga-ctx-label">文件区 · 产物保存目录</div>
          <button type="button" class="ga-file-area-select" title="选择文件夹作为文件区" @click="pickFileArea">
            <FolderTree :size="14" class="ga-file-area-icon" />
            <span v-if="fileAreaPath" class="ga-file-area-name">{{ fileAreaName() }}</span>
            <span v-else class="ga-file-area-name muted">未选择（默认项目工作区）</span>
          </button>
          <div v-if="fileAreaPath" class="ga-file-area-path" :title="fileAreaPath">{{ fileAreaPath }}</div>
          <div class="ga-file-area-actions">
            <button type="button" class="ga-file-area-pick" @click="pickFileArea">
              <FolderOpen :size="12" />
              <span>{{ fileAreaPath ? '更换文件夹' : '选择文件夹' }}</span>
            </button>
            <button v-if="fileAreaPath" type="button" class="ga-file-area-clear" @click="clearFileArea">清除</button>
          </div>
        </div>

        <!-- 项目上下文选择器 -->
        <div ref="projectPickerEl" class="ga-ctx-card" @click="toggleProjectPicker">
          <div class="ga-ctx-label">当前上下文 · 小说项目</div>
          <button type="button" class="ga-ctx-select">
            <span v-if="currentProject" class="ga-ctx-title">{{ currentProject.title || '未命名小说' }}</span>
            <span v-else class="ga-ctx-title muted">未选择小说</span>
            <ChevronDown :size="13" class="ga-ctx-caret" :class="{ open: projectPickerOpen }" />
          </button>
          <div v-if="currentProject" class="ga-ctx-meta">
            {{ currentProject.genre || '未分类' }} · {{ currentProject.novelLength === 'short' ? '短篇' : '长篇' }}
          </div>

          <div v-if="projectPickerOpen" class="ga-ctx-dropdown" @click.stop>
            <div class="ga-ctx-dropdown-head">选择小说项目</div>
            <div class="ga-ctx-dropdown-list arc-scrollbar">
              <button
                v-for="project in projects"
                :key="project.id"
                type="button"
                class="ga-ctx-option"
                :class="{ active: project.id === selectedProjectId }"
                @click="selectProject(project.id)"
              >
                <span class="ga-ctx-option-title">{{ project.title || '未命名小说' }}</span>
                <span class="ga-ctx-option-meta">{{ project.genre || '未分类' }}</span>
              </button>
              <div v-if="projects.length === 0" class="ga-ctx-dropdown-empty">暂无小说项目，请先返回主页创建。</div>
            </div>
          </div>
        </div>

        <!-- 能力与市场入口按钮已按要求隐藏，右栏面板仍可通过右侧标签页访问 -->
      </div>
    </div>

    <!-- 会话分栏拖拽（绝对定位浮层，不占网格列） -->
    <div
      class="col-resizer ga-session-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左侧栏宽度"
      tabindex="0"
      @mousedown="startSessionResize"
    />

    <!-- ============ 中间：智能体对话 ============ -->
    <div class="ga-main">
      <div class="ga-agent-toolbar">
        <AgentSelector
          v-model="selectedAgentId"
          :project-id="selectedProjectId"
          default-scope="global"
          @update:model-value="persistAgentSelection"
          @update:scope="(s) => { selectedAgentScope = s }"
        />
        <button class="ga-memory-toggle" title="创作记忆（学习闭环）" @click="memoryDialogVisible = true">
          <Brain :size="14" />
        </button>
      </div>

      <AgentMemoryDialog
        :visible="memoryDialogVisible"
        :project-id="selectedProjectId"
        @close="memoryDialogVisible = false"
      />

      <ReferencePickerDialog
        v-model:visible="referencePickerVisible"
        @confirm="handleReferenceConfirm"
      />

      <!-- 对话流（自动折叠） -->
      <div
        v-if="assistant.messages.value.length > 0 || assistant.isStreaming.value"
        ref="gaFlowRef"
        class="ga-flow arc-scrollbar"
        @scroll.passive="onFlowScroll"
      >
        <FlowNodeView
          v-for="msg in assistant.messages.value"
          :key="msg.turnId"
          :ref="(el) => setTurnNode(msg.turnId, el)"
          :message="msg"
          :auto-collapse="true"
          @edit-start="() => handleEditStart(msg)"
          @undo="() => handleUndoTurn(msg.turnId)"
          @resend="() => handleResendTurn()"
          @copy="() => copyMessage(msg.assistantMessage)"
        />

        <!-- 右侧透明横条：悬浮放大、点击跳转、悬浮显示缩略内容 -->
        <div
          v-if="assistant.messages.value.length > 1"
          class="ga-turn-rail"
          aria-hidden="true"
        >
          <button
            v-for="(msg, idx) in assistant.messages.value"
            :key="'ga-rail-' + msg.turnId"
            type="button"
            class="ga-rail-tick"
            :class="{ active: isTurnInView(msg.turnId), hover: railHoverIdx === idx }"
            @mouseenter="railHoverIdx = idx"
            @mouseleave="railHoverIdx = null"
            @click="jumpToTurnIndex(idx)"
          />
        </div>

        <!-- 悬浮横条时显示的缩略内容浮层（相对对话流容器定位） -->
        <div
          v-if="railHoverIdx !== null && assistant.messages.value[railHoverIdx]"
          class="ga-rail-tip"
          :style="railTipStyle"
        >
          <span class="ga-rail-tip-label">第 {{ railHoverIdx + 1 }} 轮对话</span>
          <span class="ga-rail-tip-text">{{ railHoverText }}</span>
        </div>
      </div>

      <!-- Hero 空状态 -->
      <div v-else class="ga-starter">
        <div class="ga-starter-inner">
          <div class="ga-starter-hero">
            <DeepSeekFishLogo :size="34" class="ga-starter-fish" />
            <h2 class="ga-starter-headline">全局智能体</h2>
            <span class="ga-starter-preview">Preview</span>
          </div>

          <PromptLibrary
            :project-id="selectedProjectId"
            :on-use="(p) => { composerValue = p }"
          />
        </div>
      </div>

      <div v-if="assistant.lastError.value" class="ga-err-banner">
        {{ assistant.lastError.value }}
      </div>

      <AssistantComposer
        v-model="composerValue"
        :is-streaming="assistant.isStreaming.value"
        :is-canceling="assistant.isCanceling.value"
        :is-editing="Boolean(assistant.editingTurnId.value)"
        :restored-label="assistant.restoredDraftLabel.value"
        :attachments="assistant.pendingAttachments.value"
        :skills="availableSkills"
        :project-id="selectedProjectId"
        :enabled-modules="enabledModules"
        :speech-listening="speechListening"
        @send="sendWithMode"
        @attach="referencePickerVisible = true"
        @apply-skill="(skill) => assistant.addPendingAttachment({ kind: 'skill', ref: `skill:${skill.id}`, label: skill.label })"
        @add-reference="(ref) => {
          if (ref.kind === 'volume') {
            assistant.addPendingAttachment({ kind: 'chapter', ref: `volume:${ref.id}`, label: `分卷《${ref.label}》` })
          } else {
            assistant.addPendingAttachment({ kind: 'chapter', ref: `chapter:${ref.id}`, label: `章节《${ref.label}》` })
          }
        }"
        @add-resource="handleAddResource"
        @remove-attachment="(key) => assistant.removePendingAttachment(key)"
        @upload-file="handleUploadFile"
        @upload-files="handleUploadFiles"
        @add-file="(file) => assistant.addPendingAttachment({ kind: 'file', ref: `file:${file.name}`, label: file.name, content: file.content, mime: file.mime, size: file.size, path: file.path })"
        @update-file="(refKey, patch) => assistant.updatePendingAttachment(refKey, patch)"
        @cancel="assistant.cancel()"
        @edit-last="assistant.startEditingLastTurn()"
        @clear-restored="assistant.clearRestoredDraft()"
        @voice-input="handleVoiceInput"
      />
    </div>

    <!-- 右侧折叠窄条 / 设置面板 共用第三列 -->
    <div v-if="detailsCollapsed" class="ga-details-mini">
      <button type="button" class="ga-mini-expand" title="展开能力与市场" @click="reopenDetailsPanel">
        <PanelLeftClose :size="16" />
      </button>
    </div>

    <div v-else class="ga-details-col">
      <div class="ga-details-head">
        <span class="ga-details-title">能力与市场</span>
        <button type="button" class="ga-collapse-btn" title="收起" @click="detailsCollapsed = true">
          <ChevronRight :size="16" />
        </button>
      </div>
      <div class="ga-details-tabs">
        <button
          v-for="tab in SETTINGS_TABS"
          :key="tab.key"
          type="button"
          class="ga-tab"
          :class="{ active: settingsTab === tab.key }"
          :title="tab.label"
          @click="settingsTab = tab.key"
        >
          <component :is="tab.icon" :size="14" />
          <span>{{ tab.label }}</span>
        </button>
      </div>
      <div class="ga-details-pane arc-scrollbar">
        <AgentModuleManager v-if="settingsTab === 'modules'" @change="refreshEnabledModules" />
        <AgentFileExplorer v-else-if="settingsTab === 'files'" />
        <AgentMcpMarket v-else-if="settingsTab === 'mcp'" />
        <AgentPluginMarket v-else-if="settingsTab === 'plugins'" />
      </div>
    </div>

    <!-- 详情分栏拖拽（绝对定位浮层，不占网格列） -->
    <div
      class="col-resizer ga-details-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整右栏宽度"
      tabindex="0"
      @mousedown="startDetailsResize"
    />
  </div>
</template>

<style scoped>
.ga-page {
  /* Doubao 设计 token */
  --ga-primary: var(--arc-primary);
  --ga-primary-soft: var(--arc-primary-soft);
  --ga-radius: 19.2px;
  --ga-radius-sm: 12px;
  --ga-muted: #eff1f4;
  --ga-border: #e7eaef;
  --ga-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace;
  --session-col-width: 280px;
  --details-col-width: 380px;

  display: grid;
  grid-template-columns: var(--session-col-width) minmax(0, 1fr) var(--details-col-width);
  position: relative;
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
  letter-spacing: -0.005em;
}

/* ============ 左侧侧栏 ============ */
.ga-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.ga-logo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 14px 10px;
}
.ga-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 4px 6px;
  margin: 0;
  cursor: pointer;
  font-family: inherit;
  color: var(--arc-text-primary);
  border-radius: 10px;
  min-width: 0;
  transition: background 0.15s ease;
}
.ga-brand:hover { background: var(--ga-primary-soft); }
.ga-brand-icon { color: var(--arc-primary); flex-shrink: 0; }
.ga-brand-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--arc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ga-brand-badge {
  font-family: var(--ga-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--arc-primary);
  color: var(--arc-primary-foreground, #fff);
  line-height: 1.2;
  flex-shrink: 0;
}
.ga-back {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.ga-back:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
}
.ga-new-session {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 2px 14px 10px;
  padding: 10px 12px;
  border: 1px solid var(--arc-primary);
  border-radius: 999px;
  background: var(--arc-primary);
  color: var(--arc-primary-foreground, #fff);
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  flex-shrink: 0;
}
.ga-new-session:hover {
  filter: brightness(1.05);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 24%, transparent);
}
.ga-session-region {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  /* 历史对话列表自身提供滚动（AssistantSessionList .list），修复上下无法滑动 */
}
.ga-sidebar-foot {
  border-top: 1px solid var(--arc-border);
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
/* 项目上下文卡片 */
.ga-ctx-card {
  position: relative;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ga-ctx-card:hover { border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border)); }
.ga-ctx-label {
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
  margin-bottom: 4px;
}
.ga-ctx-select {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.ga-ctx-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ga-ctx-title.muted { color: var(--arc-text-hint); font-weight: 500; }
.ga-ctx-caret { flex: 0 0 auto; color: var(--arc-text-hint); transition: transform 0.18s ease; }
.ga-ctx-caret.open { transform: rotate(180deg); }
.ga-ctx-meta { margin-top: 3px; font-size: 11.5px; color: var(--arc-text-secondary); }
.ga-ctx-dropdown {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 30;
  max-height: 260px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--arc-border-strong);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-md);
}
.ga-ctx-dropdown-head {
  padding: 8px 12px;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
  border-bottom: 1px solid var(--arc-border);
}
.ga-ctx-dropdown-list { display: flex; flex-direction: column; overflow-y: auto; padding: 4px; }
.ga-ctx-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.ga-ctx-option:hover { background: var(--arc-bg-weak); }
.ga-ctx-option.active { background: var(--ga-primary-soft); }
.ga-ctx-option-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ga-ctx-option.active .ga-ctx-option-title { color: var(--arc-primary); }
.ga-ctx-option-meta { flex: 0 0 auto; font-size: 11px; color: var(--arc-text-hint); }
.ga-ctx-dropdown-empty { padding: 14px 12px; font-size: 12px; color: var(--arc-text-hint); text-align: center; }

/* 文件区（工作目录）卡片 */
.ga-file-area-card {
  position: relative;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  border: 1px solid color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ga-file-area-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 42%, var(--arc-border));
}
.ga-file-area-select {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}
.ga-file-area-icon { flex: 0 0 auto; color: var(--arc-primary); }
.ga-file-area-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ga-file-area-name.muted { color: var(--arc-text-hint); font-weight: 500; }
.ga-file-area-path {
  margin-top: 4px;
  font-size: 10.5px;
  color: var(--arc-text-hint);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.ga-file-area-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.ga-file-area-pick {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ga-file-area-pick:hover {
  background: color-mix(in srgb, var(--arc-primary) 16%, var(--arc-bg-surface));
  border-color: color-mix(in srgb, var(--arc-primary) 55%, var(--arc-border));
}
.ga-file-area-clear {
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ga-file-area-clear:hover {
  color: var(--arc-danger);
  border-color: color-mix(in srgb, var(--arc-danger) 30%, var(--arc-border));
}


/* 折叠窄条 */
.ga-session-mini, .ga-details-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 18px;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.ga-details-mini { border-right: none; border-left: 1px solid var(--arc-border); }
.ga-mini-expand {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: 8px;
  transition: background 0.15s ease, color 0.15s ease;
}
.ga-mini-expand:hover { background: var(--arc-bg-weak); color: var(--arc-primary); }

/* 分栏拖拽（绝对定位浮层） */
.col-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: col-resize;
  outline: none;
  background: transparent;
}
.col-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 2px;
  background: transparent;
  transition: background 0.15s ease;
}
.col-resizer:hover::after, .col-resizer:focus-visible::after { background: var(--arc-primary); }
.ga-session-resizer {
  left: var(--session-col-width);
  margin-left: -5px;
}
.ga-details-resizer {
  right: var(--details-col-width);
  margin-right: -5px;
}
.ga-session-resizing .ga-session-resizer::after,
.ga-details-resizing .ga-details-resizer::after { background: var(--arc-primary); }

/* ============ 中间对话区 ============ */
.ga-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  position: relative;
}
.ga-agent-toolbar {
  padding: 14px 36px 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 10;
}
.ga-agent-toolbar :deep(.agent-selector) { flex: 1 1 auto; min-width: 0; }
.ga-memory-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  min-width: 44px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-primary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
  box-sizing: border-box;
}
.ga-memory-toggle:hover {
  background: var(--ga-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
}
.ga-flow {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
}

/* ── 对话流右侧透明横条（悬浮放大 / 点击跳转 / 悬浮显示缩略内容）── */
.ga-turn-rail {
  position: sticky;
  top: 50%;
  transform: translateY(-50%);
  align-self: flex-end;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 12px;
  flex: 0 0 auto;
  margin-top: -18px;
  pointer-events: none;
}
.ga-rail-tick {
  flex: 0 1 auto;
  width: 6px;
  min-height: 4px;
  max-height: 16px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-text-primary) 16%, transparent);
  cursor: pointer;
  padding: 0;
  opacity: 0.9;
  transition: background 0.18s ease, transform 0.18s ease, width 0.18s ease, flex-basis 0.18s ease;
  pointer-events: auto;
}
.ga-rail-tick:hover,
.ga-rail-tick.hover {
  background: color-mix(in srgb, var(--arc-primary) 60%, transparent);
  transform: scaleX(2.4);
  width: 13px;
}
.ga-rail-tick.active {
  background: color-mix(in srgb, var(--arc-primary) 75%, transparent);
}
.ga-rail-tip {
  position: absolute;
  right: 48px;
  transform: translateY(-50%);
  max-width: 260px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--arc-border-strong);
  background: color-mix(in srgb, var(--arc-bg-surface) 94%, transparent);
  box-shadow: var(--arc-shadow-lg);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--arc-text-primary);
  display: flex;
  flex-direction: column;
  gap: 3px;
  pointer-events: none;
  z-index: 12;
  backdrop-filter: blur(4px);
}
.ga-rail-tip-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--arc-primary);
}
.ga-rail-tip-text {
  min-width: 0;
  overflow-wrap: break-word;
  color: var(--arc-text-secondary);
}
.ga-starter {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 32px;
}
.ga-starter-inner { width: min(720px, 100%); display: flex; flex-direction: column; gap: 18px; }
.ga-starter-hero {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.ga-starter-fish { color: var(--arc-primary); flex-shrink: 0; }
.ga-starter-headline {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 30px;
  line-height: 1.1;
  font-weight: 750;
  letter-spacing: -0.02em;
}
.ga-starter-preview {
  font-family: var(--ga-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--arc-primary);
  border: 1px solid color-mix(in srgb, var(--arc-primary) 35%, transparent);
  background: var(--ga-primary-soft);
  padding: 3px 8px;
  border-radius: 999px;
  align-self: flex-start;
  margin-top: 2px;
}
.ga-err-banner {
  margin: 0 32px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--arc-danger) 24%, transparent);
  color: var(--arc-danger);
  font-size: 12.5px;
}

/* ============ 右侧设置面板 ============ */
.ga-details-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.ga-details-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--arc-border);
  flex-shrink: 0;
  background: var(--arc-bg-surface);
}
.ga-details-title { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--arc-text-primary); }
.ga-collapse-btn {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.ga-collapse-btn:hover { background: var(--arc-bg-weak); color: var(--arc-text-primary); }
.ga-details-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  padding: 6px;
  border-bottom: 1px solid var(--arc-border);
  flex-shrink: 0;
}
.ga-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 7px 2px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 9.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 0;
}
.ga-tab span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ga-tab:hover { background: var(--arc-bg-weak); color: var(--arc-text-primary); }
.ga-tab.active {
  border-color: color-mix(in srgb, var(--arc-primary) 35%, transparent);
  background: var(--ga-primary-soft);
  color: var(--arc-primary);
}
.ga-details-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* ============ 响应式：中等宽度隐藏右栏 ============ */
@media (max-width: 1080px) {
  .ga-page {
    grid-template-columns: var(--session-col-width) minmax(0, 1fr);
  }
  .ga-details-col, .ga-details-mini, .ga-details-resizer { display: none; }
}
@media (max-width: 780px) {
  .ga-page {
    grid-template-columns: minmax(0, 1fr);
  }
  .ga-sidebar, .ga-session-mini, .ga-session-resizer { display: none; }
}
</style>
