<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import { Paperclip, Square, Undo2, Upload, X } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
  isStreaming: boolean
  isCanceling?: boolean
  modeLabel?: string
  streamingCharCount?: number
  isEditing?: boolean
  restoredLabel?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send', intentHint?: string): void
  (e: 'attach'): void
  (e: 'upload-file'): void
  (e: 'upload-files', files: File[]): void
  (e: 'cancel'): void
  (e: 'edit-last'): void
  (e: 'clear-restored'): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
let lastEscapeAt = 0

/** 斜杠命令快捷指令：输入框内以 / 触发，选中后填充模板并附带 intentHint。 */
const SLASH_COMMANDS: Array<{
  key: string
  label: string
  description: string
  template: string
  intentHint: string
}> = [
  { key: 'audit', label: '/audit', description: '全书审计：矛盾、OOC、伏笔', template: '请审计当前项目的一致性风险，包括世界观矛盾、人物 OOC、大纲断裂、伏笔未回收和硬约束冲突。', intentHint: 'slash:audit' },
  { key: 'fix', label: '/fix', description: '修正一致性', template: '请检查项目里可能跑偏或重复的设定，并把需要修正的内容产出为可暂存的修正方案。', intentHint: 'slash:fix' },
  { key: 'ingest', label: '/ingest', description: '录入设定草稿', template: '我会给你一段设定草稿，请拆成可写入的世界观、人物、组织、大纲或创作记忆暂存变更。', intentHint: 'slash:ingest' },
  { key: 'summarize', label: '/summarize', description: '章节摘要', template: '请读取最近章节并生成摘要，补全章节创作记忆。', intentHint: 'slash:summarize' },
  { key: 'continuation', label: '/continuation', description: '续写', template: '请基于当前章节进度和项目设定，续写后续内容。', intentHint: 'slash:continuation' }
]

// 斜杠命令弹层状态
const slashQuery = ref('')
const slashOpen = ref(false)
const slashActiveIdx = ref(0)
const slashMenuRef = ref<HTMLDivElement | null>(null)

const slashMatches = computed(() => {
  const q = slashQuery.value.trim().toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((c) => c.key.includes(q) || c.label.includes(q))
})

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
  autosize(target)
  updateSlashMenu(target.value)
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = Math.min(180, el.scrollHeight) + 'px'
}

/** 判断当前光标是否位于一个 / 斜杠命令输入中，并提取 query。 */
function updateSlashMenu(value: string): void {
  const caret = textareaRef.value?.selectionStart ?? value.length
  const beforeCaret = value.slice(0, caret)
  const lastSlash = beforeCaret.lastIndexOf('/')
  const lineStart = Math.max(beforeCaret.lastIndexOf('\n'), beforeCaret.lastIndexOf('\r'))
  if (lastSlash > lineStart && beforeCaret.slice(lastSlash).length > 1) {
    const q = beforeCaret.slice(lastSlash + 1)
    if (!/\s/.test(q)) {
      slashQuery.value = q
      slashOpen.value = true
      slashActiveIdx.value = 0
      return
    }
  }
  slashOpen.value = false
}

function applySlashCommand(idx: number): void {
  const cmd = slashMatches.value[idx]
  if (!cmd || !textareaRef.value) return
  const value = props.modelValue
  const caret = textareaRef.value.selectionStart ?? value.length
  const beforeCaret = value.slice(0, caret)
  const lineStart = Math.max(beforeCaret.lastIndexOf('\n'), beforeCaret.lastIndexOf('\r'))
  const lastSlash = beforeCaret.lastIndexOf('/')
  // 把 /xxx 替换为模板，并附上 intentHint
  const prefix = beforeCaret.slice(0, lastSlash >= 0 ? lastSlash : caret)
  const afterCaret = value.slice(caret)
  const newValue = prefix + cmd.template + afterCaret
  emit('update:modelValue', newValue)
  slashOpen.value = false
  slashQuery.value = ''
  textareaRef.value.focus()
  const pos = (prefix + cmd.template).length
  textareaRef.value.setSelectionRange(pos, pos)
  autosize(textareaRef.value)
  pendingIntent.value = cmd.intentHint
}

