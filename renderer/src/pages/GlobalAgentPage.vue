<script setup lang="ts">
/**
 * GlobalAgentPage · 全局智能体（DeepSeek Harness 移植版）
 *
 * 完整移植 DeepSeek Harness 的 Web UI 布局（three-column shell：
 * 侧栏 | 对话 | 详情），并深度适配本开源小说编辑器：
 *   - 侧栏：品牌词标「全局智能体」、新建会话、会话浏览、底部项目上下文与设置入口
 *   - 中间：对话流（Hero 空状态 + 输入 + 节点自动折叠）
 *   - 右侧详情：暂存变更审阅
 *   - 设置抽屉：能力模块（everything is a plugin）/ 系统文件 / MCP 市场 /
 *     dsh-plugin 插件市场（可从 github.com/topics/dsh-plugin 导入插件）
 *
 * 设计原则：Everything is a plugin —— 所有能力都以可独立启停的模块承载。
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
  Plug,
  Puzzle,
  Settings,
  Package,
  Plus
} from 'lucide-vue-next'
import type { SurfaceDefinition, TurnTruncateResult } from '@shared/assistant-runtime'
import AiProviderIcon from '@/components/assistantV2/AiProviderIcon.vue'
import DeepSeekFishLogo from '@/components/assistantV2/DeepSeekFishLogo.vue'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import AssistantSessionList from '@/components/assistantV2/AssistantSessionList.vue'
import AssistantComposer from '@/components/assistantV2/AssistantComposer.vue'
import StagedChangesView from '@/components/assistantV2/StagedChangesView.vue'
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
// 全局智能体会话：作用于当前在左侧选中的项目
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

// 当前选中的智能体
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
// 设置抽屉（模块 / 文件 / MCP / 插件市场）—— DeepSeek Harness 的 settings 入口
// ============================================================================
type SettingsTab = 'modules' | 'files' | 'mcp' | 'plugins'
const settingsOpen = ref(false)
const settingsTab = ref<SettingsTab>('modules')

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string; icon: unknown }> = [
  { key: 'modules', label: '能力模块', icon: Puzzle },
  { key: 'files', label: '系统文件', icon: FolderTree },
  { key: 'mcp', label: 'MCP 市场', icon: Plug },
  { key: 'plugins', label: '插件市场', icon: Package }
]

// 创作记忆对话框
const memoryDialogVisible = ref(false)

// 引用选择对话框
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
// 当前项目 & 项目操作
// ============================================================================
const currentProject = computed(() =>
  projects.value.find((item) => item.id === selectedProjectId.value) ?? projects.value[0] ?? null
)

// ============================================================================
// 侧栏项目选择器：直接引用 / 切换主页小说项目（DeepSeek Harness 上下文选择）
// ============================================================================
const projectPickerOpen = ref(false)
const projectPickerEl = ref<HTMLElement | null>(null)
function toggleProjectPicker(): void {
  projectPickerOpen.value = !projectPickerOpen.value
}
function onProjectPickerDocClick(event: MouseEvent): void {
  if (!projectPickerOpen.value) return
  if (projectPickerEl.value && !projectPickerEl.value.contains(event.target as Node)) {
    projectPickerOpen.value = false
  }
}
function selectProject(projectId: string): void {
  if (projectId !== selectedProjectId.value) {
    appStore.openProject(projectId)
    // 打开项目后重新定位到全局智能体视图，避免跳转到工作台
    appStore.currentView = 'global-agent'
    message.success(`已切换上下文至《${currentProject.value?.title || '该小说'}》`)
  }
  projectPickerOpen.value = false
}

// 当前使用的 AI 接口 / 模型（标题栏模型切换器共享同一数据源）
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

// ============================================================================
// 模型选择菜单（DeepSeek Harness ModelSelect：Model / Effort 两级下拉）
// ============================================================================
type ModelPane = 'root' | 'model' | 'profile'
const modelMenuOpen = ref(false)
const modelPane = ref<ModelPane>('root')
const modelMenuEl = ref<HTMLElement | null>(null)

// 模型列表（与标题栏模型切换器共享同一数据源：当前接口配置下已保存的模型）
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
function onModelMenuDocClick(event: MouseEvent): void {
  if (!modelMenuOpen.value) return
  if (modelMenuEl.value && !modelMenuEl.value.contains(event.target as Node)) {
    modelMenuOpen.value = false
  }
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

// 上传本地 txt/md 文件到对话
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
// 暂存区 / 侧栏折叠控制（DeepSeek Harness 三栏可拖拽）
// ============================================================================
const stageCollapsed = ref(false)
const stageBadgeCount = computed(() =>
  assistant.stagedChanges.value.filter(
    (c) => c.status === 'pending' || c.status === 'accepted' || c.status === 'streaming'
  ).length
)

const sessionCollapsed = ref(false)
const SESSION_WIDTH_KEY = 'global-agent-session-width'
const STAGE_WIDTH_KEY = 'global-agent-stage-width'
const SESSION_DEFAULT_WIDTH = 260
const SESSION_MIN_WIDTH = 210
const SESSION_MAX_WIDTH = 380
const SESSION_HIDE_THRESHOLD = 190
const STAGE_DEFAULT_WIDTH = 400
const STAGE_MIN_WIDTH = 300
const STAGE_MAX_WIDTH = 700
const STAGE_HIDE_THRESHOLD = 260

const sessionWidth = ref(SESSION_DEFAULT_WIDTH)
const stageWidth = ref(STAGE_DEFAULT_WIDTH)
const isSessionResizing = ref(false)
const isStageResizing = ref(false)

const pageStyle = computed<Record<string, string>>(() => ({
  '--session-col-width': sessionCollapsed.value ? '48px' : `${sessionWidth.value}px`,
  '--stage-col-width': stageCollapsed.value ? '44px' : `${stageWidth.value}px`
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
function resizeSessionTo(rawWidth: number): void {
  if (rawWidth <= SESSION_HIDE_THRESHOLD) { sessionCollapsed.value = true; return }
  sessionCollapsed.value = false
  sessionWidth.value = clampWidth(rawWidth, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
}
function resizeStageTo(rawWidth: number): void {
  if (rawWidth <= STAGE_HIDE_THRESHOLD) { stageCollapsed.value = true; return }
  stageCollapsed.value = false
  stageWidth.value = clampWidth(rawWidth, STAGE_MIN_WIDTH, STAGE_MAX_WIDTH)
}
function resizeSessionBy(delta: number): void {
  resizeSessionTo(sessionWidth.value + delta)
  saveStoredWidth(SESSION_WIDTH_KEY, sessionWidth.value)
}
function resizeStageBy(delta: number): void {
  resizeStageTo(stageWidth.value + delta)
  saveStoredWidth(STAGE_WIDTH_KEY, stageWidth.value)
}
function reopenSessionPanel(): void {
  sessionCollapsed.value = false
  sessionWidth.value = clampWidth(sessionWidth.value, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
}
function reopenStagePanel(): void {
  stageCollapsed.value = false
  stageWidth.value = clampWidth(stageWidth.value, STAGE_MIN_WIDTH, STAGE_MAX_WIDTH)
}
function startColumnResize(side: 'session' | 'stage', event: MouseEvent): void {
  event.preventDefault()
  activeResizeCleanup?.()
  const startX = event.clientX
  const startWidth = side === 'session' ? sessionWidth.value : stageWidth.value
  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect
  isSessionResizing.value = side === 'session'
  isStageResizing.value = side === 'stage'
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  const handleMove = (moveEvent: MouseEvent): void => {
    const delta = moveEvent.clientX - startX
    if (side === 'session') resizeSessionTo(startWidth + delta)
    else resizeStageTo(startWidth - delta)
  }
  const finishResize = (): void => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', finishResize)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
    saveStoredWidth(SESSION_WIDTH_KEY, sessionWidth.value)
    saveStoredWidth(STAGE_WIDTH_KEY, stageWidth.value)
    isSessionResizing.value = false
    isStageResizing.value = false
    activeResizeCleanup = null
  }
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', finishResize)
  activeResizeCleanup = finishResize
}
function startSessionResize(event: MouseEvent): void { startColumnResize('session', event) }
function startStageResize(event: MouseEvent): void { startColumnResize('stage', event) }

onMounted(() => {
  restoreAgentSelection()
  sessionWidth.value = readStoredWidth(SESSION_WIDTH_KEY, SESSION_DEFAULT_WIDTH, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
  stageWidth.value = readStoredWidth(STAGE_WIDTH_KEY, STAGE_DEFAULT_WIDTH, STAGE_MIN_WIDTH, STAGE_MAX_WIDTH)
  document.addEventListener('click', onProjectPickerDocClick)
  document.addEventListener('click', onModelMenuDocClick)
})
onBeforeUnmount(() => {
  activeResizeCleanup?.()
  document.removeEventListener('click', onProjectPickerDocClick)
  document.removeEventListener('click', onModelMenuDocClick)
})

// 写回暂存变更
const isCommitting = ref(false)
async function handleCommit(ids?: string[]): Promise<void> {
  if (isCommitting.value) return
  isCommitting.value = true
  try {
    const { committed, failed } = await assistant.commitAccepted(ids)
    if (failed > 0 && committed > 0) message.warning(`已写回 ${committed} 项，${failed} 项失败`)
    else if (failed > 0) message.error(`写回失败：${failed} 项未能提交`)
    else if (committed > 0) message.success(`已成功写回 ${committed} 项变更`)
  } finally { isCommitting.value = false }
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
async function copyMessage(text: string): Promise<void> {
  try { await navigator.clipboard?.writeText(text); message.success('已复制') } catch { /* ignore */ }
}

