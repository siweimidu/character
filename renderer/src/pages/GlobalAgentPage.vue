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
  ArrowLeft,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
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
import AiProviderIcon from '@/components/assistantV2/AiProviderIcon.vue'
import DeepSeekFishLogo from '@/components/assistantV2/DeepSeekFishLogo.vue'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import { createSpeechRecorder, startBrowserSpeech } from '@/features/settings/speechInput'
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
type PickedReference = { kind: 'chapter' | 'volume'; id: string; label: string }
function handleReferenceConfirm(refs: PickedReference[]): void {
  for (const ref of refs) {
    if (ref.kind === 'volume') {
      assistant.addPendingAttachment({ kind: 'chapter', ref: `volume:${ref.id}`, label: `分卷《${ref.label}》` })
    } else {
      assistant.addPendingAttachment({ kind: 'chapter', ref: `chapter:${ref.id}`, label: `章节《${ref.label}》` })
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
  if (modelMenuOpen.value && modelMenuEl.value && !modelMenuEl.value.contains(event.target as Node)) {
    modelMenuOpen.value = false
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
// 当前 AI 接口 / 模型
// ============================================================================
const activeProfileName = computed(() => {
  const profile = appStore.appSettings.aiProfiles.find(
    (p) => p.id === appStore.appSettings.activeAiProfileId
  )
  return profile?.name || appStore.appSettings.provider || '未配置'
})
const activeProvider = computed(() => {
  const profile = appStore.appSettings.aiProfiles.find(
    (p) => p.id === appStore.appSettings.activeAiProfileId
  )
  return profile?.provider || appStore.appSettings.provider || ''
})
const activeModel = computed(() => appStore.appSettings.model || '未选模型')

// 模型选择菜单（DeepSeek Harness ModelSelect 两级下拉）
type ModelPane = 'root' | 'model' | 'profile'
const modelMenuOpen = ref(false)
const modelPane = ref<ModelPane>('root')
const modelMenuEl = ref<HTMLElement | null>(null)
const modelOptionsList = computed(() => {
  const activeProfile = appStore.appSettings.aiProfiles.find(
    (p) => p.id === appStore.appSettings.activeAiProfileId
  )
  const savedModels = activeProfile?.models?.filter(Boolean) ?? []
  if (savedModels.length > 0) return savedModels
  const current = appStore.appSettings.model
  return current ? [current] : []
})
const profileOptionsList = computed(() =>
  appStore.appSettings.aiProfiles.map((p) => ({ id: p.id, name: p.name }))
)
function toggleModelMenu(): void {
  modelMenuOpen.value = !modelMenuOpen.value
  modelPane.value = 'root'
}
function chooseModel(model: string): void {
  appStore.updateActiveAiProfileModel(model)
  modelMenuOpen.value = false
}
function switchProfile(id: string): void {
  appStore.switchAiProfile(id)
  modelMenuOpen.value = false
}

// ============================================================================
// 发送 / 快捷操作
// ============================================================================
function sendWithMode(intentHint?: string): void {
  void assistant.send({
    intentHint: intentHint || 'global-assistant-v2:chat',
    agentId: selectedAgentId.value || undefined
  })
}
function fillQuickAction(prompt: string): void {
  composerValue.value = prompt
}
const quickActions: Array<{ label: string; prompt: string }> = [
  { label: '整理项目现状', prompt: '请读取项目资料，整理当前项目概况、下一步创作计划和需要沉淀的创作记忆。' },
  { label: '全项目审计', prompt: '请审计当前项目的一致性风险，包括世界观矛盾、人物 OOC、大纲断裂、伏笔未回收和硬约束冲突。' },
  { label: '补全创作记忆', prompt: '请基于现有项目资料，补全当前状态、创作计划、待回收伏笔和素材清单。' }
]

const availableSkills = computed(() =>
  (currentProject.value?.projectSkills ?? [])
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, name: s.name, description: s.description }))
)

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
  sessionWidth.value = readStoredWidth(SESSION_WIDTH_KEY, SESSION_DEFAULT_WIDTH, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
  detailsWidth.value = readStoredWidth(DETAILS_WIDTH_KEY, DETAILS_DEFAULT_WIDTH, DETAILS_MIN_WIDTH, DETAILS_MAX_WIDTH)
  document.addEventListener('click', onDocClick)
  void refreshEnabledModules()
})
onBeforeUnmount(() => {
  activeResizeCleanup?.()
  document.removeEventListener('click', onDocClick)
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
async function handleResendTurn(): Promise<void> {
  const result = await assistant.resendEditedTurn({ intentHint: 'global-assistant-v2:chat' })
  if (result) notifyTruncate(result, '重新分叉')
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
        settings,
        audioData,
        audioType: mimeType
      })
      if (!res.success) throw new Error(res.error ?? '语音识别失败')
      const text = res.result?.text?.trim()
      if (text) {
        composerValue.value = text
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
  // 回退：浏览器原生 Web Speech API
  const browser = startBrowserSpeech((text) => {
    if (text) composerValue.value = text
  }, () => {
    speechListening.value = false
  })
  if (!browser.supported) {
    message.warning('未配置语音识别厂商且当前环境不支持浏览器语音输入，请使用 Chrome/Edge，或在「设置 → 语音识别配置」中填写厂商信息。')
    return
  }
  speechRecognition = browser as unknown as typeof speechRecognition
  speechListening.value = true
  message.success('开始录音，请说话…（再次点击停止）')
}

// ============================================================================
// 项目 CRUD 能力（供自然语言调用：新建 / 删除项目等）
// ============================================================================
function requestCreateProject(): void {
  appStore.openWizard()
}
function handleDeleteProject(projectId: string): void {
  const target = projects.value.find((p) => p.id === projectId)
  if (!target) return
  appStore.deleteProject(projectId)
  message.success(`已删除项目《${target.title || '未命名'}》`)
}</script>

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
        <button type="button" class="ga-back" title="返回上一个页面" @click="appStore.navigateBack()">
          <ArrowLeft :size="16" />
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

        <!-- AI 接口 / 模型选择 -->
        <div ref="modelMenuEl" class="ga-model-menu-wrap">
          <button type="button" class="ga-ai-indicator" :class="{ open: modelMenuOpen }" @click="toggleModelMenu">
            <AiProviderIcon :provider="activeProvider" :size="14" />
            <span class="ga-ai-indicator-name">{{ activeProfileName }}</span>
            <span class="ga-ai-indicator-sep">·</span>
            <span class="ga-ai-indicator-model">{{ activeModel }}</span>
            <ChevronDown :size="12" class="ga-model-caret" :class="{ open: modelMenuOpen }" />
          </button>

          <div v-if="modelMenuOpen" class="ga-model-menu" role="menu" @click.stop>
            <template v-if="modelPane === 'root'">
              <button type="button" role="menuitem" class="ga-model-cell" @click="modelPane = 'model'">
                <span class="ga-model-cell-label">模型</span>
                <span class="ga-model-cell-value">{{ activeModel }}</span>
                <ChevronRight :size="13" class="ga-model-cell-chevron" />
              </button>
              <button type="button" role="menuitem" class="ga-model-cell" @click="modelPane = 'profile'">
                <span class="ga-model-cell-label">接口</span>
                <span class="ga-model-cell-value">{{ activeProfileName }}</span>
                <ChevronRight :size="13" class="ga-model-cell-chevron" />
              </button>
            </template>

            <template v-if="modelPane === 'model'">
              <div class="ga-model-menu-head">选择模型</div>
              <div class="ga-model-menu-list arc-scrollbar">
                <button
                  v-for="m in modelOptionsList"
                  :key="m"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="activeModel === m"
                  class="ga-model-option"
                  :class="{ selected: activeModel === m }"
                  @click="chooseModel(m)"
                >
                  <span class="ga-model-option-name">{{ m }}</span>
                  <Check v-if="activeModel === m" :size="14" class="ga-model-check" />
                </button>
                <div v-if="modelOptionsList.length === 0" class="ga-model-menu-empty">暂无可选模型，请先在接口配置中添加。</div>
              </div>
            </template>

            <template v-if="modelPane === 'profile'">
              <div class="ga-model-menu-head">选择 AI 接口</div>
              <div class="ga-model-menu-list arc-scrollbar">
                <button
                  v-for="p in profileOptionsList"
                  :key="p.id"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="appStore.appSettings.activeAiProfileId === p.id"
                  class="ga-model-option"
                  :class="{ selected: appStore.appSettings.activeAiProfileId === p.id }"
                  @click="switchProfile(p.id)"
                >
                  <span class="ga-model-option-name">{{ p.name }}</span>
                  <Check v-if="appStore.appSettings.activeAiProfileId === p.id" :size="14" class="ga-model-check" />
                </button>
                <div v-if="profileOptionsList.length === 0" class="ga-model-menu-empty">暂无 AI 接口，请先在设置中配置。</div>
              </div>
            </template>
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
      <div v-if="assistant.isStreaming.value" class="stream-strip">
        <span class="dot" /> 生成中…
      </div>

      <div class="ga-agent-toolbar">
        <AgentSelector
          v-model="selectedAgentId"
          :project-id="selectedProjectId"
          @update:model-value="persistAgentSelection"
        />
        <button class="ga-memory-toggle" title="创作记忆（学习闭环）" @click="memoryDialogVisible = true">
          <Brain :size="14" />
        </button>
        <button
          v-if="enabledModules.length > 0"
          class="ga-cap-indicator"
          :title="`已启用 ${enabledModules.length} 个能力模块，点击查看`"
          @click="openSettings('modules')"
        >
          <Puzzle :size="14" />
          <span>{{ enabledModules.length }}</span>
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
        class="ga-flow arc-scrollbar"
      >
        <FlowNodeView
          v-for="msg in assistant.messages.value"
          :key="msg.turnId"
          :message="msg"
          :auto-collapse="true"
          @edit-start="() => assistant.startEditingTurn(msg.turnId)"
          @undo="() => handleUndoTurn(msg.turnId)"
          @resend="() => handleResendTurn()"
          @copy="() => copyMessage(msg.assistantMessage)"
        />
      </div>

      <!-- Hero 空状态 -->
      <div v-else class="ga-starter">
        <div class="ga-starter-inner">
          <div class="ga-starter-hero">
            <DeepSeekFishLogo :size="34" class="ga-starter-fish" />
            <h2 class="ga-starter-headline">全局智能体</h2>
            <span class="ga-starter-preview">Preview</span>
          </div>
          <p class="ga-starter-sub">
            需要我为你的创作做点什么？我可以读写任意文件、写代码、调用 MCP 工具、管理你的小说项目。
            所有能力都遵循 everything-is-a-plugin 原则，可在右侧「能力与市场」中按插件独立启停。
          </p>

          <div class="ga-project-actions">
            <button type="button" class="ga-project-btn" @click="requestCreateProject">
              <Plus :size="13" /> 新建项目
            </button>
            <button
              v-if="currentProject"
              type="button"
              class="ga-project-btn ghost"
              @click="handleDeleteProject(currentProject.id)"
            >
              删除当前项目
            </button>
          </div>

          <div class="ga-quick-title">常用快捷操作</div>
          <div class="ga-quick-row">
            <button
              v-for="action in quickActions"
              :key="action.label"
              type="button"
              class="ga-quick-card"
              @click="fillQuickAction(action.prompt)"
            >
              {{ action.label }}
            </button>
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
        @remove-attachment="(key) => assistant.removePendingAttachment(key)"
        @upload-file="handleUploadFile"
        @upload-files="handleUploadFiles"
        @add-file="(file) => assistant.addPendingAttachment({ kind: 'file', ref: `file:${file.name}`, label: file.name, content: file.content, mime: file.mime, size: file.size, path: file.path })"
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

/* AI 指示器 */
.ga-model-menu-wrap { position: relative; }
.ga-ai-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  border: 1px solid color-mix(in srgb, var(--arc-primary) 16%, var(--arc-border));
  color: var(--arc-text-secondary);
  font-size: 11px;
  min-width: 0;
  width: 100%;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ga-ai-indicator:hover, .ga-ai-indicator.open {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
}
.ga-model-caret { flex: 0 0 auto; color: var(--arc-text-hint); transition: transform 0.18s ease; }
.ga-model-caret.open { transform: rotate(180deg); }
.ga-ai-indicator-name {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--arc-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 38%;
}
.ga-ai-indicator-sep { flex: 0 0 auto; color: var(--arc-text-hint); }
.ga-ai-indicator-model {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ga-model-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 40;
  min-width: 200px;
  overflow: hidden;
  border: 1px solid var(--arc-border-strong);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-md);
}
.ga-model-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 11px 12px;
  border: none;
  border-bottom: 1px solid var(--arc-border);
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.ga-model-cell:hover { background: var(--arc-bg-weak); }
.ga-model-cell-label { font-size: 12.5px; font-weight: 600; color: var(--arc-text-primary); }
.ga-model-cell-value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11.5px;
  color: var(--arc-text-hint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.ga-model-cell-chevron { flex: 0 0 auto; color: var(--arc-text-hint); }
.ga-model-menu-head {
  padding: 8px 12px;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
  border-bottom: 1px solid var(--arc-border);
}
.ga-model-menu-list { max-height: 220px; overflow-y: auto; padding: 4px; }
.ga-model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.ga-model-option:hover { background: var(--arc-bg-weak); }
.ga-model-option.selected { background: var(--ga-primary-soft); }
.ga-model-option-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ga-model-option.selected .ga-model-option-name { color: var(--arc-primary); }
.ga-model-check { flex: 0 0 auto; color: var(--arc-primary); }
.ga-model-menu-empty { padding: 14px 12px; font-size: 12px; color: var(--arc-text-hint); text-align: center; }

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
.stream-strip {
  position: absolute;
  top: 12px;
  right: 20px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--arc-warning);
  font-family: var(--ga-mono);
  background: var(--arc-bg-surface);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--arc-warning) 24%, transparent);
}
.stream-strip .dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--arc-warning);
  animation: ga-pulse 1.4s ease-in-out infinite;
}
@keyframes ga-pulse { 50% { opacity: 0.35; } }
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
.ga-cap-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 44px;
  min-width: 44px;
  padding: 0 10px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  background: var(--ga-primary-soft);
  color: var(--arc-primary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  box-sizing: border-box;
  font-size: 12px;
  font-weight: 650;
}
.ga-cap-indicator span {
  font-family: var(--ga-mono);
}
.ga-cap-indicator:hover {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-surface));
}
.ga-flow {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
.ga-starter-sub {
  margin: 4px auto 0;
  max-width: 640px;
  color: var(--arc-text-secondary);
  font-size: 13.5px;
  line-height: 1.7;
  text-align: center;
}
.ga-quick-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
  margin-top: 2px;
}
.ga-project-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.ga-project-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--arc-primary);
  border-radius: 999px;
  background: var(--arc-primary);
  color: var(--arc-primary-foreground, #fff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.ga-project-btn:hover { filter: brightness(1.06); }
.ga-project-btn.ghost {
  background: transparent;
  color: var(--arc-danger);
  border-color: color-mix(in srgb, var(--arc-danger) 45%, var(--arc-border));
}
.ga-project-btn.ghost:hover {
  background: color-mix(in srgb, var(--arc-danger) 8%, transparent);
}
.ga-quick-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.ga-quick-card {
  border: 1px solid var(--arc-border);
  border-radius: 14px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  text-align: left;
  padding: 11px 13px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.ga-quick-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  color: var(--arc-primary);
  background: var(--ga-primary-soft);
  transform: translateY(-1px);
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
  .ga-quick-row { grid-template-columns: 1fr; }
}
</style>