function selectSlash(delta: number): void {
  const len = slashMatches.value.length
  if (len === 0) return
  slashActiveIdx.value = (slashActiveIdx.value + delta + len) % len
}

// 选中斜杠命令后要携带的 intentHint，随发送一并上抛
const pendingIntent = ref<string | null>(null)
function flushIntent(): string | undefined {
  const v = pendingIntent.value
  pendingIntent.value = null
  return v ?? undefined
}

function sendWithIntent(): void {
  emit('send', flushIntent())
}

// ── 本地文件拖拽上传 ──
const isDragOver = ref(false)
const ACCEPTED_TEXT_EXT = ['txt', 'md', 'markdown', 'mdown', 'mkd']

function isTextFile(file: File): boolean {
  const name = (file.name || '').toLowerCase()
  if (file.type && file.type.startsWith('text/')) return true
  const ext = name.split('.').pop() ?? ''
  return ACCEPTED_TEXT_EXT.includes(ext)
}

function handleDragEnter(event: DragEvent): void {
  event.preventDefault()
  if (props.isStreaming) return
  if (event.dataTransfer?.types?.includes('Files')) {
    isDragOver.value = true
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  if (props.isStreaming) return
  if (event.dataTransfer?.types?.includes('Files')) {
    isDragOver.value = true
  }
}

function handleDragLeave(event: DragEvent): void {
  event.preventDefault()
  const related = event.relatedTarget as Node | null
  const wrap = textareaRef.value?.closest('.composer-wrap')
  if (wrap && related && wrap.contains(related)) return
  isDragOver.value = false
}

function handleDrop(event: DragEvent): void {
  event.preventDefault()
  isDragOver.value = false
  if (props.isStreaming) return
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length === 0) return
  const textFiles = files.filter(isTextFile)
  if (textFiles.length === 0) return
  emit('upload-files', textFiles)
}

function handleKeydown(event: KeyboardEvent) {
  // 斜杠菜单打开时的导航
  if (slashOpen.value && slashMatches.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      selectSlash(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      selectSlash(-1)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      applySlashCommand(slashActiveIdx.value)
      return
    }
    if (event.key === 'Escape') {
      slashOpen.value = false
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      applySlashCommand(slashActiveIdx.value)
      return
    }
  }
  // Escape 双击编辑上一轮（上游新增）
  if (event.key === 'Escape' && !props.isStreaming && !props.isEditing) {
    const now = Date.now()
    if (now - lastEscapeAt <= 600) {
      lastEscapeAt = 0
      event.preventDefault()
      emit('edit-last')
    } else {
      lastEscapeAt = now
    }
    return
  }
  lastEscapeAt = 0
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (props.isStreaming || props.isEditing) return
    sendWithIntent()
  }
}

watch(
  () => props.restoredLabel,
  async (label) => {
    if (!label) return
    await nextTick()
    if (!textareaRef.value) return
    textareaRef.value.focus()
    autosize(textareaRef.value)
  }
)
</script>

