<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { NModal, NInput, NButton, NInputGroup, useMessage } from 'naive-ui'
import {
  History,
  MessageSquareText,
  Plus,
  Sparkles,
  SquareStack,
  X
} from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { type useAssistant } from '@/composables/useAssistant'
import type { TurnTruncateResult } from '@shared/assistant-runtime'
import AgentSelector from '@/components/assistantV2/AgentSelector.vue'
import AssistantSessionList from '@/components/assistantV2/AssistantSessionList.vue'
import AssistantMessages from '@/components/assistantV2/AssistantMessages.vue'
import AssistantComposer from '@/components/assistantV2/AssistantComposer.vue'
import StagedChangesView from '@/components/assistantV2/StagedChangesView.vue'
import ReferencePickerDialog from '@/components/assistantV2/ReferencePickerDialog.vue'
import ChapterFirstDraftDialog from './ChapterFirstDraftDialog.vue'
import { useChapterFirstDraft, type FirstDraftConfig } from './useChapterFirstDraft'
import { usePromptStore, type SavedPrompt } from '@/composables/usePromptStore'

const props = defineProps<{
  /** 由父级 ChapterWorkspace 持有的 assistant 实例，避免 v-if 销毁时丢失暂存状态 */
  assistant: ReturnType<typeof useAssistant>
}>()

/** 最近一次初稿的目标字数，用于字数不足时展示"达到设定目标字数"扩充按钮 */
const draftTargetWordCount = ref(3000)

const emit = defineEmits<{
  close: []
  'generate-draft': []
}>()

const appStore = useAppStore()
const { selectedChapter, selectedProjectId } = storeToRefs(appStore)
const message = useMessage()

// 使用父级传入的实例
const assistant = props.assistant

// ============ 智能体选择（取代原章节助理）============
// 只保留一个选择智能体的卡片（AgentSelector），作用范围（本小说/全局）
// 由卡片内的下拉标签页决定，不再额外提供右侧的独立切换按钮。
const selectedAgentId = ref<string | undefined>(undefined)
// 当前选中智能体的作用范围（'local' 本小说 / 'global' 全局），发送时一并传递。
const selectedAgentScope = ref<'local' | 'global' | undefined>(undefined)

/** 发送时携带当前选中的智能体 ID、作用范围与所属项目。作用范围由选中的智能体自身决定。 */
function agentSendOptions() {
  return {
    agentId: selectedAgentId.value || undefined,
    agentScope: selectedAgentScope.value,
    agentProjectId: appStore.selectedProjectId
  }
}

const composerValue = computed({
  get: () => assistant.composerValue.value,
  set: (value) => { assistant.composerValue.value = value }
})

type PanelTab = 'chat' | 'staged' | 'sessions'
type ChapterMode = 'chat' | 'diagnose' | 'polish' | 'prompts'

const activeTab = ref<PanelTab>('chat')
const activeMode = ref<ChapterMode>('chat')
const isCommitting = ref(false)

// ── 提示词库（存储/新建/删除常用提示词）──
const promptStore = usePromptStore(selectedProjectId)

/** 当前项目已启用的 skills，供输入 / 唤起时快速选择（与工作台智能体对齐） */
const availableSkills = computed(() =>
  (appStore.currentProject?.projectSkills ?? [])
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, name: s.name, description: s.description }))
)

const draft = useChapterFirstDraft()

// 从右下角任务面板恢复被后台化的初稿任务时，重新弹出初稿弹窗
watch(
  () => appStore.getAiTaskRun('chapter-first-draft')?.minimized ?? false,
  (minimized, wasMinimized) => {
    if (wasMinimized === true && minimized === false) {
      draft.restoreFromBackground()
    }
  }
)

const modeOptions: Array<{ id: ChapterMode; label: string; description: string }> = [
  { id: 'chat', label: '对话', description: '问答、分析、建议' },
  { id: 'diagnose', label: '诊断', description: '检查问题并给建议' },
  { id: 'polish', label: '改写', description: '直接输出修改提案' },
  { id: 'prompts', label: '提示词', description: '调用已保存的常用提示词' }
]

