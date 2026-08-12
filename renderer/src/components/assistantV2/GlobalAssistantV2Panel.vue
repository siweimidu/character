<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import {
  Bookmark,
  History,
  MessageSquareText,
  Plus,
  Sparkles,
  SquareStack,
  Trash2,
  X
} from 'lucide-vue-next'
import type { SurfaceDefinition, TurnTruncateResult } from '@shared/assistant-runtime'
import { useAppStore } from '@/stores/app'
import { useAssistant } from '@/composables/useAssistant'
import { usePromptStore } from '@/composables/usePromptStore'
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

type PanelTab = 'chat' | 'staged' | 'sessions'

const activeTab = ref<PanelTab>('chat')
const isCommitting = ref(false)

// ── 提示词库（存储/新建/删除常用提示词，与章节创作智能体共用同一套）──
const newPromptLabel = ref('')
const newPromptText = ref('')
const promptStore = usePromptStore(selectedProjectId)

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

// ── 提示词库操作 ──
function handleSavePrompt(): void {
  if (!newPromptText.value.trim()) {
    message.warning('请输入提示词内容')
    return
  }
  promptStore.savePrompt(newPromptLabel.value, newPromptText.value)
  newPromptLabel.value = ''
  newPromptText.value = ''
  message.success('提示词已保存')
}

function handleUsePrompt(promptText: string): void {
  activeTab.value = 'chat'
  composerValue.value = promptText
}

function handleDeletePrompt(id: string, label: string): void {
  if (!confirm(`确定删除提示词「${label}」吗？`)) return
  promptStore.deletePrompt(id)
  message.success('提示词已删除')
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
        @open-knowledge="openKnowledgeDocument"
        @continue="assistant.continueWithPrompt"
        @open-staged="activeTab = 'staged'"
        @rollback="assistant.rollbackTurn"
        @edit-start="assistant.startEditingTurn"
        @edit-cancel="assistant.cancelEditing"
        @edit-draft="assistant.updateEditingDraft"
        @resend="handleResendTurn"
        @undo="handleUndoTurn"
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

        <div class="prompt-section">
          <div class="prompt-section-title">
            <Bookmark :size="13" />
            提示词库
          </div>
          <div class="prompt-form">
            <input
              v-model="newPromptLabel"
              class="prompt-name-input"
              placeholder="提示词名称（可选）"
              maxlength="30"
            />
            <textarea
              v-model="newPromptText"
              class="prompt-text-input"
              placeholder="输入要保存的常用提示词…"
              rows="2"
            ></textarea>
            <button type="button" class="prompt-save-btn" @click="handleSavePrompt">
              <Plus :size="13" />
              保存提示词
            </button>
          </div>
          <div v-if="promptStore.prompts.value.length === 0" class="prompt-empty">
            <Bookmark :size="14" />
            还没有保存的提示词，填入并保存一条吧。
          </div>
          <div v-else class="prompt-list">
            <div v-for="p in promptStore.prompts.value" :key="p.id" class="prompt-item">
              <button type="button" class="prompt-item-main" @click="handleUsePrompt(p.prompt)">
                <span class="prompt-item-label">{{ p.label }}</span>
                <span class="prompt-item-text">{{ p.prompt }}</span>
              </button>
              <button
                type="button"
                class="prompt-del-btn"
                title="删除提示词"
                aria-label="删除提示词"
                @click="handleDeletePrompt(p.id, p.label)"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="assistant.lastError.value" class="err-banner">
        {{ assistant.lastError.value }}
      </div>

      <AssistantComposer
        v-model="composerValue"
        :is-streaming="assistant.isStreaming.value"
        :is-canceling="assistant.isCanceling.value"
        :streaming-char-count="assistant.streamingCharCount.value"
        :is-editing="Boolean(assistant.editingTurnId.value)"
        :restored-label="assistant.restoredDraftLabel.value"
        :attachments="assistant.pendingAttachments.value"
        :skills="availableSkills"
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
        @add-file="(file) => assistant.addPendingAttachment({ kind: 'file', ref: `file:${file.name}`, label: file.name, content: file.content, mime: file.mime, size: file.size })"
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
  --v2-radius-card: 8px;
  --v2-radius-btn: 8px;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
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

.agent-strip {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 6px 14px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
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

/* ── 提示词库 ── */
.prompt-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px dashed var(--arc-border);
}

.prompt-section-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--arc-text-hint);
  font-size: 11.5px;
  font-weight: 600;
}

.prompt-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
}

.prompt-name-input,
.prompt-text-input {
  width: 100%;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font-size: 12.5px;
  padding: 6px 8px;
  resize: vertical;
}

.prompt-name-input:focus,
.prompt-text-input:focus {
  outline: none;
  border-color: var(--arc-primary);
}

.prompt-save-btn {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--arc-primary);
  border-radius: 7px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
}

.prompt-save-btn:hover {
  background: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-bg-surface));
}

.prompt-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 10px;
  border: 1px dashed var(--arc-border);
  border-radius: 8px;
  color: var(--arc-text-hint);
  font-size: 12px;
  text-align: center;
}

.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.prompt-item {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 4px 4px 4px 10px;
}

.prompt-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: none;
  background: transparent;
  color: var(--arc-text-primary);
  text-align: left;
  cursor: pointer;
  padding: 6px 0;
}

.prompt-item-main:hover .prompt-item-label {
  color: var(--arc-primary);
}

.prompt-item-label {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-item-text {
  font-size: 11.5px;
  color: var(--arc-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-del-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
}

.prompt-del-btn:hover {
  color: var(--v2-danger);
  background: var(--v2-del-bg);
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

.chat-pane :deep(.composer .hint span:last-child) {
  display: none;
}

.chat-pane :deep(.composer .foot) {
  align-items: flex-end;
}
</style>