<template>
  <div
    class="composer-wrap"
    :class="{ 'drag-over': isDragOver }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div class="drag-overlay" v-if="isDragOver">
      <Upload :size="18" />
      松开以上传本地文本文件
    </div>
    <div class="composer" :class="{ streaming: props.isStreaming, editing: props.isEditing }">
      <div v-if="props.restoredLabel" class="restored-draft">
        <Undo2 :size="12" />
        <span>{{ props.restoredLabel }}</span>
        <button type="button" title="清除回填内容" aria-label="清除回填内容" @click="emit('clear-restored')">
          <X :size="11" />
        </button>
      </div>
      <!-- 斜杠命令菜单 -->
      <div v-if="slashOpen && slashMatches.length > 0" ref="slashMenuRef" class="slash-menu">
        <button
          v-for="(cmd, idx) in slashMatches"
          :key="cmd.key"
          type="button"
          class="slash-item"
          :class="{ active: idx === slashActiveIdx }"
          @mouseenter="slashActiveIdx = idx"
          @click="applySlashCommand(idx)"
        >
          <span class="slash-label">{{ cmd.label }}</span>
          <span class="slash-desc">{{ cmd.description }}</span>
        </button>
      </div>
      <textarea
        ref="textareaRef"
        :value="props.modelValue"
        :disabled="props.isEditing"
        :placeholder="props.isEditing ? '正在编辑历史提问' : '输入 / 唤起快捷指令 · Enter 发送 · Shift+Enter 换行'"
        @input="handleInput"
        @keydown="handleKeydown"
        @blur="slashOpen = false"
      />
      <div class="foot">
        <div class="hint">
          <span v-if="props.modeLabel" class="mode-chip">{{ props.modeLabel }}</span>
          <span v-if="props.isEditing">正在编辑历史提问</span>
          <span v-else-if="props.isStreaming" class="streaming-hint">
            <span class="streaming-dot" />AI 正在回答<template v-if="props.streamingCharCount && props.streamingCharCount > 0"> · 已生成 {{ props.streamingCharCount }} 字</template>
          </span>
        </div>
        <div class="actions">
          <NButton
            size="small"
            title="添加文件引用（当前章节）"
            quaternary
            :disabled="props.isStreaming"
            @click="emit('attach')"
          >
            <template #icon><Paperclip :size="13" /></template>
          </NButton>
          <NButton
            size="small"
            title="上传本地文件（txt/md）"
            quaternary
            :disabled="props.isStreaming"
            @click="emit('upload-file')"
          >
            <template #icon><Upload :size="13" /></template>
          </NButton>
          <NButton
            v-if="props.isStreaming"
            size="small"
            type="error"
            secondary
            :disabled="props.isCanceling"
            @click="emit('cancel')"
          >
            <template #icon><Square :size="13" fill="currentColor" /></template>
            {{ props.isCanceling ? '停止中' : '停止生成' }}
          </NButton>
          <NButton
            v-else
            size="small"
            type="primary"
            :disabled="props.isEditing || !props.modelValue.trim()"
            @click="sendWithIntent"
          >
            发送
          </NButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 斜杠命令菜单 ── */
.composer {
  position: relative;
}
.slash-menu {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(100% + 8px);
  z-index: 20;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--arc-border-strong);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-lg);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.slash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--arc-text-primary);
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
}
.slash-item.active {
  background: var(--arc-primary-soft);
}
.slash-label {
  font-family: var(--v2-mono);
  font-weight: 600;
  color: var(--arc-primary);
  flex: 0 0 auto;
  min-width: 84px;
}
.slash-desc {
  color: var(--arc-text-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-wrap {
  position: relative;
  padding: 12px 32px 22px;
  background: linear-gradient(180deg, transparent, var(--arc-bg-body) 30%);
}
.drag-overlay {
  position: absolute;
  inset: 4px 12px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed var(--arc-primary, #0ea5e9);
  border-radius: 14px;
  background: color-mix(in srgb, var(--arc-primary, #0ea5e9) 10%, var(--arc-bg-surface));
  color: var(--arc-primary, #0ea5e9);
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
}
.composer {
  max-width: 720px;
  margin: 0 auto;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  border-radius: 16px;
  padding: 12px 14px 10px;
  box-shadow: var(--arc-shadow-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}
.composer.streaming {
  border-color: rgba(13, 125, 90, 0.4);
  box-shadow: 0 0 0 3px rgba(13, 125, 90, 0.06), var(--arc-shadow-md);
}
.composer.editing {
  opacity: 0.56;
}
.restored-draft {
  align-self: flex-start;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-family: var(--v2-mono);
  font-size: 10.5px;
}
.restored-draft span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.restored-draft button {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.restored-draft button:hover {
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
}
textarea {
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--arc-text-primary);
  min-height: 40px;
  max-height: 180px;
  line-height: 1.5;
  padding: 0;
  font-size: 14px;
}
textarea:disabled {
  cursor: not-allowed;
}
textarea::placeholder {
  color: var(--arc-text-hint);
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hint {
  font-size: 11.5px;
  color: var(--arc-text-hint);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.mode-chip {
  flex: 0 1 auto;
  max-width: 160px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
}
.hint > span:not(.mode-chip):not(.streaming-hint) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}
.streaming-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--arc-primary);
  font-weight: 500;
}
.streaming-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--arc-primary);
  animation: streamPulse 1.4s ease-in-out infinite;
}
@keyframes streamPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.actions {
  display: flex;
  gap: 6px;
}
</style>