const quickActions: Record<ChapterMode, Array<{ label: string; prompt: string }>> = {
  chat: [
    { label: '分析这段', prompt: '分析当前选中段落的写作问题和改进方向' },
    { label: '续写建议', prompt: '基于当前章节上下文，给出续写方向建议' },
    { label: '节奏检查', prompt: '检查当前章节的叙事节奏和信息密度' }
  ],
  diagnose: [
    { label: '全章诊断', prompt: '诊断当前章节的整体问题，给出优先级排序的修改建议' },
    { label: '开头诊断', prompt: '诊断章节开头的吸引力和节奏问题' },
    { label: 'AI味检测', prompt: '检测当前章节中AI感强的表达，并给出修改建议' }
  ],
  polish: [
    { label: '压缩拖沓段落', prompt: '找出拖沓冗余的段落并直接改写压缩' },
    { label: '拆分长句', prompt: '找出过长的句子并拆分改写，让句子长短交替' },
    { label: '降低AI感', prompt: '改写AI味较重的句子，让表达更自然' }
  ],
  prompts: []
}

// ============ 常用提示词库（与工作台智能体共用 promptStore，按项目隔离持久化）============
const promptManagerOpen = ref(false)
const promptEditOpen = ref(false)
const promptDraftLabel = ref('')
const promptDraftText = ref('')
const promptEditingId = ref<string | null>(null)
const promptSearch = ref('')

function openNewPrompt(): void {
  promptEditingId.value = null
  promptDraftLabel.value = ''
  promptDraftText.value = ''
  promptEditOpen.value = true
}

function openEditPrompt(item: SavedPrompt): void {
  promptEditingId.value = item.id
  promptDraftLabel.value = item.label
  promptDraftText.value = item.prompt
  promptEditOpen.value = true
}

function savePromptDraft(): void {
  const label = promptDraftLabel.value.trim()
  const text = promptDraftText.value.trim()
  if (!text) {
    message.warning('提示词内容不能为空')
    return
  }
  const finalLabel = label || text.slice(0, 16)
  if (promptEditingId.value) {
    promptStore.updatePrompt(promptEditingId.value, finalLabel, text)
    message.success('提示词已更新')
  } else {
    promptStore.addPrompt(finalLabel, text)
    message.success('提示词已保存')
  }
  promptEditOpen.value = false
}

function deletePrompt(id: string): void {
  promptStore.deletePrompt(id)
  message.success('提示词已删除')
}

const filteredSavedPrompts = computed(() => {
  const query = promptSearch.value.trim().toLowerCase()
  if (!query) return promptStore.prompts.value
  return promptStore.prompts.value.filter((item) =>
    item.label.toLowerCase().includes(query) || item.prompt.toLowerCase().includes(query)
  )
})

/** prompts 模式下展示的快捷操作：从已保存提示词动态生成 */
const promptQuickActions = computed<Array<{ label: string; prompt: string }>>(() =>
  promptStore.prompts.value.map((item) => ({ label: item.label, prompt: item.prompt }))
)

/** 当前模式下的快捷操作列表（prompts 模式走动态列表） */
const activeQuickActions = computed(() =>
  activeMode.value === 'prompts' ? promptQuickActions.value : quickActions[activeMode.value]
)

const currentMode = computed(() =>
  modeOptions.find((mode) => mode.id === activeMode.value) ?? modeOptions[0]
)

const stagedBadgeCount = computed(() =>
  assistant.stagedChanges.value.filter((change) =>
    change.status === 'pending' || change.status === 'accepted' || change.status === 'streaming'
  ).length
)

const acceptedCount = computed(() =>
  assistant.stagedChanges.value.filter((change) => change.status === 'accepted').length
)

const activeSessionTitle = computed(() =>
  assistant.activeSession.value?.title || '新对话'
)

const hasSelection = computed(() => Boolean(appStore.currentChapterSelection?.text.trim()))

const selectionHint = computed(() => {
  if (!hasSelection.value) return ''
  const text = appStore.currentChapterSelection?.text.trim() || ''
  const snippet = text.length > 20 ? text.slice(0, 20) + '…' : text
  return `已选「${snippet}」`
})

function fillQuickAction(prompt: string): void {
  activeTab.value = 'chat'
  composerValue.value = prompt
}

// ── 提示词库操作（新增/编辑/删除/使用由上方 prompt 逻辑与对话框统一处理）──

/** 选中技能作为引用芯片加入待发送附件（与工作台智能体对齐） */
function handleApplySkill(skill: { id: string; label: string }): void {
  assistant.addPendingAttachment({ kind: 'skill', ref: `skill:${skill.id}`, label: skill.label })
}

