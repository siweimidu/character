<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import {
  BookMarked,
  Brain,
  FileCheck2,
  Globe2,
  Network,
  PanelLeftOpen,
  ShieldCheck,
  Users
} from 'lucide-vue-next'
import type { SurfaceDefinition, TurnTruncateResult } from '@shared/assistant-runtime'
import type { AgentModuleRuntime } from '@shared/agent-modules'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import { createSpeechRecorder, startBrowserSpeech, uint8ArrayToBase64 } from '@/features/settings/speechInput'
import AssistantSessionList from './AssistantSessionList.vue'
import AssistantMessages from './AssistantMessages.vue'
import AssistantComposer from './AssistantComposer.vue'
import StagedChangesView from './StagedChangesView.vue'
import AgentSelector from './AgentSelector.vue'
import AgentMemoryDialog from './AgentMemoryDialog.vue'
import ReferencePickerDialog from './ReferencePickerDialog.vue'

const appStore = useAppStore()
const { selectedProjectId } = storeToRefs(appStore)
const message = useMessage()

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
  set: (v) => { assistant.composerValue.value = v }
})

// 已启用能力模块（供输入框展示能力提示）
const enabledModules = ref<AgentModuleRuntime[]>([])
async function refreshEnabledModules(): Promise<void> {
  try {
    const all = await window.characterArc.agentModules.list()
    enabledModules.value = all.filter((m) => m.enabled)
  } catch {
    enabledModules.value = []
  }
}

// 语音输入
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
      const res = await window.characterArc.transcribeSpeech({ settings, audioData: uint8ArrayToBase64(audioData), audioType: mimeType })
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
  message.success('开始录音，请说话…')
}

// 当前选中的智能体
const selectedAgentId = ref<string>('')

// 创作记忆对话框
const memoryDialogVisible = ref(false)

// 引用选择对话框（多选章节/分卷）
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

// 保存智能体选择到 localStorage，方便下次会话记住
const AGENT_SELECT_KEY = 'arc-assistant-active-agent'

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

onMounted(() => {
  restoreAgentSelection()
  void refreshEnabledModules()
})

/** 统一快捷入口：录入 / 修正 / 审计等常用动作合并为一份，避免重复造轮子。 */
const quickActions: Array<{ label: string; prompt: string }> = [
  { label: '整理项目现状', prompt: '请读取项目资料，整理当前项目概况、下一步创作计划和需要沉淀的创作记忆。' },
  { label: '录入设定草稿', prompt: '我会给你一段设定草稿，请拆成可写入的世界观、人物、组织、大纲或创作记忆暂存变更。' },
  { label: '补全创作记忆', prompt: '请基于现有项目资料，补全当前状态、创作计划、待回收伏笔和素材清单。' },
  { label: '全项目审计', prompt: '请审计当前项目的一致性风险，包括世界观矛盾、人物 OOC、大纲断裂、伏笔未回收和硬约束冲突。' },
  { label: '统一人物口径', prompt: '请检查主要人物的定位、动机和关系是否有矛盾，并给出可暂存的修正方案。' },
  { label: '伏笔审计', prompt: '请读取伏笔线索、章节摘要和创作记忆，列出待回收伏笔、风险和建议处理顺序。' }
]

/** 当前项目已启用的 skills，供输入 / 唤起时快速选择 */
const availableSkills = computed(() =>
  (appStore.currentProject?.projectSkills ?? [])
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, name: s.name, description: s.description, category: s.category }))
)

const assetLinks = computed(() => [
  { id: 'world', label: '世界观', count: appStore.worldviewEntries.length, icon: Globe2 },
  { id: 'characters', label: '角色', count: appStore.characters.length, icon: Users },
  { id: 'relations', label: '关系', count: appStore.characterRelationships.length + appStore.organizations.length, icon: Network },
  { id: 'outline', label: '大纲', count: appStore.outlineItems.length, icon: BookMarked },
  { id: 'threads', label: '伏笔', count: appStore.plotThreads.length, icon: ShieldCheck },
  { id: 'project-knowledge', label: '知识', count: appStore.knowledgeDocuments.length, icon: FileCheck2 }
])

