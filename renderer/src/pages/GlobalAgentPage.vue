<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import {
  ArrowLeft,
  BookMarked,
  BookPlus,
  Bot,
  Brain,
  Globe2,
  LayoutGrid,
  Lightbulb,
  Network,
  Trash2,
  Users
} from 'lucide-vue-next'
import type { SurfaceDefinition, TurnTruncateResult } from '@shared/assistant-runtime'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import { toIpcPayload } from '@/utils/ipcPayload'
import { createProjectBatchSeedPayloads, type BatchSeedProject } from '@/features/wizard/projectSeed'
import { NOVEL_LENGTH_OPTIONS, PROJECT_GENRE_OPTIONS } from '@/features/wizard/projectGenres'
import AssistantSessionList from '@/components/assistantV2/AssistantSessionList.vue'
import AssistantMessages from '@/components/assistantV2/AssistantMessages.vue'
import AssistantComposer from '@/components/assistantV2/AssistantComposer.vue'
import StagedChangesView from '@/components/assistantV2/StagedChangesView.vue'
import AgentSelector from '@/components/assistantV2/AgentSelector.vue'
import AgentMemoryDialog from '@/components/assistantV2/AgentMemoryDialog.vue'
import ReferencePickerDialog from '@/components/assistantV2/ReferencePickerDialog.vue'
import PromptLibrary from '@/components/assistantV2/PromptLibrary.vue'
import BatchCreateProjectsModal from '@/components/home/BatchCreateProjectsModal.vue'

const appStore = useAppStore()
const { projects, selectedProjectId } = storeToRefs(appStore)
const message = useMessage()

// ============================================================================
// 全局智能体会话：作用于当前在左侧选中的项目（可跨项目切换）
// ============================================================================
const SURFACE: SurfaceDefinition = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 8
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
  try {
    window.localStorage.setItem(AGENT_SELECT_KEY, id)
  } catch {
    // ignore
  }
}

function restoreAgentSelection(): void {
  try {
    const saved = window.localStorage.getItem(AGENT_SELECT_KEY)
    if (saved) selectedAgentId.value = saved
  } catch {
    // ignore
  }
}

// 创作记忆对话框
const memoryDialogVisible = ref(false)

// 引用选择对话框
const referencePickerVisible = ref(false)
type PickedReference = { kind: 'chapter' | 'volume'; id: string; label: string }
function handleReferenceConfirm(refs: PickedReference[]): void {
  for (const ref of refs) {
    if (ref.kind === 'volume') {
      assistant.addPendingAttachment({
        kind: 'chapter',
        ref: `volume:${ref.id}`,
        label: `分卷《${ref.label}》`
      })
    } else {
      assistant.addPendingAttachment({
        kind: 'chapter',
        ref: `chapter:${ref.id}`,
        label: `章节《${ref.label}》`
      })
    }
  }
}

// ============================================================================
// 批量生成作品
// ============================================================================
const batchCreateModalVisible = ref(false)

// ============================================================================
// 批量生成设定（作用于当前选中项目）
// ============================================================================
type BatchAction = {
  key: string
  label: string
  prompt: string
  icon: typeof Globe2
  desc: string
}

