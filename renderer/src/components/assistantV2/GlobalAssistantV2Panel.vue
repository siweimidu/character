<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import {
  History,
  MessageSquareText,
  Plus,
  Sparkles,
  SquareStack,
  X
} from 'lucide-vue-next'
import type { SurfaceDefinition, TurnTruncateResult } from '@shared/assistant-runtime'
import type { AgentModuleRuntime } from '@shared/agent-modules'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import { createSpeechRecorder, startBrowserSpeech } from '@/features/settings/speechInput'
import AssistantSessionList from './AssistantSessionList.vue'
import AssistantMessages from './AssistantMessages.vue'
import AssistantComposer from './AssistantComposer.vue'
import StagedChangesView from './StagedChangesView.vue'
import AgentSelector from './AgentSelector.vue'
import ReferencePickerDialog from './ReferencePickerDialog.vue'

const props = defineProps<{
  activeViewLabel?: string
}>()

const emit = defineEmits<{
  close: []
}>()

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
  set: (value) => { assistant.composerValue.value = value }
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
void refreshEnabledModules()

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
      const res = await window.characterArc.transcribeSpeech({ settings, audioData, audioType: mimeType })
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
    message.warning('未配置语音识别厂商且当前环境不支持浏览器语音输入，请使用 Chrome/Edge，或在「设置 → 语音识别配置」中填写厂商信息。')
    return
  }
  speechRecognition = browser as unknown as typeof speechRecognition
  speechListening.value = true
  message.success('开始录音，请说话…')
}

type PanelTab = 'chat' | 'staged' | 'sessions'

const activeTab = ref<PanelTab>('chat')
const isCommitting = ref(false)

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
  activeTab.value = 'chat'
}

// 智能体选择
const selectedAgentId = ref<string>('')
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
restoreAgentSelection()

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
    .map((s) => ({ id: s.id, name: s.name, description: s.description }))
)

const stagedBadgeCount = computed(() =>
  assistant.stagedChanges.value.filter((change) =>
    change.status === 'pending' ||
    change.status === 'accepted' ||
    change.status === 'streaming'
  ).length
)

const acceptedCount = computed(() =>
  assistant.stagedChanges.value.filter((change) => change.status === 'accepted').length
)

const activeSessionTitle = computed(() =>
  assistant.activeSession.value?.title || '新会话'
)

const activeContextLabel = computed(() =>
  props.activeViewLabel?.trim() || '项目工作台'
)

function fillQuickAction(prompt: string): void {
  activeTab.value = 'chat'
  composerValue.value = prompt
}

function sendWithMode(intentHint?: string): void {
  activeTab.value = 'chat'
  void assistant.send({
    intentHint: intentHint || 'global-assistant-v2:chat',
    agentId: selectedAgentId.value || undefined
  })
}

function handleAttachFile(): void {
  // 打开多选引用对话框（章节/分卷），选择后以可叉掉的芯片加入待发送引用
  activeTab.value = 'chat'
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
    activeTab.value = 'chat'
    composerValue.value = `【已上传本地文件：${name}】\n${content.slice(0, 60000)}\n${composerValue.value}`
  } catch (e) {
    message.error(e instanceof Error ? e.message : '上传文件失败')
  }
}

/** 拖拽本地文本文件到对话（前端直接读取 File 对象内容） */
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
  emit('close')
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
</script>