// ============================================================================
// 会话栏（DeepSeek Harness 侧栏）
// ============================================================================
</script>

<template>
  <div
    class="ga-page"
    :class="{
      'stage-collapsed': stageCollapsed,
      'session-collapsed': sessionCollapsed,
      'session-resizing': isSessionResizing,
      'stage-resizing': isStageResizing
    }"
    :style="pageStyle"
  >
    <!-- ======== 左侧：DeepSeek Harness 风格侧栏 ======== -->
    <div class="ga-sidebar">
      <div class="ga-brand-row">
        <button type="button" class="ga-back" title="返回主页" @click="appStore.backToProjects()">
          <ArrowLeft :size="16" />
        </button>
        <button type="button" class="ga-brand" title="新建会话" @click="assistant.createSession()">
          <DeepSeekFishLogo :size="20" class="ga-brand-icon" />
          <span class="ga-brand-name">全局智能体</span>
          <span class="ga-brand-badge">HARNESS</span>
        </button>
      </div>

      <!-- 新建会话（DeepSeek Harness New Session） -->
      <button
        type="button"
        class="ga-new-session"
        title="新建会话"
        @click="assistant.createSession()"
      >
        <Plus :size="14" />
        <span>新建会话</span>
      </button>

      <!-- 会话历史（侧栏浏览区） -->
      <div class="ga-session-region">
        <AssistantSessionList
          :sessions="assistant.sessions.value"
          :active-session-id="assistant.activeSessionId.value"
          @switch="(id) => assistant.switchSession(id)"
          @create="() => assistant.createSession()"
          @delete="(id) => assistant.deleteSession(id)"
          @delete-batch="(ids) => assistant.deleteSessions(ids)"
          @rename="(id, title) => assistant.renameSession(id, title)"
          @collapse="reopenSessionPanel"
        />
      </div>

      <!-- 侧栏底部：项目上下文 + 设置入口（模块/文件/MCP/插件） -->
      <div class="ga-sidebar-foot">
        <button type="button" class="ga-settings-toggle" @click="settingsOpen = !settingsOpen">
          <Settings :size="15" />
          <span>能力与市场</span>
        </button>

        <div v-if="settingsOpen" class="ga-settings-drawer">
          <div class="ga-settings-tabs">
            <button
              v-for="tab in SETTINGS_TABS"
              :key="tab.key"
              type="button"
              class="ga-stab"
              :class="{ active: settingsTab === tab.key }"
              :title="tab.label"
              @click="settingsTab = tab.key"
            >
              <component :is="tab.icon" :size="14" />
              <span>{{ tab.label }}</span>
            </button>
          </div>
          <div class="ga-settings-pane">
            <AgentModuleManager v-if="settingsTab === 'modules'" />
            <AgentFileExplorer v-else-if="settingsTab === 'files'" />
            <AgentMcpMarket v-else-if="settingsTab === 'mcp'" />
            <AgentPluginMarket v-else-if="settingsTab === 'plugins'" />
          </div>
        </div>

        <!-- 项目上下文选择器：直接引用 / 切换主页小说项目 -->
        <div ref="projectPickerEl" class="ga-ctx-card">
          <div class="ga-ctx-label">当前上下文 · 小说项目</div>
          <button type="button" class="ga-ctx-select" @click="toggleProjectPicker">
            <span v-if="currentProject" class="ga-ctx-title">{{ currentProject.title || '未命名小说' }}</span>
            <span v-else class="ga-ctx-title muted">未选择小说</span>
            <ChevronDown :size="13" class="ga-ctx-caret" :class="{ open: projectPickerOpen }" />
          </button>
          <div v-if="currentProject" class="ga-ctx-meta">{{ currentProject.genre || '未分类' }} · {{ currentProject.novelLength === 'short' ? '短篇' : '长篇' }}</div>

          <div v-if="projectPickerOpen" class="ga-ctx-dropdown">
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

        <!-- AI 接口 / 模型选择（DeepSeek Harness ModelSelect 风格，与标题栏共享数据源） -->
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
      </div>
    </div>

    <!-- ======== 左侧折叠窄条 ======== -->
    <div v-if="sessionCollapsed" class="ga-session-mini" />
    <div
      v-else
      class="col-resizer ga-session-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左侧栏宽度"
      tabindex="0"
      @mousedown="startSessionResize"
      @keydown.left.prevent="resizeSessionBy(-24)"
      @keydown.right.prevent="resizeSessionBy(24)"
    />

    <!-- ======== 中间：智能体对话 ======== -->
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

      <!-- 对话流节点（自动折叠） -->
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

      <div v-else class="ga-starter">
        <div class="ga-starter-inner">
          <div class="ga-starter-head">
            <div class="ga-starter-hero">
              <DeepSeekFishLogo :size="34" class="ga-starter-fish" />
              <h2 class="ga-starter-headline">全局智能体</h2>
              <span class="ga-starter-preview">Preview</span>
            </div>
            <p class="ga-starter-sub">
              需要我为你的创作做点什么？我可以读写任意文件、写代码、调用 MCP 工具、
              操作浏览器与桌面应用。所有能力都遵循 everything-is-a-plugin 原则，可在
              左侧「能力与市场」中按插件独立启停，也可从 GitHub dsh-plugin 话题导入新插件。
            </p>
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
      />
    </div>

    <!-- ======== 右侧折叠窄条 ======== -->
    <button
      v-if="stageCollapsed"
      class="ga-stage-mini"
      :title="`展开暂存变更 (${stageBadgeCount})`"
      @click="reopenStagePanel"
    >
      <span class="ga-stage-mini-label">暂存</span>
      <span v-if="stageBadgeCount > 0" class="ga-stage-mini-badge">{{ stageBadgeCount }}</span>
    </button>

    <div v-else class="ga-stage-col" :class="{ resizing: isStageResizing }">
      <div
        class="col-resizer ga-stage-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整暂存区宽度"
        tabindex="0"
        @mousedown="startStageResize"
        @keydown.left.prevent="resizeStageBy(24)"
        @keydown.right.prevent="resizeStageBy(-24)"
      />
      <div class="ga-stage-head">
        <span class="ga-stage-title">暂存变更审阅</span>
        <button type="button" class="ga-collapse-btn" title="最小化" @click="stageCollapsed = true">
          <span>›</span>
        </button>
      </div>
      <StagedChangesView
        class="ga-stage-view"
        :changes="assistant.stagedChanges.value"
        :is-busy="assistant.isStreaming.value"
        :is-committing="isCommitting"
        @accept="(ids) => assistant.acceptChanges(ids)"
        @reject="(ids) => assistant.rejectChanges(ids)"
        @bind-target="(changeId, entityId) => assistant.bindTarget(changeId, entityId)"
        @commit="(ids) => handleCommit(ids)"
        @remove="(ids) => assistant.removeChanges(ids)"
        @clear-finished="() => assistant.clearFinishedStaged()"
      />
    </div>
  </div>