const BATCH_ACTIONS: BatchAction[] = [
  {
    key: 'worldview',
    label: '批量生成世界观',
    icon: Globe2,
    desc: '为当前小说规划世界观设定体系',
    prompt: '请为当前小说《{{title}}》规划一套完整的开局世界观：先梳理需要覆盖的设定维度（地理、势力、规则、种族/体系等），再调用 propose_worldview 逐条批量写入。'
  },
  {
    key: 'characters',
    label: '批量生成角色卡片',
    icon: Users,
    desc: '为主角团与重要配角生成人物卡片',
    prompt: '请为当前小说《{{title}}》生成一批核心角色卡片（主角、关键配角、反派），为每个角色调用 propose_character 批量写入姓名、定位与设定描述。'
  },
  {
    key: 'relations',
    label: '批量生成人物关系',
    icon: Network,
    desc: '梳理角色之间的关联',
    prompt: '请为当前小说《{{title}}》梳理主要人物之间的相互关系（恩怨、合作、血缘、对立等）。先调用 read_project_data 读取现有角色与关系，再结合 propose_character 确保关系两端角色存在，最后以清晰的结构化清单列出每条关系（两端角色、关系类型、说明），等待我确认后由我记录到“人物关系”。'
  },
  {
    key: 'outline',
    label: '批量生成剧情大纲',
    icon: BookMarked,
    desc: '规划卷级与节点级剧情大纲',
    prompt: '请为当前小说《{{title}}》批量生成剧情大纲：先规划分卷结构，再为每个分卷生成节点级大纲条目，调用 propose_outline 写入（新分卷可结合 read_project_data 查看现有分卷索引）。'
  },
  {
    key: 'volumes',
    label: '批量生成章节分卷',
    icon: LayoutGrid,
    desc: '搭建卷 / 章层级结构',
    prompt: '请为当前小说《{{title}}》批量生成章节分卷：先调用 read_project_data 查看现有分卷，再为新增分卷规划卷级标题、目标字数与章节布局，并以结构化清单列出建议写入的分卷结构，等待我确认。'
  },
  {
    key: 'inspiration',
    label: '批量生成灵感',
    icon: Lightbulb,
    desc: '沉淀可复用的创意素材',
    prompt: '请为当前小说《{{title}}》批量生成一批灵感素材（情节火花、名场面、反转点、细节），以结构化清单逐条列出（分类、标题、内容），等待我确认后由我记录到“灵感”模块。'
  }
]

function fillBatchPrompt(action: BatchAction): void {
  const title = currentProject.value?.title || '当前小说'
  composerValue.value = action.prompt.replace('{{title}}', title)
}

// ============================================================================
// 当前项目 & 项目资源树
// ============================================================================
const currentProject = computed(() =>
  projects.value.find((item) => item.id === selectedProjectId.value) ?? projects.value[0] ?? null
)

function selectProject(id: string): void {
  appStore.selectProject(id)
}

function handleDeleteProject(): void {
  if (!selectedProjectId.value) {
    message.warning('请先选择一个小说项目')
    return
  }
  const target = projects.value.find((item) => item.id === selectedProjectId.value)
  if (!target) return
  if (window.confirm(`确定删除小说《${target.title}》吗？删除后可通过全局回收站找回。`)) {
    appStore.deleteProject(selectedProjectId.value)
    message.success(`已删除《${target.title}》`)
    // 删除后若无项目，提示可先批量生成作品
    if (projects.value.length === 0) {
      message.info('暂无小说项目，可在左侧“批量生成作品”创建。')
    }
  }
}

// 快速入口
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

// 打开知识文档
function openKnowledgeDocument(documentId?: string): void {
  appStore.setPanel('project-knowledge')
  if (documentId) {
    appStore.setAssistantFocusTarget('project-knowledge', documentId)
  }
}

/** 打开文件选择对话框，上传本地 txt/md 文件到对话 */
async function handleUploadFile(): Promise<void> {
  try {
    const result = await window.characterArc.pickAssistantTextFile()
    if (!result?.success) {
      if (result?.error) message.warning(result.error)
      return
    }
    const name = result.name ?? '本地文件'
    const content = result.content ?? ''
    if (content.length > 60000) {
      message.warning('文件内容过长，已截断前 6 万字，如需完整内容请精简后重试')
    }
    composerValue.value = `【已上传本地文件：${name}】\n${content.slice(0, 60000)}\n${composerValue.value}`
  } catch (e) {
    message.error(e instanceof Error ? e.message : '上传文件失败')
  }
}

/** 拖拽本地文本文件到对话（前端直接读取 File 对象内容） */
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
// 暂存区 / 会话栏折叠控制
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
const SESSION_DEFAULT_WIDTH = 230
const SESSION_MIN_WIDTH = 176
const SESSION_MAX_WIDTH = 360
const SESSION_HIDE_THRESHOLD = 150
const STAGE_DEFAULT_WIDTH = 400
const STAGE_MIN_WIDTH = 300
const STAGE_MAX_WIDTH = 700
const STAGE_HIDE_THRESHOLD = 260