<template>
  <section class="v2-dock">
    <header class="dock-head">
      <div class="dock-brand">
        <span class="brand-mark"><Sparkles :size="15" /></span>
        <div class="brand-copy">
          <strong>智能体</strong>
          <span>{{ activeContextLabel }}</span>
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
      <AgentSelector v-model="selectedAgentId" :project-id="selectedProjectId" @update:model-value="persistAgentSelection" />
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
        :title="'对话'"
        @click="activeTab = 'chat'"
      >
        <MessageSquareText :size="14" />
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'staged' }"
        :title="'暂存'"
        @click="activeTab = 'staged'"
      >
        <SquareStack :size="14" />
        <span v-if="stagedBadgeCount > 0" class="tab-badge">{{ stagedBadgeCount }}</span>
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'sessions' }"
        :title="'历史'"
        @click="activeTab = 'sessions'"
      >
        <History :size="14" />
      </button>
    </nav>

    <div v-if="activeTab === 'sessions'" class="sessions-pane">
      <AssistantSessionList
        :sessions="assistant.sessions.value"
        :active-session-id="assistant.activeSessionId.value"
        @switch="switchSession"
        @create="createSession"
        @delete="(id) => assistant.deleteSession(id)"
        @delete-batch="(ids) => { assistant.deleteSessions(ids); message.success(`已删除 ${ids.length} 个对话`) }"
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
        @open-knowledge="openKnowledgeDocument"
        @continue="assistant.continueWithPrompt"
        @open-staged="activeTab = 'staged'"
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
        <div class="starter-head">
          <div class="starter-kicker">Runtime v2</div>
          <h3>从哪里开始？</h3>
          <p>沉淀设定、修正跑偏、审计一致性——所有能力都汇聚在此。</p>
        </div>

        <div class="quick-list">
          <button
            v-for="action in quickActions"
            :key="action.label"
            type="button"
            @click="fillQuickAction(action.prompt)"
          >
            {{ action.label }}
          </button>
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
        :streaming-char-count="assistant.streamingCharCount.value"
        :is-editing="Boolean(assistant.editingTurnId.value)"
        :restored-label="assistant.restoredDraftLabel.value"
        :attachments="assistant.pendingAttachments.value"
        :skills="availableSkills"
        :enabled-modules="enabledModules"
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
        @cancel="assistant.cancel()"
        @edit-last="assistant.startEditingLastTurn()"
        @clear-restored="assistant.clearRestoredDraft()"
        @voice-input="handleVoiceInput"
      />
    </div>

    <footer v-if="activeTab !== 'chat' && acceptedCount > 0" class="dock-foot">
      <button type="button" @click="activeTab = 'staged'">
        {{ acceptedCount }} 项已确认，待写回
      </button>
    </footer>

    <ReferencePickerDialog
      v-model:visible="referencePickerVisible"
      @confirm="handleReferenceConfirm"
    />
  </section>
</template>

<style scoped>
.v2-dock {
  /* 智能体颜色随界面主题所选定的主色变化（不再硬编码 emerald）。 */
  --v2-accent-line: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  --v2-warn: #b45309;
  --v2-warn-soft: rgba(180, 83, 9, 0.08);
  --v2-danger: #b91c1c;
  --v2-danger-soft: rgba(185, 28, 28, 0.06);
  --v2-add: #047857;
  --v2-add-bg: rgba(4, 120, 87, 0.09);
  --v2-del: #b91c1c;
  --v2-del-bg: rgba(185, 28, 28, 0.07);
  --v2-mono: 'JetBrains Mono', 'Consolas', 'SF Mono', ui-monospace, Menlo, monospace;
  --v2-radius-card: 12px;
  --v2-radius-btn: 10px;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font-family: 'Stack Sans Text', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
}

.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 12px;
  padding: 16px 16px 12px;
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
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
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

.agent-strip {
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.session-strip {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
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
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.dock-tabs button {
  display: inline-flex;
  min-width: 0;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.dock-tabs button:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
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

.quick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.quick-list button {
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  font-size: 12.5px;
  line-height: 1.45;
  padding: 11px 13px;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.quick-list button:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  transform: translateY(-1px);
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

.dock-foot {
  flex-shrink: 0;
  padding: 9px 12px;
  border-top: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.dock-foot button {
  width: 100%;
  border: 1px solid var(--v2-accent-line);
  border-radius: 10px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 9px 12px;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.dock-foot button:hover {
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-surface));
  border-color: var(--arc-primary);
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
  border-radius: 12px;
  padding: 11px 13px;
}

.chat-pane :deep(.messages) {
  padding: 18px 18px 10px;
  gap: 20px;
}

.chat-pane :deep(.composer-wrap) {
  flex-shrink: 0;
  padding: 12px 16px 16px;
  background: linear-gradient(180deg, transparent, var(--arc-bg-body) 35%);
}

.chat-pane :deep(.composer) {
  max-width: none;
  border-radius: 16px;
  box-shadow: 0 2px 12px color-mix(in srgb, var(--arc-text-primary) 6%, transparent);
}

.chat-pane :deep(.composer .hint span:last-child) {
  display: none;
}

.chat-pane :deep(.composer .foot) {
  align-items: flex-end;
}
</style>