</template>

<style scoped>
.ga-page {
  --ga-warn: var(--arc-warning);
  --ga-danger: var(--arc-danger);
  --ga-add: var(--arc-success);
  --ga-mono: 'JetBrains Mono', 'Consolas', 'SF Mono', ui-monospace, Menlo, monospace;
  /* DeepSeek Harness DeepSeek 蓝品牌色（dsh design-platform 提取） */
  --ga-brand: #4176e6;
  --ga-brand-soft: #edf3fe;
  --ga-brand-strong: #284da3;
  /* Doubao 设计 token（UI 设计 skill） */
  --ga-radius: 19.2px;
  --ga-radius-sm: 12px;
  --ga-muted: #eff1f4;
  --ga-border: #e7eaef;
  --session-col-width: 260px;
  --stage-col-width: 400px;
  display: grid;
  grid-template-columns: var(--session-col-width) minmax(0, 1fr) var(--stage-col-width);
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font-family: 'Stack Sans Text', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
  letter-spacing: -0.005em;
}

/* ===== 左侧侧栏（DeepSeek Harness 风格） ===== */
.ga-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.ga-brand-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 12px;
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
.ga-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 2px 4px;
  margin: 0;
  cursor: pointer;
  font-family: inherit;
  color: var(--arc-text-primary);
  border-radius: 10px;
  transition: background 0.15s ease;
}
.ga-brand:hover {
  background: var(--ga-brand-soft);
}
.ga-brand-icon {
  color: var(--ga-brand);
  flex-shrink: 0;
}
.ga-brand-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--arc-text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.ga-brand-badge {
  font-family: var(--ga-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--ga-brand);
  color: #fff;
  line-height: 1.2;
}
.ga-new-session {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 2px 14px 10px;
  padding: 10px 12px;
  border: 1px solid var(--ga-brand);
  border-radius: 999px;
  background: var(--ga-brand);
  color: #fff;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ga-new-session:hover {
  background: var(--ga-brand-strong);
  border-color: var(--ga-brand-strong);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ga-brand) 24%, transparent);
}
.ga-session-region {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.ga-sidebar-foot {
  border-top: 1px solid var(--arc-border);
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ga-settings-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ga-settings-toggle:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.ga-settings-drawer {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--arc-bg-surface);
  max-height: 340px;
  display: flex;
  flex-direction: column;
}
.ga-settings-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  padding: 6px;
  border-bottom: 1px solid var(--arc-border);
}
.ga-stab {
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
}
.ga-stab:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.ga-stab.active {
  border-color: color-mix(in srgb, var(--arc-primary) 35%, transparent);
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
  color: var(--arc-primary);
}
.ga-settings-pane {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 240px;
}
.ga-ctx-card {
  position: relative;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
}
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
.ga-ctx-select:hover .ga-ctx-title {
  color: var(--arc-primary);
}
.ga-ctx-caret {
  flex: 0 0 auto;
  color: var(--arc-text-hint);
  transition: transform 0.18s ease;
}
.ga-ctx-caret.open {
  transform: rotate(180deg);
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
  transition: color 0.15s ease;
}
.ga-ctx-title.muted {
  color: var(--arc-text-hint);
  font-weight: 500;
}
.ga-ctx-meta {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--arc-text-secondary);
}
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
.ga-ctx-dropdown-list {
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 4px;
}
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
.ga-ctx-option:hover {
  background: var(--arc-bg-weak);
}
.ga-ctx-option.active {
  background: var(--arc-primary-soft);
}
.ga-ctx-option-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ga-ctx-option.active .ga-ctx-option-title {
  color: var(--arc-primary);
}
.ga-ctx-option-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--arc-text-hint);
}
.ga-ctx-dropdown-empty {
  padding: 14px 12px;
  font-size: 12px;
  color: var(--arc-text-hint);
  text-align: center;
}
.ga-model-menu-wrap {
  position: relative;
}
.ga-ai-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ga-brand) 6%, var(--arc-bg-surface));
  border: 1px solid color-mix(in srgb, var(--ga-brand) 16%, var(--arc-border));
  color: var(--arc-text-secondary);
  font-size: 11px;
  min-width: 0;
  width: 100%;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ga-ai-indicator:hover,