const sessionWidth = ref(SESSION_DEFAULT_WIDTH)
const stageWidth = ref(STAGE_DEFAULT_WIDTH)
const isSessionResizing = ref(false)
const isStageResizing = ref(false)

const pageStyle = computed<Record<string, string>>(() => ({
  '--session-col-width': sessionCollapsed.value ? '44px' : `${sessionWidth.value}px`,
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
  } catch {
    return fallback
  }
}

function saveStoredWidth(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(Math.round(value)))
  } catch {
    // ignore
  }
}

function resizeSessionTo(rawWidth: number): void {
  if (rawWidth <= SESSION_HIDE_THRESHOLD) {
    sessionCollapsed.value = true
    return
  }
  sessionCollapsed.value = false
  sessionWidth.value = clampWidth(rawWidth, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
}

function resizeStageTo(rawWidth: number): void {
  if (rawWidth <= STAGE_HIDE_THRESHOLD) {
    stageCollapsed.value = true
    return
  }
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
    if (side === 'session') {
      resizeSessionTo(startWidth + delta)
    } else {
      resizeStageTo(startWidth - delta)
    }
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

function startSessionResize(event: MouseEvent): void {
  startColumnResize('session', event)
}

function startStageResize(event: MouseEvent): void {
  startColumnResize('stage', event)
}

onMounted(() => {
  restoreAgentSelection()
  sessionWidth.value = readStoredWidth(SESSION_WIDTH_KEY, SESSION_DEFAULT_WIDTH, SESSION_MIN_WIDTH, SESSION_MAX_WIDTH)
  stageWidth.value = readStoredWidth(STAGE_WIDTH_KEY, STAGE_DEFAULT_WIDTH, STAGE_MIN_WIDTH, STAGE_MAX_WIDTH)
})

onBeforeUnmount(() => {
  activeResizeCleanup?.()
})

// 写回暂存变更
const isCommitting = ref(false)
async function handleCommit(ids?: string[]): Promise<void> {
  if (isCommitting.value) return
  isCommitting.value = true
  try {
    const { committed, failed } = await assistant.commitAccepted(ids)
    if (failed > 0 && committed > 0) {
      message.warning(`已写回 ${committed} 项，${failed} 项失败`)
    } else if (failed > 0) {
      message.error(`写回失败：${failed} 项未能提交`)
    } else if (committed > 0) {
      message.success(`已成功写回 ${committed} 项变更`)
    }
  } finally {
    isCommitting.value = false
  }
}

function notifyTruncate(result: TurnTruncateResult, action: '撤回' | '重新分叉'): void {
  if (result.keptCommitted > 0) {
    message.warning(`${action}完成，但 ${result.keptCommitted} 项已写回项目的改动未回滚`)
  } else if (result.discardedStaged > 0) {
    message.success(`${action}完成，已丢弃 ${result.discardedStaged} 项暂存变更`)
  } else {
    message.success(`${action}完成`)
  }
}

async function handleUndoTurn(turnId: string): Promise<void> {
  const result = await assistant.undoTurn(turnId)
  if (result) notifyTruncate(result, '撤回')
}

async function handleResendTurn(): Promise<void> {
  const result = await assistant.resendEditedTurn({
    intentHint: 'global-assistant-v2:chat'
  })
  if (result) notifyTruncate(result, '重新分叉')
}
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
    <!-- ======== 左侧：项目资源树 + 项目操作（deepwrite 风格） ======== -->
    <div class="ga-left">
      <div class="ga-left-head">
        <button type="button" class="ga-back" title="返回主页" @click="appStore.backToProjects()">
          <ArrowLeft :size="16" />
        </button>
        <div class="ga-logo">
          <Bot :size="17" class="ga-logo-icon" />
          <span>全局智能体</span>
        </div>
      </div>

      <div class="ga-project-ops">
        <button
          type="button"
          class="ga-op-btn primary"
          @click="batchCreateModalVisible = true"
          title="批量生成作品"
        >
          <BookPlus :size="14" />
          <span>批量生成作品</span>
        </button>
        <button
          type="button"
          class="ga-op-btn danger"
          @click="handleDeleteProject"
          title="删除当前小说"
        >
          <Trash2 :size="14" />
          <span>删除当前小说</span>
        </button>
      </div>

      <div class="ga-tree-title">
        <span>小说项目</span>
        <em v-if="projects.length">{{ projects.length }}</em>
      </div>
      <div class="ga-tree arc-scrollbar">
        <button
          v-for="project in projects"
          :key="project.id"
          type="button"
          class="ga-tree-item"
          :class="{ active: project.id === selectedProjectId }"
          @click="selectProject(project.id)"
        >
          <span class="ga-tree-icon"><BookMarked :size="14" /></span>
          <span class="ga-tree-name">{{ project.title || '未命名小说' }}</span>
        </button>
        <div v-if="projects.length === 0" class="ga-tree-empty">
          <p>暂无小说项目</p>
          <p class="sub">点击上方“批量生成作品”创建</p>
        </div>
      </div>

      <div class="ga-left-foot">
        <div v-if="currentProject" class="ga-ctx-card">
          <div class="ga-ctx-label">当前上下文</div>
          <div class="ga-ctx-title">{{ currentProject.title || '未命名小说' }}</div>
          <div class="ga-ctx-meta">{{ currentProject.genre || '未分类' }} · {{ currentProject.novelLength === 'short' ? '短篇' : '长篇' }}</div>
        </div>
        <div v-else class="ga-ctx-card">
          <div class="ga-ctx-label">当前上下文</div>
          <div class="ga-ctx-title muted">未选择小说</div>
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
      aria-label="调整左侧项目栏宽度"
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

      <AssistantMessages
        v-if="assistant.messages.value.length > 0 || assistant.isStreaming.value"
        :messages="assistant.messages.value"
        :is-streaming="assistant.isStreaming.value"
        assistant-name="智能体"
        :editing-turn-id="assistant.editingTurnId.value"
        :editing-draft="assistant.editingDraft.value"
        :is-mutating="assistant.isTruncating.value"
        :staged-changes="assistant.stagedChanges.value"
        @open-knowledge="openKnowledgeDocument"
        @continue="assistant.continueWithPrompt"
        @open-staged="reopenStagePanel"
        @rollback="assistant.rollbackTurn"
        @edit-start="assistant.startEditingTurn"
        @edit-cancel="assistant.cancelEditing"
        @edit-draft="assistant.updateEditingDraft"
        @resend="handleResendTurn"
        @undo="handleUndoTurn"
        @delete-turns="(ids) => assistant.deleteTurns(ids)"
      />

      <div v-else class="ga-starter">
        <div class="ga-starter-inner">
          <div class="ga-starter-head">
            <div class="ga-starter-kicker">全局智能体</div>
            <h2>需要我为你的创作做点什么？</h2>
            <p class="ga-starter-sub">
              在左侧选择要操作的小说，即可批量生成世界观、角色卡片、人物关系、剧情大纲、章节分卷与灵感，
              所有改动都先进入右侧暂存区审阅，确认后才写回。
            </p>
          </div>

          <div class="ga-batch-grid">
            <button
              v-for="action in BATCH_ACTIONS"
              :key="action.key"
              type="button"
              class="ga-batch-card"
              @click="fillBatchPrompt(action)"
            >
              <component :is="action.icon" :size="16" class="ga-batch-icon" />
              <div class="ga-batch-text">
                <strong>{{ action.label }}</strong>
                <span>{{ action.desc }}</span>
              </div>
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
        @add-file="(file) => assistant.addPendingAttachment({ kind: 'file', ref: `file:${file.name}`, label: file.name, content: file.content, mime: file.mime, size: file.size })"
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

    <BatchCreateProjectsModal v-model:show="batchCreateModalVisible" />
  </div>
</template>

<style scoped>
.ga-page {
  --ga-warn: #b45309;
  --ga-danger: #b91c1c;
  --ga-add: #047857;
  --ga-mono: 'JetBrains Mono', 'Consolas', 'SF Mono', ui-monospace, Menlo, monospace;
  --session-col-width: 230px;
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
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
  letter-spacing: -0.005em;
}

/* ===== 左侧项目栏 ===== */
.ga-left {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.ga-left-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 10px;
}
.ga-back {
  border: 1px solid var(--arc-border);
  background: transparent;
  color: var(--arc-text-secondary);
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.ga-back:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
}
.ga-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: var(--arc-text-primary);
}
.ga-logo-icon {
  color: var(--arc-primary);
}
.ga-project-ops {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 14px 12px;
}
.ga-op-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ga-op-btn.primary {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, transparent);
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
}
.ga-op-btn.primary:hover {
  background: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-bg-surface));
}
.ga-op-btn.danger {
  color: var(--ga-danger);
}
.ga-op-btn.danger:hover {
  background: rgba(185, 28, 28, 0.08);
  border-color: rgba(185, 28, 28, 0.3);
}
.ga-tree-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
}
.ga-tree-title em {
  font-style: normal;
  font-family: var(--ga-mono);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
}
.ga-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ga-tree-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  width: 100%;
}
.ga-tree-item:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.ga-tree-item.active {
  background: color-mix(in srgb, var(--arc-primary) 14%, transparent);
  border-color: color-mix(in srgb, var(--arc-primary) 32%, transparent);
  color: var(--arc-primary);
}
.ga-tree-icon {
  display: inline-flex;
  flex-shrink: 0;
}
.ga-tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.ga-tree-empty {
  padding: 20px 10px;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 12.5px;
}
.ga-tree-empty .sub {
  margin-top: 4px;
  font-size: 11.5px;
}
.ga-left-foot {
  padding: 10px 14px;
  border-top: 1px solid var(--arc-border);
}
.ga-ctx-card {
  padding: 10px 12px;
  border-radius: 10px;
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
.ga-ctx-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ===== 折叠窄条 ===== */
.ga-session-mini {
  width: 44px;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
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
  color: #b45309;
  font-family: var(--ga-mono);
  background: var(--arc-bg-surface);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(180, 83, 9, 0.2);
}
.stream-strip .dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #b45309;
  animation: ga-pulse 1.4s ease-in-out infinite;
}
@keyframes ga-pulse {
  50% {
    opacity: 0.35;
  }
}
.ga-agent-toolbar {
  padding: 10px 32px 0;
  display: flex;
  align-items: center;
  gap: 8px;
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
  height: 46px;
  min-width: 44px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-primary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
  box-sizing: border-box;
}
.ga-memory-toggle:hover {
  background: rgba(127, 127, 127, 0.1);
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
  width: min(760px, 100%);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ga-starter-head {
  text-align: center;
}
.ga-starter-kicker {
  font-family: var(--ga-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--arc-primary);
  margin-bottom: 8px;
}
.ga-starter-head h2 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 28px;
  line-height: 1.15;
  font-weight: 700;
}
.ga-starter-sub {
  margin: 8px auto 0;
  max-width: 620px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.ga-batch-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.ga-batch-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 74px;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  text-align: left;
  padding: 12px 13px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.ga-batch-card:hover {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  transform: translateY(-1px);
}
.ga-batch-icon {
  color: var(--arc-primary);
  flex-shrink: 0;
  margin-top: 2px;
}
.ga-batch-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ga-batch-text strong {
  font-size: 13px;
  font-weight: 700;
}
.ga-batch-text span {
  font-size: 11.5px;
  color: var(--arc-text-secondary);
  line-height: 1.4;
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
  border-radius: 9px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  text-align: left;
  padding: 9px 11px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.35;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.ga-quick-card:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
}
.ga-err-banner {
  margin: 0 32px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(185, 28, 28, 0.06);
  border: 1px solid rgba(185, 28, 28, 0.2);
  color: #b91c1c;
  font-size: 12.5px;
}

/* ===== 右侧暂存区 ===== */
.ga-stage-col-head,
.ga-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--arc-border);
  flex-shrink: 0;
}
.ga-stage-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
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
  .ga-left,
  .ga-session-mini,
  .ga-session-resizer {
    display: none;
  }
  .ga-batch-grid,
  .ga-quick-row {
    grid-template-columns: 1fr;
  }
}
</style>
