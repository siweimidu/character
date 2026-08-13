<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import { Bookmark, Paperclip, Plus, Square, Trash2, Undo2, Upload, X } from 'lucide-vue-next'
import type { TurnAttachment } from '@shared/assistant-runtime'
import PromptLibrary from './PromptLibrary.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  isStreaming: boolean
  isCanceling?: boolean
  modeLabel?: string
  streamingCharCount?: number
  isEditing?: boolean
  restoredLabel?: string
  /** 待发送的引用附件芯片列表 */
  attachments?: TurnAttachment[]
  /** 可被 / 快捷指令选择的 skills（命令菜单第二类） */
  skills?: Array<{ id: string; name: string; description?: string }>
  /** 项目 ID：用于斜杠唤起提示词库（按项目隔离持久化）。 */
  projectId?: string | null | undefined
}>(), {
  projectId: undefined
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send', intentHint?: string): void
  (e: 'attach'): void
  (e: 'apply-skill', skill: { id: string; label: string }): void
  (e: 'remove-attachment', refKey: string): void
  (e: 'add-reference', ref: { kind: 'chapter' | 'volume' | 'skill'; id: string; label: string }): void
  (e: 'upload-file'): void
  (e: 'upload-files', files: File[]): void
  (e: 'add-file', file: { name: string; content: string; mime: string; size: number }): void
  (e: 'cancel'): void
  (e: 'edit-last'): void
  (e: 'clear-restored'): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
let lastEscapeAt = 0

/** 斜杠命令快捷指令：输入框内以 / 触发，选中后填充模板并附带 intentHint。 */
interface SlashCommandDef {
  key: string
  label: string
  description: string
  template: string
  intentHint: string
  /** 是否内置命令；内置命令不可删除。 */
  builtin?: boolean
}
const BUILTIN_COMMANDS: SlashCommandDef[] = [
  { key: 'plan', label: '/plan', description: '规划模式：先产出分步计划，确认后执行', template: '/plan 请先产出本任务的分步执行计划（需求概述、涉及文件清单、分步任务、风险点、验证方案），等待我确认后再按顺序执行。', intentHint: 'global-assistant-v2:plan', builtin: true },
  { key: 'spec', label: '/spec', description: '规格模式：大型重构/系统搭建，先出规格文档', template: '/spec 请先产出三份规格文档（spec.md 需求规格说明书、tasks.md 任务清单、checklist.md 交付验收清单），确认定稿后再落地开发。', intentHint: 'global-assistant-v2:spec', builtin: true },
  { key: 'goal', label: '/goal', description: '目标自主模式：设定验收标准后自主循环执行', template: '/goal 我的目标如下：\n【最终目标】\n【验收标准】\n【限制条件】\n请自主拆解任务并持续执行，直到达成全部验收标准后输出交付总结。', intentHint: 'global-assistant-v2:goal', builtin: true },
  { key: 'audit', label: '/audit', description: '全书审计：矛盾、OOC、伏笔', template: '请审计当前项目的一致性风险，包括世界观矛盾、人物 OOC、大纲断裂、伏笔未回收和硬约束冲突。', intentHint: 'slash:audit', builtin: true },
  { key: 'fix', label: '/fix', description: '修正一致性', template: '请检查项目里可能跑偏或重复的设定，并把需要修正的内容产出为可暂存的修正方案。', intentHint: 'slash:fix', builtin: true },
  { key: 'ingest', label: '/ingest', description: '录入设定草稿', template: '我会给你一段设定草稿，请拆成可写入的世界观、人物、组织、大纲或创作记忆暂存变更。', intentHint: 'slash:ingest', builtin: true },
  { key: 'summarize', label: '/summarize', description: '章节摘要', template: '请读取最近章节并生成摘要，补全章节创作记忆。', intentHint: 'slash:summarize', builtin: true },
  { key: 'continuation', label: '/continuation', description: '续写', template: '请基于当前章节进度和项目设定，续写后续内容。', intentHint: 'slash:continuation', builtin: true }
]

const CUSTOM_COMMAND_KEY = 'arc-assistant-custom-commands'
/** 用户自定义命令（localStorage 持久化，可新增、可删除）。 */
const customCommands = ref<SlashCommandDef[]>([])
function loadCustomCommands(): void {
  try {
    const raw = window.localStorage.getItem(CUSTOM_COMMAND_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SlashCommandDef[]
      if (Array.isArray(parsed)) {
        customCommands.value = parsed
          .filter((c) => c && typeof c.key === 'string' && typeof c.label === 'string')
          .map((c) => ({ ...c, builtin: false }))
      }
    }
  } catch {
    // 忽略损坏的本地数据
  }
}
function persistCustomCommands(): void {
  try {
    window.localStorage.setItem(CUSTOM_COMMAND_KEY, JSON.stringify(customCommands.value))
  } catch {
    // ignore
  }
}
/** 全部命令 = 内置 + 自定义。 */
const allCommands = computed<SlashCommandDef[]>(() => [...BUILTIN_COMMANDS, ...customCommands.value])
/** 添加用户自定义命令。 */
function addCustomCommand(def: Omit<SlashCommandDef, 'builtin'>): void {
  if (!def.key || !def.label) return
  if (BUILTIN_COMMANDS.some((b) => b.key === def.key) || customCommands.value.some((c) => c.key === def.key)) {
    return
  }
  customCommands.value = [...customCommands.value, { ...def, builtin: false }]
  persistCustomCommands()
}
/** 删除用户自定义命令。 */
function removeCustomCommand(key: string): void {
  customCommands.value = customCommands.value.filter((c) => c.key !== key)
  persistCustomCommands()
}
loadCustomCommands()

// ── 新建命令弹窗 ──
const addCommandVisible = ref(false)
const addCommandForm = ref({ key: '', label: '', description: '', template: '' })
function openAddCommand(): void {
  addCommandForm.value = { key: '', label: '', description: '', template: '' }
  addCommandVisible.value = true
}
function submitAddCommand(): void {
  const key = addCommandForm.value.key.trim()
  const label = addCommandForm.value.label.trim()
  const template = addCommandForm.value.template.trim()
  if (!key) return
  addCustomCommand({
    key,
    label: label || `/${key}`,
    description: addCommandForm.value.description.trim() || '自定义命令',
    template: template || label || key,
    intentHint: `slash:custom:${key}`
  })
  addCommandVisible.value = false
  // 新建后切到命令栏并聚焦，方便立即使用
  switchSlashTab('command')
  if (textareaRef.value) textareaRef.value.focus()
}

// 斜杠命令弹层状态
const slashQuery = ref('')
const slashOpen = ref(false)
const slashActiveIdx = ref(0)
const slashMenuRef = ref<HTMLDivElement | null>(null)
/** 斜杠弹窗当前选中栏：'command' 命令 / 'skill' Skills */
const slashTab = ref<'command' | 'skill'>('command')

/** 两栏各维持一个高亮索引，切换栏时不互相干扰 */
const slashIdxByTab = { command: ref(0), skill: ref(0) }


/** 统一把「命令」和「Skills」合并为一个可滑动选择的列表，供键盘/鼠标操作。 */
type SlashEntry =
  | { kind: 'command'; key: string; label: string; description: string; template: string; intentHint: string; builtin?: boolean }
  | { kind: 'promptlib'; key: string; label: string; description: string }
  | { kind: 'skill'; id: string; label: string; name: string; description: string }

/** 提示词库入口：始终位于斜杠命令首位，点击唤起提示词库管理弹窗。 */
const PROMPT_LIB_ENTRY: Extract<SlashEntry, { kind: 'promptlib' }> = {
  kind: 'promptlib',
  key: 'promptlib',
  label: '/prompts',
  description: '打开提示词库（选用/新建/编辑/删除）'
}

/** 提示词库管理弹窗开关。 */
const promptLibOpen = ref(false)

const slashCommandEntries = computed<Array<Extract<SlashEntry, { kind: 'command' } | { kind: 'promptlib' }>>>(() =>
  [PROMPT_LIB_ENTRY, ...allCommands.value.map((c) => ({ ...c, kind: 'command' as const }))]
)
const slashSkillEntries = computed<Array<Extract<SlashEntry, { kind: 'skill' }>>>(() =>
  (props.skills ?? []).map((s) => ({
    kind: 'skill',
    id: s.id,
    name: s.name,
    label: `/skill:${s.name}`, 
    description: s.description || '绑定智能体技能'
  }))
)

/** 分组展示：命令 | Skills */
const slashGroups = computed(() => {
  const q = slashQuery.value.trim().toLowerCase()
  const match = (label: string, key: string) => {
    if (!q) return true
    return label.toLowerCase().includes(q) || key.toLowerCase().includes(q)
  }
  const commands = slashCommandEntries.value.filter((c) => match(c.label, c.key))
  const skills = slashSkillEntries.value.filter((s) => match(s.label, s.id))
  const groups: Array<{ title: string; items: SlashEntry[] }> = []
  if (commands.length) groups.push({ title: '命令', items: commands })
  if (skills.length) groups.push({ title: 'Skills', items: skills })
  return groups
})

const slashMatches = computed<SlashEntry[]>(() =>
  slashGroups.value.find((g) => (g.title === '命令') === (slashTab.value === 'command'))?.items ?? []
)

function slashEntryKey(e: SlashEntry): string {
  if (e.kind === 'command') return `cmd:${e.key}`
  if (e.kind === 'promptlib') return 'cmd:promptlib'
  return `skill:${e.id}`
}

/** 把「组内索引」映射为整个列表的平铺索引，用于键盘/鼠标高亮对齐。 */
function slashFlatIndex(groupIdx: number, itemIdx: number): number {
  let offset = 0
  for (let i = 0; i < groupIdx; i++) offset += slashGroups.value[i]?.items.length ?? 0
  return offset + itemIdx
}

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

/** 切换斜杠弹窗栏位（命令 / Skills），并复位该栏的高亮。 */
function switchSlashTab(tab: 'command' | 'skill'): void {
  slashTab.value = tab
  slashActiveIdx.value = 0
  slashIdxByTab[tab].value = 0
}

/** 判断当前光标是否位于一个 / 斜杠命令输入中，并提取 query。 */
function updateSlashMenu(value: string): void {
  const caret = textareaRef.value?.selectionStart ?? value.length
  const beforeCaret = value.slice(0, caret)
  const lastSlash = beforeCaret.lastIndexOf('/')
  const lineStart = Math.max(beforeCaret.lastIndexOf('\n'), beforeCaret.lastIndexOf('\r'))
  if (lastSlash >= 0 && lastSlash >= lineStart && beforeCaret.slice(lastSlash).length >= 1) {
    const q = beforeCaret.slice(lastSlash + 1)
    if (!/\s/.test(q)) {
      slashQuery.value = q
      slashOpen.value = true
      slashActiveIdx.value = 0
      slashIdxByTab[slashTab.value].value = 0
      return
    }
  }
  slashOpen.value = false
}

function applySlashCommand(idx: number): void {
  const entry = slashMatches.value[idx]
  if (!entry || !textareaRef.value) return
  const value = props.modelValue
  const caret = textareaRef.value.selectionStart ?? value.length
  const beforeCaret = value.slice(0, caret)
  const lineStart = Math.max(beforeCaret.lastIndexOf('\n'), beforeCaret.lastIndexOf('\r'))
  const lastSlash = beforeCaret.lastIndexOf('/')
  // 把光标处的 /xxx 清掉
  const prefix = beforeCaret.slice(0, lastSlash >= 0 ? lastSlash : caret)
  const afterCaret = value.slice(caret)

  if (entry.kind === 'command') {
    const newValue = prefix + entry.template + afterCaret
    emit('update:modelValue', newValue)
    slashOpen.value = false
    slashQuery.value = ''
    textareaRef.value.focus()
    const pos = (prefix + entry.template).length
    textareaRef.value.setSelectionRange(pos, pos)
    autosize(textareaRef.value)
    pendingIntent.value = entry.intentHint
  } else if (entry.kind === 'promptlib') {
    // 提示词库：移除 / 输入，弹出管理弹窗
    const newValue = prefix + afterCaret
    emit('update:modelValue', newValue)
    slashOpen.value = false
    slashQuery.value = ''
    textareaRef.value.focus()
    const pos = prefix.length
    textareaRef.value.setSelectionRange(pos, pos)
    autosize(textareaRef.value)
    promptLibOpen.value = true
  } else {
    // skill：作为引用芯片加入待发送附件，移除 / 输入
    const newValue = prefix + afterCaret
    emit('update:modelValue', newValue)
    slashOpen.value = false
    slashQuery.value = ''
    emit('apply-skill', { id: entry.id, label: entry.name })
    textareaRef.value.focus()
    const pos = prefix.length
    textareaRef.value.setSelectionRange(pos, pos)
    autosize(textareaRef.value)
  }
}

/** 提示词库选中回调：把提示词内容回填到输入框。 */
function usePromptFromLibrary(prompt: string): void {
  if (!textareaRef.value) return
  const value = props.modelValue
  const caret = textareaRef.value.selectionStart ?? value.length
  const before = value.slice(0, caret)
  const after = value.slice(caret)
  const newValue = before + prompt + after
  emit('update:modelValue', newValue)
  textareaRef.value.focus()
  const pos = (before + prompt).length
  textareaRef.value.setSelectionRange(pos, pos)
  autosize(textareaRef.value)
}

function selectSlash(delta: number): void {
  const list = slashMatches.value
  if (list.length === 0) return
  slashActiveIdx.value = (slashActiveIdx.value + delta + list.length) % list.length
  slashIdxByTab[slashTab.value].value = slashActiveIdx.value
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

/** 通过原生隐藏 input 选择本地文本文件，作为 IPC 文件对话框的可靠回退 */
function triggerNativeFilePick(): void {
  if (props.isStreaming) return
  fileInputRef.value?.click()
}

function handleNativeFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length > 0) void addFilesAsAttachment(files)
  input.value = ''
}