/** 上传本地 txt/md 文件到对话（与工作台智能体对齐） */
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
    activeTab.value = 'chat'
    composerValue.value = `【已上传本地文件：${name}】\n${content.slice(0, 60000)}\n${composerValue.value}`
  } catch (e) {
    message.error(e instanceof Error ? e.message : '上传文件失败')
  }
}

function handleUploadFiles(files: File[]): void {
  activeTab.value = 'chat'
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

function sendWithMode(): void {
  activeTab.value = 'chat'

  const selectionHintSuffix = hasSelection.value ? ':with-selection' : ''
  if (hasSelection.value && appStore.currentChapterSelection) {
    const selection = appStore.currentChapterSelection.text.trim()
    // 选区内容前置到消息，并在 intentHint 中标记有选区
    composerValue.value = `【选中内容】\n${selection}\n\n【用户指令】\n${composerValue.value}`
    // 用完后清除选区，避免下一次发送时重复携带
    appStore.updateChapterSelection(null)
  }

  void assistant.send({
    intentHint: `chapter-assistant-v2:${activeMode.value}${selectionHintSuffix}`,
    ...agentSendOptions()
  })
}

// 引用选择对话框（支持多选章节/分卷）
const referencePickerVisible = ref(false)

function handleAttachFile(): void {
  const chapter = appStore.selectedChapter
  if (!chapter) {
    message.warning('请先选择或打开一个章节，再添加文件引用')
    return
  }
  activeTab.value = 'chat'
  // 打开多选对话框，支持一次勾选多个章节/分卷作为引用附件芯片加入待发送区
  referencePickerVisible.value = true
}

function handleReferenceConfirm(refs: Array<{ kind: 'chapter' | 'volume'; id: string; label: string }>): void {
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
    intentHint: `chapter-assistant-v2:${activeMode.value}`
  })
  if (result) notifyTruncate(result, '重新分叉')
}

function createSession(): void {
  activeTab.value = 'chat'
  void assistant.createSession()
}

function switchSession(sessionId: string): void {
  activeTab.value = 'chat'
  void assistant.switchSession(sessionId)
}

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

function sendPrompt(prompt: string): void {
  composerValue.value = prompt
  void assistant.send(agentSendOptions())
}

// 悬浮工具栏调用：携带完整选区文本和动作类型发送
function sendPromptWithAction(action: string, selectionText: string): void {
  activeTab.value = 'chat'
  composerValue.value = `【选中内容】\n${selectionText}\n\n【用户指令】\n${action}以上选中内容`
  // 用完后清除选区，避免后续发送时重复携带
  appStore.updateChapterSelection(null)
  void assistant.send({
    intentHint: `chapter-assistant-v2:polish:with-selection`,
    ...agentSendOptions()
  })
}

function triggerDraft(config?: FirstDraftConfig): void {
  void handleDraft(config)
}


async function handleDraft(config?: FirstDraftConfig): Promise<void> {
  if (!config) return
  draftTargetWordCount.value = config.targetWordCount || 3000
  try { await draft.start(config) } catch (error) { message.error(error instanceof Error ? error.message : 'AI 初稿生成失败') }
}

/** 围绕已有初稿扩充续写，直到达到设定目标字数 */
async function handleExpandDraft(targetWordCount: number): Promise<void> {
  const existingDraft = draft.previewContent.value.trim() || draft.streamingContent.value.trim()
  if (!existingDraft) {
    message.warning('暂无可扩充的初稿内容')
    return
  }
  const target = Math.max(targetWordCount, draftTargetWordCount.value)
  try { await draft.expandDraftToTarget(existingDraft, target) } catch (error) { message.error(error instanceof Error ? error.message : 'AI 扩充续写失败') }
}

/** 将已有初稿精简压缩到目标字数 */
async function handleReduceDraft(targetWordCount: number): Promise<void> {
  const existingDraft = draft.previewContent.value.trim() || draft.streamingContent.value.trim()
  if (!existingDraft) {
    message.warning('暂无可精简的初稿内容')
    return
  }
  const target = Math.max(targetWordCount, 1)
  try { await draft.reduceDraftToTarget(existingDraft, target) } catch (error) { message.error(error instanceof Error ? error.message : 'AI 精简章节失败') }
}

/**
 * 按目标字数控制当前章节正文：
 * 测量当前正文字数，超出目标则精简，少于目标则扩充。
 */