function fillQuickAction(prompt: string): void {
  composerValue.value = prompt
}

function sendWithMode(intentHint?: string): void {
  void assistant.send({
    intentHint: intentHint || 'global-assistant-v2:chat',
    agentId: selectedAgentId.value || undefined
  })
}

function handleAttachFile(): void {
  // 打开多选引用对话框（章节/分卷），选择后以可叉掉的芯片加入待发送引用
  referencePickerVisible.value = true
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

function openKnowledgeDocument(documentId?: string): void {
  appStore.setPanel('project-knowledge')
  if (documentId) {
    appStore.setAssistantFocusTarget('project-knowledge', documentId)
  }
}

// 暂存栏是否折叠（用户可最小化）
const stageCollapsed = ref(false)
const stageBadgeCount = computed(() =>
  assistant.stagedChanges.value.filter(
    (c) => c.status === 'pending' || c.status === 'accepted' || c.status === 'streaming'
  ).length
)

// 左侧对话记录栏是否隐藏
const sessionCollapsed = ref(false)

const SESSION_WIDTH_KEY = 'global-assistant-v2-session-width'
const STAGE_WIDTH_KEY = 'global-assistant-v2-stage-width'
const SESSION_DEFAULT_WIDTH = 220
const SESSION_MIN_WIDTH = 172
const SESSION_MAX_WIDTH = 360
const SESSION_HIDE_THRESHOLD = 148
const STAGE_DEFAULT_WIDTH = 380
const STAGE_MIN_WIDTH = 280
const STAGE_MAX_WIDTH = 680
const STAGE_HIDE_THRESHOLD = 240

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
    // localStorage may be unavailable in some embedded/browser privacy modes.
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

function startSessionResize(event: MouseEvent): void {
  startColumnResize('session', event)
}

function startStageResize(event: MouseEvent): void {
  startColumnResize('stage', event)
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

onMounted(() => {
  sessionWidth.value = readStoredWidth(
    SESSION_WIDTH_KEY,
    SESSION_DEFAULT_WIDTH,
    SESSION_MIN_WIDTH,
    SESSION_MAX_WIDTH
  )
  stageWidth.value = readStoredWidth(
    STAGE_WIDTH_KEY,
    STAGE_DEFAULT_WIDTH,
    STAGE_MIN_WIDTH,
    STAGE_MAX_WIDTH
  )
})

onBeforeUnmount(() => {
  activeResizeCleanup?.()
})

// 写回进行中（独立于 AI 生成状态，仅在真正提交时为 true）
const isCommitting = ref(false)

// 写回已确认变更：完成后给出成功/失败提示
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
</script>

<template>
  <div
    class="v2-page"
    :class="{
      'stage-collapsed': stageCollapsed,
      'session-collapsed': sessionCollapsed,
      'session-resizing': isSessionResizing,
      'stage-resizing': isStageResizing
    }"
    :style="pageStyle"
  >
    <div v-if="!sessionCollapsed" class="session-col" :class="{ resizing: isSessionResizing }">
      <AssistantSessionList
        :sessions="assistant.sessions.value"
        :active-session-id="assistant.activeSessionId.value"
        @switch="(id) => assistant.switchSession(id)"
        @create="assistant.createSession()"
        @delete="(id) => assistant.deleteSession(id)"
        @delete-batch="(ids) => { assistant.deleteSessions(ids); message.success(`已删除 ${ids.length} 个对话`) }"
        @rename="(id, title) => assistant.renameSession(id, title)"
        @collapse="sessionCollapsed = true"
      />
      <div
        class="col-resizer session-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整对话历史栏宽度"
        tabindex="0"
        @mousedown="startSessionResize"
        @keydown.left.prevent="resizeSessionBy(-24)"
        @keydown.right.prevent="resizeSessionBy(24)"
      />
    </div>

    <button
      v-else
      type="button"
      class="session-mini"
      title="展开对话历史"
      @click="reopenSessionPanel"
    >
      <PanelLeftOpen :size="16" />
      <span class="session-mini-label">对话</span>
    </button>

    <div class="main">
      <div v-if="assistant.isStreaming.value" class="stream-strip">
        <span class="dot" /> 生成中…
      </div>

      <!-- 智能体选择器 + 创作记忆 -->
      <div class="agent-toolbar">
        <AgentSelector v-model="selectedAgentId" :project-id="selectedProjectId" @update:model-value="persistAgentSelection" />
        <button
          class="memory-toggle"
          title="创作记忆（学习闭环）"
          @click="memoryDialogVisible = true"
        >
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
        @regenerate="assistant.regenerateTurn"
        @delete-turns="(ids) => assistant.deleteTurns(ids)"
      />

      <div v-else class="starter">
        <div class="starter-inner">
          <div class="starter-head">
            <div class="starter-kicker">智能体</div>
            <h2>需要我做点什么？</h2>
            <p class="starter-sub">沉淀设定、修正跑偏、审计一致性——所有能力都汇聚在此。</p>
          </div>

          <div class="quick-grid">
            <button
              v-for="action in quickActions"
              :key="action.label"
              type="button"
              class="quick-card"
              @click="fillQuickAction(action.prompt)"
            >
              <span>{{ action.label }}</span>
            </button>
          </div>

          <div class="asset-strip">
            <button
              v-for="item in assetLinks"
              :key="item.id"
              type="button"
              class="asset-pill"
              @click="appStore.setPanel(item.id as never)"
            >
              <component :is="item.icon" :size="14" />
              <span>{{ item.count }}</span>
              <em>{{ item.label }}</em>
            </button>
          </div>
        </div>
      </div>

      <div v-if="assistant.lastError.value" class="err-banner">
        {{ assistant.lastError.value }}
      </div>

      <AssistantComposer
        v-model="composerValue"
        :project-id="selectedProjectId"
        :is-streaming="assistant.isStreaming.value"
        :is-canceling="assistant.isCanceling.value"
        :is-editing="Boolean(assistant.editingTurnId.value)"
        :restored-label="assistant.restoredDraftLabel.value"
        :attachments="assistant.pendingAttachments.value"
        :skills="availableSkills"
        :enabled-modules="enabledModules"
        :speech-listening="speechListening"
        @send="sendWithMode"
        @attach="handleAttachFile"
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
        @update-file="(refKey, patch) => assistant.updatePendingAttachment(refKey, patch)"
        @cancel="assistant.cancel()"
        @edit-last="assistant.startEditingLastTurn()"
        @clear-restored="assistant.clearRestoredDraft()"
        @voice-input="handleVoiceInput"
      />
    </div>

    <!-- 折叠态：竖窄条 -->
    <button
      v-if="stageCollapsed"
      class="stage-mini"
      :title="`展开暂存变更 (${stageBadgeCount})`"
      @click="reopenStagePanel"
    >
      <span class="stage-mini-label">暂存</span>
      <span v-if="stageBadgeCount > 0" class="stage-mini-badge">{{ stageBadgeCount }}</span>
    </button>

    <!-- 展开态：完整变更列表 -->
    <div v-else class="stage-col" :class="{ resizing: isStageResizing }">
      <div
        class="col-resizer stage-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整暂存区宽度"
        tabindex="0"
        @mousedown="startStageResize"
        @keydown.left.prevent="resizeStageBy(24)"
        @keydown.right.prevent="resizeStageBy(-24)"
      />
      <div class="stage-col-head">
        <span class="stage-col-title">暂存区</span>
        <button type="button" class="collapse-btn" title="最小化" @click="stageCollapsed = true">
          <span>›</span>
        </button>
      </div>
      <StagedChangesView
        class="stage-view"
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
.v2-page {
  /* 智能体颜色随界面主题所选定的主色变化（不再硬编码 emerald）。 */
  --v2-warn: #b45309;
  --v2-warn-soft: rgba(180, 83, 9, 0.08);
  --v2-danger: #b91c1c;
  --v2-danger-soft: rgba(185, 28, 28, 0.06);
  --v2-add: #047857;
  --v2-add-bg: rgba(4, 120, 87, 0.09);
  --v2-del: #b91c1c;
  --v2-del-bg: rgba(185, 28, 28, 0.07);
  --v2-mono: 'JetBrains Mono', 'Consolas', 'SF Mono', ui-monospace, Menlo, monospace;
  --v2-radius-card: 16px;
  --v2-radius-btn: 10px;
  --session-col-width: 220px;
  --stage-col-width: 380px;
  letter-spacing: -0.005em;
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
}
.session-col,
.stage-col {
  position: relative;
}
.session-col {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--arc-bg-surface);
}
.session-col :deep(.session-list) {
  width: 100%;
  flex: 1 1 auto;
}
.session-mini {
  border: none;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 16px 0;
  gap: 8px;
  transition: background 0.15s ease, color 0.15s ease;
}
.session-mini:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.session-mini-label {
  writing-mode: vertical-rl;
  font-size: 12px;
  letter-spacing: 0.08em;
  font-family: var(--v2-mono);
}
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
.col-resizer:focus-visible::after,
.session-col.resizing .session-resizer::after,
.stage-col.resizing .stage-resizer::after {
  background: var(--arc-primary);
}
.session-resizer {
  right: 0;
}
.stage-resizer {
  left: 0;
}
.main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  position: relative;
}
.agent-toolbar {
  padding: 14px 36px 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 10;
}
.agent-toolbar :deep(.agent-selector) {
  flex: 1 1 auto;
  min-width: 0;
}
.memory-toggle {
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
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  box-sizing: border-box;
}
.memory-toggle:hover {
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  color: var(--arc-primary);
}
.starter {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 36px;
}
.starter-inner {
  width: min(760px, 100%);
  display: flex;
  flex-direction: column;
  gap: 26px;
}
.starter-head {
  text-align: center;
}
.starter-kicker {
  font-family: var(--v2-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--arc-primary);
  margin-bottom: 10px;
}
.starter h2 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 30px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.starter-sub {
  margin: 10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}