/** 读取本地文件内容并作为「文件引用」加入待发送附件（以文件名按钮形式展示，而非整段文本输入）。 */
async function addFilesAsAttachment(files: File[]): Promise<void> {
  if (files.length === 0) return
  for (const file of files) {
    let content = ''
    const isTextLike =
      file.type.startsWith('text/') ||
      /\.(txt|md|markdown|mdown|mkd|json|js|ts|py|css|html|xml|csv|log|ya?ml|ini|sql|sh)$/i.test(file.name)
    if (isTextLike && file.size <= 2 * 1024 * 1024) {
      try {
        content = await file.text()
      } catch {
        content = ''
      }
    }
    emit('add-file', {
      name: file.name,
      content,
      mime: file.type || 'application/octet-stream',
      size: file.size
    })
  }
}

// ── 本地文件拖拽上传 + 章节/分卷引用拖拽 ──
const isDragOver = ref(false)
const ACCEPTED_TEXT_EXT = ['txt', 'md', 'markdown', 'mdown', 'mkd']

const ARC_REF_MIME = 'application/x-arc-ref'

function hasArcRef(event: DragEvent): boolean {
  return !!event.dataTransfer?.types?.includes(ARC_REF_MIME)
}

function handleDragEnter(event: DragEvent): void {
  event.preventDefault()
  if (props.isStreaming) return
  if (event.dataTransfer?.types?.includes('Files') || hasArcRef(event)) {
    isDragOver.value = true
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  if (props.isStreaming) return
  if (event.dataTransfer?.types?.includes('Files') || hasArcRef(event)) {
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

  // 章节/分卷引用拖拽：解析自定义 MIME，加入待发送附件芯片
  if (hasArcRef(event)) {
    try {
      const raw = event.dataTransfer?.getData(ARC_REF_MIME) ?? ''
      const ref = JSON.parse(raw) as { kind: 'chapter' | 'volume' | 'skill'; id: string; label: string }
      if (ref && ref.id) {
        emit('add-reference', ref)
      }
    } catch {
      // 忽略无法解析的拖拽数据
    }
    return
  }

  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length === 0) return
  void addFilesAsAttachment(files)
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
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      // 左右切换「命令 / Skills」两栏。
      const tabs: Array<'command' | 'skill'> = ['command', 'skill']
      const cur = tabs.indexOf(slashTab.value)
      switchSlashTab(tabs[(cur + 1) % tabs.length])
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
      // Tab 切换栏位，Shift+Tab 也切换（同向），避免与“应用命令”冲突。
      const tabs: Array<'command' | 'skill'> = ['command', 'skill']
      const cur = tabs.indexOf(slashTab.value)
      switchSlashTab(tabs[(cur + 1) % tabs.length])
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

/** 点击斜杠菜单项时用 mousedown 触发，避免 blur 先关闭菜单导致点击失效。 */
function onSlashItemMouseDown(e: MouseEvent, idx: number): void {
  e.preventDefault()
  applySlashCommand(idx)
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
      松开以上传本地文件
    </div>
    <input
      ref="fileInputRef"
      type="file"
      multiple
      class="native-file-input"
      @change="handleNativeFileChange"
    />
    <div class="composer" :class="{ streaming: props.isStreaming, editing: props.isEditing }">
      <div v-if="props.restoredLabel" class="restored-draft">
        <Undo2 :size="12" />
        <span>{{ props.restoredLabel }}</span>
        <button type="button" title="清除回填内容" aria-label="清除回填内容" @click="emit('clear-restored')">
          <X :size="11" />
        </button>
      </div>
      <!-- 待发送的引用附件芯片（章节/分卷/Skill），可单独叉掉 -->
      <div v-if="props.attachments && props.attachments.length > 0" class="attach-chips">
        <span
          v-for="att in props.attachments"
          :key="`${att.kind}:${att.ref}`"
          class="attach-chip"
        >
          <Paperclip :size="11" />
          <span class="attach-chip-label">{{ att.label }}</span>
          <button
            type="button"
            class="attach-chip-x"
            title="移除引用"
            aria-label="移除引用"
            @click="emit('remove-attachment', `${att.kind}:${att.ref}`)"
          >
            <X :size="11" />
          </button>
        </span>
      </div>
      <!-- 斜杠命令菜单（命令 | Skills 两栏，可切换、可上下滑动） -->
      <div v-if="slashOpen && slashMatches.length > 0" ref="slashMenuRef" class="slash-menu">
        <div class="slash-tabs">
          <button
            type="button"
            class="slash-tab"
            :class="{ active: slashTab === 'command' }"
            @mousedown.prevent="switchSlashTab('command')"
          >
            命令
            <span v-if="slashCommandEntries.length" class="slash-tab-count">{{ slashCommandEntries.length }}</span>
          </button>
          <button
            type="button"
            class="slash-tab"
            :class="{ active: slashTab === 'skill' }"
            @mousedown.prevent="switchSlashTab('skill')"
          >
            Skills
            <span v-if="slashSkillEntries.length" class="slash-tab-count">{{ slashSkillEntries.length }}</span>
          </button>
        </div>
        <div class="slash-col">
          <div v-if="slashTab === 'command'" class="slash-items">
            <template v-if="slashCommandEntries.length">
              <div class="slash-head-row">
                <div class="slash-group-title">命令</div>
                <button type="button" class="slash-add" title="新建命令" @mousedown.prevent="openAddCommand">
                  <Plus :size="12" /> 新建
                </button>
              </div>
              <button
                v-for="(entry, ei) in slashCommandEntries"
                :key="slashEntryKey(entry)"
                type="button"
                class="slash-item"
                :class="{ active: ei === slashActiveIdx, 'slash-item-promptlib': entry.kind === 'promptlib' }"
                @mousedown.prevent="onSlashItemMouseDown($event, ei)"
                @mouseenter="slashActiveIdx = ei"
              >
                <Bookmark v-if="entry.kind === 'promptlib'" :size="13" class="slash-promptlib-icon" />
                <span class="slash-label">{{ entry.label }}</span>
                <span class="slash-desc">{{ entry.description }}</span>
                <button
                  v-if="entry.kind === 'command' && !entry.builtin"
                  type="button"
                  class="slash-del"
                  title="删除命令"
                  @mousedown.stop="removeCustomCommand(entry.key)"
                >
                  <Trash2 :size="12" />
                </button>
              </button>
            </template>
            <div v-else class="slash-empty">
              没有命令
              <button type="button" class="slash-add" @mousedown.prevent="openAddCommand"><Plus :size="12" /> 新建命令</button>
            </div>
          </div>
          <div v-else class="slash-items">
            <template v-if="slashSkillEntries.length">
              <div class="slash-group-title">Skills</div>
              <button
                v-for="(entry, ei) in slashSkillEntries"
                :key="slashEntryKey(entry)"
                type="button"
                class="slash-item"
                :class="{ active: ei === slashActiveIdx }"
                @mousedown.prevent="onSlashItemMouseDown($event, ei)"
                @mouseenter="slashActiveIdx = ei"
              >
                <span class="slash-label">{{ entry.label }}</span>
                <span class="slash-desc">{{ entry.description }}</span>
              </button>
            </template>
            <div v-else class="slash-empty">没有匹配的 Skills</div>
          </div>
        </div>
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
            title="上传本地文件（支持所有格式）"
            quaternary
            :disabled="props.isStreaming"
            @click="triggerNativeFilePick"
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
      <!-- 新建命令弹窗 -->
      <div v-if="addCommandVisible" class="add-cmd-overlay" @mousedown.self="addCommandVisible = false">
        <div class="add-cmd-dialog">
          <div class="add-cmd-title">新建命令</div>
          <label class="add-cmd-field">
            <span>命令标识（如 audit）</span>
            <input v-model="addCommandForm.key" placeholder="audit" @keydown.enter="submitAddCommand" />
          </label>
          <label class="add-cmd-field">
            <span>显示名称（可选，默认 /标识）</span>
            <input v-model="addCommandForm.label" placeholder="全书审计" @keydown.enter="submitAddCommand" />
          </label>
          <label class="add-cmd-field">
            <span>说明</span>
            <input v-model="addCommandForm.description" placeholder="简要描述该命令的作用" @keydown.enter="submitAddCommand" />
          </label>
          <label class="add-cmd-field">
            <span>触发提示词（发送给智能体的内容）</span>
            <textarea v-model="addCommandForm.template" rows="3" placeholder="请告诉我这个命令要让智能体做什么…" />
          </label>
          <div class="add-cmd-actions">
            <button type="button" class="add-cmd-btn" @click="addCommandVisible = false">取消</button>
            <button
              type="button"
              class="add-cmd-btn primary"
              :disabled="!addCommandForm.key.trim()"
              @click="submitAddCommand"
            >
              保存命令
            </button>
          </div>
        </div>
      </div>
      <PromptLibrary
        v-model:open="promptLibOpen"
        :project-id="props.projectId"
        :on-use="usePromptFromLibrary"
      />
    </div>
  </div>
</template>

<style scoped>
/* ── 斜杠命令菜单 ── */
.composer {
  position: relative;
}
.attach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 4px 3px 8px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 12px;
}
.attach-chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attach-chip-x {
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
.attach-chip-x:hover {
  background: color-mix(in srgb, var(--arc-primary) 14%, transparent);
}
.slash-group-title {
  padding: 5px 10px 3px;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--arc-text-hint);
  font-family: var(--v2-mono);
}
.slash-menu {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(100% + 8px);
  z-index: 20;
  max-height: 320px;
  border: 1px solid var(--arc-border-strong);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.slash-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--arc-border);
  background: color-mix(in srgb, var(--arc-bg-surface) 92%, var(--arc-bg-body));
}
.slash-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-radius: 6px;
  padding: 5px 10px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.slash-tab.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}