async function applyTargetWords(targetWordCount: number): Promise<void> {
  const chapter = appStore.selectedChapter
  const plain = chapter?.content ? getPlainTextFromEditorContent(chapter.content).trim() : ''
  const currentCount = plain.length
  if (!currentCount) {
    message.warning('当前章节还没有正文，无法按目标字数调整')
    return
  }
  const target = Math.max(targetWordCount, 1)
  if (currentCount > target * 1.1) {
    // 超出目标：基于当前章节正文精简
    try { await draft.reduceDraftToTarget(plain, target) } catch (error) { message.error(error instanceof Error ? error.message : 'AI 精简章节失败') }
  } else if (currentCount < target * 0.9) {
    // 不足目标：基于当前章节正文扩充续写（不再依赖初稿预览，避免“暂无可扩充”误报）
    try { await draft.expandDraftToTarget(plain, target) } catch (error) { message.error(error instanceof Error ? error.message : 'AI 扩充续写失败') }
  } else {
    message.info(`当前正文约 ${currentCount} 字，已在目标 ${target} 字的合理范围内，无需调整`)
  }
}

function handlePanelMouseDown(event: MouseEvent): void {
  // 点击面板时保留编辑器选区
  const target = event.target as HTMLElement

  // 对于输入框和文本区域，不阻止默认行为（需要能正常获得焦点）
  // 但通过 relatedTarget 检查，如果是从编辑器失焦过来的，不清除选区
  if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
    // 不阻止，让输入框正常获得焦点
    return
  }

  // 允许这些元素的默认行为（可选中文字、可点击）
  if (
    target.tagName === 'BUTTON' ||
    target.tagName === 'A' ||
    target.closest('button') || // 包含在button内的元素
    target.closest('.n-button') || // naive-ui button
    target.closest('pre') || // 代码块
    target.closest('.markdown-body') || // markdown渲染的内容
    target.closest('.assistant-copy') || // 助手回复内容
    target.closest('.user-content') // 用户消息内容
  ) {
    return
  }

  // 其他区域阻止默认行为，保留编辑器选区
  event.preventDefault()
}

defineExpose({ sendPrompt, sendPromptWithAction, triggerDraft, applyTargetWords, handleReduceDraft })
</script>