.asset-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}
.asset-pill {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-radius: 999px;
  padding: 7px 14px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, transform 0.15s ease, background 0.15s ease;
}
.asset-pill:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 45%, var(--arc-border));
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
  transform: translateY(-1px);
}
.asset-pill span {
  font-family: var(--v2-mono);
  color: var(--arc-text-primary);
}
.asset-pill em {
  font-style: normal;
  font-size: 12px;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.quick-card {
  min-height: 60px;
  border: 1px solid var(--arc-border);
  border-radius: 14px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  text-align: left;
  padding: 13px 15px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.4;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
}
.quick-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  transform: translateY(-2px);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 10%, transparent);
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
  font-family: var(--v2-mono);
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
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: 0.35; } }
.err-banner {
  margin: 0 32px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(185, 28, 28, 0.06);
  border: 1px solid rgba(185, 28, 28, 0.2);
  color: #b91c1c;
  font-size: 12.5px;
}
/* 暂存栏（展开态） */
.stage-col {
  display: flex;
  flex-direction: column;
  width: auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.stage-col.resizing .stage-resizer::after {
  background: var(--arc-primary);
}
.stage-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--arc-border);
  flex-shrink: 0;
  background: var(--arc-bg-surface);
}
.stage-col-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--arc-text-primary);
}
.collapse-btn {
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
.collapse-btn:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.stage-view {
  flex: 1;
  min-height: 0;
  border-left: none;
}
/* 暂存栏（折叠态：竖窄条） */
.stage-mini {
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
.stage-mini:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.stage-mini-label {
  writing-mode: vertical-rl;
  font-size: 12px;
  letter-spacing: 0.08em;
  font-family: var(--v2-mono);
}
.stage-mini-badge {
  font-size: 10px;
  font-family: var(--v2-mono);
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: #fff;
  font-weight: 600;
}
@media (max-width: 980px) {
  .v2-page {
    grid-template-columns: minmax(0, 1fr);
  }
  .session-col,
  .session-mini,
  .stage-col,
  .stage-mini,
  .col-resizer {
    display: none;
  }
  .quick-grid {
    grid-template-columns: 1fr;
  }
}
</style>