.slash-tab-count {
  font-family: var(--v2-mono);
  font-size: 10.5px;
  color: var(--arc-text-hint);
}
.slash-col {
  min-height: 0;
  overflow-y: auto;
  max-height: 240px;
}
.slash-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}
.slash-empty {
  padding: 14px 12px;
  font-size: 12px;
  color: var(--arc-text-hint);
  text-align: center;
}
.slash-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 4px;
}
.slash-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: 6px;
  padding: 2px 8px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.slash-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  margin-left: auto;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
}
.slash-del:hover {
  background: var(--v2-del-bg, rgba(185, 28, 28, 0.1));
  color: var(--v2-del, #b91c1c);
}
.add-cmd-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
}
.add-cmd-dialog {
  width: min(420px, calc(100vw - 48px));
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  border-radius: 12px;
  box-shadow: var(--arc-shadow-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.add-cmd-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--arc-text-primary);
}
.add-cmd-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.add-cmd-field span {
  font-size: 12px;
  color: var(--arc-text-secondary);
}
.add-cmd-field input,
.add-cmd-field textarea {
  width: 100%;
  border: 1px solid var(--arc-border-strong);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font: inherit;
  font-size: 13px;
  resize: vertical;
}
.add-cmd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.add-cmd-btn {
  border: 1px solid var(--arc-border-strong);
  border-radius: 8px;
  padding: 6px 14px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  font-size: 13px;
  cursor: pointer;
}
.add-cmd-btn.primary {
  background: var(--arc-primary);
  border-color: var(--arc-primary);
  color: #fff;
}
.add-cmd-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
.slash-item-promptlib {
  border: 1px solid color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 8%, transparent);
  margin-bottom: 4px;
}
.slash-item-promptlib.active {
  background: var(--arc-primary-soft);
}
.slash-promptlib-icon {
  color: var(--arc-primary);
  flex: 0 0 auto;
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
.native-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
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