<template>
  <section class="v2-dock chapter-dock" @mousedown.capture="handlePanelMouseDown">
    <header class="dock-head">
      <div class="dock-brand">
        <span class="brand-mark"><Sparkles :size="15" /></span>
        <div class="brand-copy">
          <strong>智能体</strong>
          <span>{{ selectedChapter?.title || '章节工作台' }}</span>
        </div>
      </div>
      <div class="head-actions">
        <button type="button" title="新建对话" @click="createSession">
          <Plus :size="16" />
        </button>
        <button type="button" title="关闭" @click="emit('close')">
          <X :size="16" />
        </button>
      </div>
    </header>

    <div class="agent-strip">
      <AgentSelector
        v-model="selectedAgentId"
        :project-id="appStore.selectedProjectId"
        @update:scope="(s) => { selectedAgentScope = s }"
      />
    </div>

    <div class="session-strip">
      <span>{{ activeSessionTitle }}</span>
      <button type="button" @click="activeTab = 'sessions'">
        {{ assistant.sessions.value.length }} 个会话
      </button>
    </div>

    <nav class="dock-tabs" aria-label="助手视图">
      <button
        type="button"
        :class="{ active: activeTab === 'chat' }"
        @click="activeTab = 'chat'"
      >
        <MessageSquareText :size="14" />
        对话
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'staged' }"
        @click="activeTab = 'staged'"
      >
        <SquareStack :size="14" />
        暂存
        <span v-if="stagedBadgeCount > 0" class="tab-badge">{{ stagedBadgeCount }}</span>
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'sessions' }"
        @click="activeTab = 'sessions'"
      >
        <History :size="14" />
        历史
      </button>
    </nav>

    <div v-if="activeTab === 'sessions'" class="sessions-pane">
      <AssistantSessionList
        :sessions="assistant.sessions.value"
        :active-session-id="assistant.activeSessionId.value"
        @switch="switchSession"
        @create="createSession"
        @delete="(id) => assistant.deleteSession(id)"
        @rename="(id, title) => assistant.renameSession(id, title)"
        @collapse="activeTab = 'chat'"
      />
    </div>

    <div v-else-if="activeTab === 'staged'" class="staged-pane">
      <StagedChangesView
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

    <div v-else class="chat-pane">
      <AssistantMessages
        v-if="assistant.messages.value.length > 0 || assistant.isStreaming.value || assistant.isInitializing.value"
        :messages="assistant.messages.value"
        :is-streaming="assistant.isStreaming.value"
        :is-initializing="assistant.isInitializing.value"
        assistant-name="智能体"
        :editing-turn-id="assistant.editingTurnId.value"
        :editing-draft="assistant.editingDraft.value"
        :is-mutating="assistant.isTruncating.value"
        :staged-changes="assistant.stagedChanges.value"
        @continue="assistant.continueWithPrompt"
        @rollback="(id, prompt) => assistant.rollbackTurn(id, prompt)"
        @open-staged="activeTab = 'staged'"
        @edit-start="assistant.startEditingTurn"
        @edit-cancel="assistant.cancelEditing"
        @edit-draft="assistant.updateEditingDraft"
        @resend="handleResendTurn"
        @undo="handleUndoTurn"
        @regenerate="assistant.regenerateTurn"
      />

      <div v-else class="starter">
        <div class="starter-head">
          <div class="starter-kicker">Chapter Assistant v2</div>
          <h3>从哪里开始？</h3>
          <p>{{ currentMode.description }}</p>
        </div>

        <div class="mode-switch" role="tablist" aria-label="助手模式">
          <button
            v-for="mode in modeOptions"
            :key="mode.id"
            type="button"
            :class="{ active: activeMode === mode.id }"
            @click="activeMode = mode.id"
          >
            {{ mode.label }}
          </button>
        </div>

        <div class="quick-list">
          <button
            v-for="action in activeQuickActions"
            :key="action.label + action.prompt"
            type="button"
            @click="fillQuickAction(action.prompt)"
          >
            {{ action.label }}
          </button>
        </div>

        <div v-if="activeMode === 'prompts'" class="prompt-manage-row">
          <button type="button" class="prompt-manage-btn" @click="openNewPrompt">
            <Plus :size="14" />
            新建提示词
          </button>
          <button type="button" class="prompt-manage-btn" @click="promptManagerOpen = true">
            <SquareStack :size="14" />
            管理提示词
            <span v-if="promptStore.prompts.value.length > 0" class="prompt-count">{{ promptStore.prompts.value.length }}</span>
          </button>
        </div>

        <div v-if="activeMode === 'prompts' && promptStore.prompts.value.length === 0" class="prompt-empty">
          还没有保存的提示词，点击上方「新建提示词」创建你的第一条常用提示词。
        </div>

        <div class="draft-entry">
          <button type="button" class="draft-btn" @click="emit('generate-draft')">
            <Sparkles :size="14" />
            生成章节初稿
          </button>
        </div>
      </div>

      <div v-if="assistant.lastError.value" class="err-banner">
        {{ assistant.lastError.value }}
      </div>

      <ReferencePickerDialog
        v-model:visible="referencePickerVisible"
        @confirm="handleReferenceConfirm"
      />

      <AssistantComposer
        v-model="composerValue"
        :project-id="selectedProjectId"
        :is-streaming="assistant.isStreaming.value"
        :is-canceling="assistant.isCanceling.value"
        :streaming-char-count="assistant.streamingCharCount.value"
        :is-editing="Boolean(assistant.editingTurnId.value)"
        :restored-label="assistant.restoredDraftLabel.value"
        :mode-label="hasSelection ? selectionHint : currentMode.label"
        :attachments="assistant.pendingAttachments.value"
        :skills="availableSkills"
        @send="sendWithMode"
        @attach="handleAttachFile"
        @apply-skill="handleApplySkill"
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
      />
    </div>

    <footer v-if="activeTab !== 'chat' && acceptedCount > 0" class="dock-foot">
      <button type="button" @click="activeTab = 'staged'">
        {{ acceptedCount }} 项已确认，待写回
      </button>
    </footer>

    <ChapterFirstDraftDialog
      :show="draft.modalVisible.value"
      :is-generating="draft.isGenerating.value"
      :is-stopping="draft.isStopping.value"
      :is-auditing="draft.isAuditing.value"
      :is-streaming="draft.isStreaming.value"
      :execution-label="draft.executionLabel.value"
      :reasoning-content="draft.reasoningContent.value"
      :preview-title="draft.previewTitle.value"
      :preview-content="draft.previewContent.value"
      :progress-percent="draft.progressPercent.value"
      :progress-text="draft.progressText.value"
      :audit-result="draft.auditResult.value"
      :elapsed-seconds="draft.elapsedSeconds.value"
      :target-word-count="draftTargetWordCount"
      :current-draft="draft.previewContent.value"
      @stop="async () => { try { await draft.stop() } catch (e) { message.error(e instanceof Error ? e.message : '停止失败') } }"
      @minimize="draft.minimizeToBackground()"
      @close="draft.closeModal()"
      @expand="(target) => handleExpandDraft(target)"
      @reduce="(target) => handleReduceDraft(target)"
    />

    <!-- 提示词：新建/编辑对话框 -->
    <NModal
      :show="promptEditOpen"
      preset="dialog"
      :title="promptEditingId ? '编辑提示词' : '新建提示词'"
      style="width: 460px"
      @close="promptEditOpen = false"
    >
      <div class="prompt-dialog">
        <label class="prompt-field">
          <span>名称（可选）</span>
          <NInput
            v-model:value="promptDraftLabel"
            placeholder="给提示词起个名字，便于识别"
            maxlength="40"
          />
        </label>
        <label class="prompt-field">
          <span>提示词内容</span>
          <NInput
            v-model:value="promptDraftText"
            type="textarea"
            :rows="5"
            placeholder="输入你想保存的常用提示词内容…"
          />
        </label>
        <div class="prompt-dialog-actions">
          <NButton @click="promptEditOpen = false">取消</NButton>
          <NButton type="primary" @click="savePromptDraft">
            {{ promptEditingId ? '保存修改' : '保存提示词' }}
          </NButton>
        </div>
      </div>
    </NModal>

    <!-- 提示词：管理对话框 -->
    <NModal
      :show="promptManagerOpen"
      preset="card"
      title="管理提示词"
      style="width: 520px"
      @close="promptManagerOpen = false"
    >
      <div class="prompt-manager">
        <div class="prompt-manager-head">
          <NInputGroup>
            <NInput v-model:value="promptSearch" placeholder="搜索提示词…" clearable />
          </NInputGroup>
          <NButton type="primary" @click="openNewPrompt">
            <template #icon><Plus :size="14" /></template>
            新建
          </NButton>
        </div>
        <div class="prompt-manager-list">
          <div v-if="filteredSavedPrompts.length === 0" class="prompt-manager-empty">
            暂无提示词
          </div>
          <div
            v-for="item in filteredSavedPrompts"
            :key="item.id"
            class="prompt-manager-item"
          >
            <button
              type="button"
              class="prompt-item-main"
              title="点击使用"
              @click="promptManagerOpen = false; fillQuickAction(item.prompt)"
            >
              <strong>{{ item.label }}</strong>
              <span>{{ item.prompt }}</span>
            </button>
            <div class="prompt-item-actions">
              <button type="button" title="编辑" @click="promptManagerOpen = false; openEditPrompt(item)">
                <History :size="14" />
              </button>
              <button type="button" class="danger" title="删除" @click="deletePrompt(item.id)">
                <X :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