.ga-ai-indicator.open {
  border-color: color-mix(in srgb, var(--ga-brand) 40%, var(--arc-border));
  background: color-mix(in srgb, var(--ga-brand) 10%, var(--arc-bg-surface));
}
.ga-model-caret {
  flex: 0 0 auto;
  color: var(--arc-text-hint);
  transition: transform 0.18s ease;
}
.ga-model-caret.open {
  transform: rotate(180deg);
}
.ga-ai-indicator-name {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--ga-brand);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 38%;
}
.ga-ai-indicator-sep {
  flex: 0 0 auto;
  color: var(--arc-text-hint);
}
.ga-ai-indicator-model {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 模型选择菜单（DeepSeek Harness ModelSelect 风格） */
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
.ga-model-cell:hover {
  background: var(--arc-bg-weak);
}
.ga-model-cell-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--arc-text-primary);
}
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
.ga-model-cell-chevron {
  flex: 0 0 auto;
  color: var(--arc-text-hint);
}
.ga-model-menu-head {
  padding: 8px 12px;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
  border-bottom: 1px solid var(--arc-border);
}
.ga-model-menu-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
}
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
.ga-model-option:hover {
  background: var(--arc-bg-weak);
}
.ga-model-option.selected {
  background: var(--ga-brand-soft);
}
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
.ga-model-option.selected .ga-model-option-name {
  color: var(--ga-brand);
}
.ga-model-check {
  flex: 0 0 auto;
  color: var(--ga-brand);
}
.ga-model-menu-empty {
  padding: 14px 12px;
  font-size: 12px;
  color: var(--arc-text-hint);
  text-align: center;
}