.v2-dock {
  --v2-accent-line: color-mix(in srgb, var(--arc-primary) 22%, transparent);
  --v2-warn: #b45309;
  --v2-warn-soft: rgba(180, 83, 9, 0.08);
  --v2-danger: #b91c1c;
  --v2-danger-soft: rgba(185, 28, 28, 0.06);
  --v2-add: #047857;
  --v2-add-bg: rgba(4, 120, 87, 0.09);
  --v2-del: #b91c1c;
  --v2-del-bg: rgba(185, 28, 28, 0.07);
  --v2-mono: 'JetBrains Mono', 'Consolas', 'SF Mono', ui-monospace, Menlo, monospace;
  --v2-radius-card: 8px;
  --v2-radius-btn: 8px;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--arc-bg-surface);
  border-left: 2px solid var(--arc-border-strong);
  color: var(--arc-text-primary);
}

.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 12px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.dock-brand {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.brand-mark {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.brand-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.brand-copy strong {
  font-size: 13px;
  color: var(--arc-text-primary);
}

.brand-copy span {
  max-width: 210px;
  overflow: hidden;
  color: var(--arc-text-hint);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
}

.head-actions button {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
}

.head-actions button:hover {
  border-color: var(--arc-border);
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}

.session-strip {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 10px;
  padding: 0 14px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.agent-strip {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.agent-strip :deep(.agent-selector) {
  flex: 1;
  min-width: 0;
}
.agent-strip :deep(.selector-trigger) {
  width: 100%;
  max-width: none;
}

.session-strip span {
  min-width: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-strip button {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 11.5px;
}

.dock-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  flex-shrink: 0;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.dock-tabs button {
  display: inline-flex;
  min-width: 0;
  height: 30px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
}

.dock-tabs button.active {
  border-color: var(--v2-accent-line);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 600;
}

.tab-badge {
  min-width: 16px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: #fff;
  font-family: var(--v2-mono);
  font-size: 10px;
  line-height: 16px;
  padding: 0 5px;
}

.chat-pane,
.staged-pane,
.sessions-pane {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.chat-pane {
  position: relative;
}

.starter {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 16px;
}

.starter-head {
  margin: 8px 0 16px;
}

.starter-kicker {
  margin-bottom: 5px;
  color: var(--arc-primary);
  font-family: var(--v2-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.starter h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 20px;
  line-height: 1.2;
}

.starter p {
  margin: 6px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
}

.mode-switch {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
}

.mode-switch button {
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 6px 7px;
}

/* ── 提示词库 ── */
.mode-switch button.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 600;
}

.quick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.quick-list button {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  font-size: 12.5px;
  line-height: 1.4;
  padding: 10px 11px;
  text-align: left;
}

.quick-list button:hover {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.draft-entry {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--arc-border);
}

.draft-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  padding: 10px 12px;
}

.draft-btn:hover {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.err-banner {
  margin: 0 14px 8px;
  border: 1px solid rgba(185, 28, 28, 0.2);
  border-radius: 8px;
  background: var(--v2-danger-soft);
  color: var(--v2-danger);
  font-size: 12px;
  padding: 8px 10px;
}

.selection-chip {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
}

.dock-foot {
  flex-shrink: 0;
  padding: 9px 12px;
  border-top: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.dock-foot button {
  width: 100%;
  border: 1px solid var(--v2-accent-line);
  border-radius: 8px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 8px 10px;
}

.sessions-pane :deep(.session-list) {
  width: 100%;
  flex: 1;
  border-right: none;
}

.staged-pane :deep(.stage) {
  height: 100%;
  border-left: none;
}

.staged-pane :deep(.head) {
  padding: 14px 14px 10px;
}

.staged-pane :deep(.list) {
  padding: 10px 12px 14px;
}

.staged-pane :deep(.change) {
  border-radius: 8px;
  padding: 10px 11px;
}

.chat-pane :deep(.messages) {
  padding: 18px 16px 10px;
  gap: 18px;
}

.chat-pane :deep(.composer-wrap) {
  flex-shrink: 0;
  padding: 10px 14px 14px;
  background: linear-gradient(180deg, transparent, var(--arc-bg-body) 35%);
}

.chat-pane :deep(.composer) {
  max-width: none;
  border-radius: 12px;
  box-shadow: var(--arc-shadow-sm);
}

.chat-pane :deep(.composer .foot) {
  align-items: flex-end;
}

.prompt-manage-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.prompt-manage-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 6px;
  border: 1px dashed var(--arc-border-strong);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 8px 10px;
}

.prompt-manage-btn:hover {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.prompt-count {
  min-width: 16px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  padding: 0 5px;
  text-align: center;
}

.prompt-empty {
  margin-top: 12px;
  border: 1px dashed var(--arc-border);
  border-radius: 8px;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
  padding: 14px 12px;
}

.prompt-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 6px;
}

.prompt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prompt-field > span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.prompt-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.prompt-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-manager-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prompt-manager-head .n-input-group {
  flex: 1;
}

.prompt-manager-list {
  display: flex;
  max-height: 340px;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.prompt-manager-empty {
  color: var(--arc-text-hint);
  font-size: 12px;
  padding: 24px 0;
  text-align: center;
}

.prompt-manager-item {
  display: flex;
  align-items: stretch;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 8px;
}

.prompt-manager-item:hover {
  border-color: var(--arc-primary);
}

.prompt-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--arc-text-primary);
  cursor: pointer;
  text-align: left;
  padding: 4px;
}

.prompt-item-main strong {
  font-size: 12.5px;
}

.prompt-item-main span {
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.prompt-item-actions button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
}

.prompt-item-actions button:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-primary);
}

.prompt-item-actions button.danger:hover {
  background: var(--v2-del-bg);
  color: var(--v2-del);
}
</style>