/* ===== 折叠窄条 ===== */
.ga-session-mini {
  width: 48px;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-sidebar);
}
.ga-stage-mini {
  border: none;
  border-left: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 18px 0;
  gap: 8px;
  transition: background 0.15s ease;
}
.ga-stage-mini:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.ga-stage-mini-label {
  writing-mode: vertical-rl;
  font-size: 12px;
  letter-spacing: 0.08em;
  font-family: var(--ga-mono);
}
.ga-stage-mini-badge {
  font-size: 10px;
  font-family: var(--ga-mono);
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: #fff;
  font-weight: 600;
}

/* ===== 通用分栏拖拽 ===== */
.col-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 5;
  width: 10px;
  cursor: col-resize;
  outline: none;
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
.col-resizer:hover::after,
.col-resizer:focus-visible::after {
  background: var(--arc-primary);
}
.ga-session-resizer {
  left: var(--session-col-width);
  right: auto;
}
.ga-stage-col {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.ga-stage-resizer {
  left: 0;
}
.ga-stage-col.resizing .ga-stage-resizer::after {
  background: var(--arc-primary);
}

/* ===== 中间对话区 ===== */
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
@keyframes ga-pulse {
  50% { opacity: 0.35; }
}
.ga-agent-toolbar {
  padding: 14px 36px 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 10;
}
.ga-agent-toolbar :deep(.agent-selector) {
  flex: 1 1 auto;
  min-width: 0;
}
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
  background: var(--arc-primary-soft);
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
.ga-starter-inner {
  width: min(720px, 100%);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ga-starter-head {
  text-align: center;
}
.ga-starter-hero {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.ga-starter-fish {
  color: var(--ga-brand);
  flex-shrink: 0;
}
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
  color: var(--ga-brand);
  border: 1px solid color-mix(in srgb, var(--ga-brand) 35%, transparent);
  background: var(--ga-brand-soft);
  padding: 3px 8px;
  border-radius: 999px;
  align-self: flex-start;
  margin-top: 2px;
}
.ga-starter-sub {
  margin: 12px auto 0;
  max-width: 640px;
  color: var(--arc-text-secondary);
  font-size: 13.5px;
  line-height: 1.7;
}
.ga-quick-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
  margin-top: 2px;
}
.ga-quick-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
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
  background: var(--arc-primary-soft);
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

/* ===== 右侧暂存区 ===== */
.ga-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--arc-border);
  flex-shrink: 0;
  background: var(--arc-bg-surface);
}
.ga-stage-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--arc-text-primary);
}
.ga-collapse-btn {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  transition: all 0.15s ease;
}
.ga-collapse-btn:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.ga-stage-view {
  flex: 1;
  min-height: 0;
  border-left: none;
}

@media (max-width: 1100px) {
  .ga-page {
    grid-template-columns: var(--session-col-width) minmax(0, 1fr);
  }
  .ga-stage-col,
  .ga-stage-mini,
  .ga-stage-resizer {
    display: none;
  }
}
@media (max-width: 860px) {
  .ga-page {
    grid-template-columns: minmax(0, 1fr);
  }
  .ga-sidebar,
  .ga-session-mini,
  .ga-session-resizer {
    display: none;
  }
  .ga-quick-row {
    grid-template-columns: 1fr;
  }
}
</style>
