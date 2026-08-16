<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import {
  Bookmark,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Mic,
  Paperclip,
  Plus,
  Search,
  Square,
  Trash2,
  Undo2,
  Upload,
  X
} from 'lucide-vue-next'
import type { TurnAttachment } from '@shared/assistant-runtime'
import type { AgentModuleRuntime } from '@shared/agent-modules'
import PromptLibrary from './PromptLibrary.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  isStreaming: boolean
  isCanceling?: boolean
  modeLabel?: string
  streamingCharCount?: number
  isEditing?: boolean
  restoredLabel?: string
  /** 撤回/回退后需要恢复的模式意图（含自增序号，保证每次撤回都能 watch 到）。 */
  restoredIntent?: { intent: string; nonce: number } | null
  /** 待发送的引用附件芯片列表 */
  attachments?: TurnAttachment[]
  /** 可被 / 快捷指令选择的 skills（命令菜单第二类） */
  skills?: Array<{ id: string; name: string; description?: string; category?: string; scope?: 'builtin' | 'project' }>
  /** 项目 ID：用于斜杠唤起提示词库（按项目隔离持久化）。 */
  projectId?: string | null | undefined
  /** 已启用的能力模块列表（用于展示能力快捷按钮） */
  enabledModules?: AgentModuleRuntime[]
  /** 是否正在录音（语音转文字），用于按钮跳动动画 */
  speechListening?: boolean
}>(), {
  projectId: undefined,
  enabledModules: () => [],
  speechListening: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send', intentHint?: string): void
  (e: 'attach'): void
  (e: 'apply-skill', skill: { id: string; label: string }): void
  (e: 'remove-attachment', refKey: string): void
  (e: 'add-reference', ref: { kind: 'chapter' | 'volume' | 'skill'; id: string; label: string }): void
  /** 添加资源区（文件/文件夹）引用。path 为相对资源根目录的路径。 */
  (e: 'add-resource', ref: { kind: 'resource' | 'resource-dir'; path: string; label: string }): void
  (e: 'upload-file'): void
  (e: 'upload-files', files: File[]): void
  (e: 'add-file', file: { name: string; content: string; mime: string; size: number; path?: string }): void
  /** 后台加载/保存完成后，回填某个已展示的附件芯片的 content / path 等字段。 */
  (e: 'update-file', refKey: string, patch: { content?: string; path?: string; size?: number }): void
  (e: 'cancel'): void
  (e: 'edit-last'): void
  (e: 'clear-restored'): void
  /** 点击语音按钮 */
  (e: 'voice-input'): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const chipsRef = ref<HTMLDivElement | null>(null)
let lastEscapeAt = 0
/**
 * 中文输入法（IME）组合输入进行中的标记。
 * 部分浏览器在“用回车确认候选字”的那一刻 event.isComposing 已为 false，
 * 若仅依赖它判断，回车会被下方拦截发送逻辑 preventDefault，导致候选字无法上屏、
 * 输入文字“有概率失败”。故用 compositionstart/end 手动跟踪，保证确认候选字的回车不被拦截。
 */
let imeComposing = false

/** 是否有语音转文字能力。 */
const hasSpeech = computed(() =>
  (props.enabledModules ?? []).some((m) => m.kind === 'speech' && m.enabled)
)

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
  { key: 'goal', label: '/goal', description: '目标模式：以最终验收目标为导向自主执行并自检闭环', template: 'goal', intentHint: 'global-assistant-v2:goal', builtin: true },
  { key: 'plan', label: '/plan', description: '计划模式：先输出分步执行计划，确认后再逐步落地', template: 'plan', intentHint: 'global-assistant-v2:plan', builtin: true },
  { key: 'spec', label: '/spec', description: '规范模式：输出 spec/tasks/checklist 三份规格文档', template: 'spec', intentHint: 'global-assistant-v2:spec', builtin: true },
  { key: 'standard', label: '/standard', description: '标准模式：常规对话与创作协助', template: 'standard', intentHint: 'global-assistant-v2:standard', builtin: true },
  { key: 'ptc', label: '/ptc', description: 'PTC 模式：规划-任务-执行的结构化流程', template: 'ptc', intentHint: 'global-assistant-v2:ptc', builtin: true },
  { key: 'minimal', label: '/minimal', description: '极简模式：精简输出、直击要点', template: 'minimal', intentHint: 'global-assistant-v2:minimal', builtin: true },
  { key: 'creative', label: '/creative', description: '创造模式：激发灵感，自由创作', template: 'creative', intentHint: 'global-assistant-v2:creative', builtin: true },
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
/** 打开新建命令弹窗前，斜杠命令/skill 悬浮窗是否处于展开状态。
 *  用于点击「取消」后把悬浮窗重新展开，避免丢失正在编辑的命令上下文。 */
let slashOpenBeforeAdd = false
function openAddCommand(): void {
  addCommandForm.value = { key: '', label: '', description: '', template: '' }
  slashOpenBeforeAdd = slashOpen.value
  addCommandVisible.value = true
}
/** 取消新建命令：关闭弹窗，并恢复斜杠命令/skill 悬浮窗（若打开前是展开的）。 */
function closeAddCommand(): void {
  addCommandVisible.value = false
  if (slashOpenBeforeAdd) {
    slashOpen.value = true
    if (textareaRef.value) textareaRef.value.focus()
  }
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

/** Skills 栏内的独立搜索关键词（区别于触发 / 弹窗的 slashQuery）。 */
const skillSearchQuery = ref('')
/** Skills 栏中已折叠的分组标题集合。 */
const collapsedSkillGroups = reactive<Record<string, boolean>>({})
function toggleSkillGroup(title: string): void {
  collapsedSkillGroups[title] = !collapsedSkillGroups[title]
}


/** 统一把「命令」和「Skills」合并为一个可滑动选择的列表，供键盘/鼠标操作。 */
type SlashEntry =
  | { kind: 'command'; key: string; label: string; description: string; template: string; intentHint: string; builtin?: boolean }
  | { kind: 'promptlib'; key: string; label: string; description: string }
  | { kind: 'skill'; id: string; label: string; name: string; description: string; category?: string; scope?: 'builtin' | 'project' }

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
    description: s.description || '绑定智能体技能',
    category: s.category,
    scope: s.scope
  }))
)

/** 技能分类的中文名称映射。 */
const SKILL_CATEGORY_LABELS: Record<string, string> = {
  market: '市场与获取',
  analysis: '分析',
  writing: '写作',
  polish: '打磨润色',
  cover: '封面',
  tool: '工具'
}
function skillCategoryLabel(category?: string): string {
  return (category && SKILL_CATEGORY_LABELS[category]) || '其他'
}

/** 分组展示：命令 | Skills（Skills 按分类进一步分组） */
const slashGroups = computed(() => {
  const q = slashQuery.value.trim().toLowerCase()
  const match = (label: string, key: string) => {
    if (!q) return true
    return label.toLowerCase().includes(q) || key.toLowerCase().includes(q)
  }
  const commands = slashCommandEntries.value.filter((c) => match(c.label, c.key))
  // Skills 栏内还支持在弹层中额外搜索（skillSearchQuery），两者取并集生效。
  const skillQ = skillSearchQuery.value.trim().toLowerCase()
  const skills = slashSkillEntries.value.filter((s) => {
    if (!match(s.label, s.id)) return false
    if (!skillQ) return true
    const name = (s.name ?? '').toLowerCase()
    const desc = (s.description ?? '').toLowerCase()
    const cat = skillCategoryLabel(s.category).toLowerCase()
    return name.includes(skillQ) || desc.includes(skillQ) || cat.includes(skillQ)
  })
  const groups: Array<{ title: string; items: SlashEntry[] }> = []
  if (commands.length) groups.push({ title: '命令', items: commands })
  if (skills.length) {
    // 将 skills 先按「来源范围」分组展示：内置 Skills / 项目扩展 Skills
    const builtin: Extract<SlashEntry, { kind: 'skill' }>[] = []
    const project: Extract<SlashEntry, { kind: 'skill' }>[] = []
    for (const s of skills) {
      if (s.scope === 'builtin') builtin.push(s)
      else project.push(s)
    }
    const pushScopeGroup = (title: string, list: Extract<SlashEntry, { kind: 'skill' }>[]) => {
      if (list.length === 0) return
      // 组内按分类二次分组，让来源分组内层级更清晰
      const byCat = new Map<string, Extract<SlashEntry, { kind: 'skill' }>[]>()
      for (const s of list) {
        const cat = skillCategoryLabel(s.category)
        if (!byCat.has(cat)) byCat.set(cat, [])
        byCat.get(cat)!.push(s)
      }
      for (const [cat, items] of byCat) {
        groups.push({ title: `${title} · ${cat}`, items })
      }
    }
    pushScopeGroup('内置 Skills', builtin)
    pushScopeGroup('项目扩展 Skills', project)
  }
  return groups
})

const slashMatches = computed<SlashEntry[]>(() => {
  const activeTabIsCommand = slashTab.value === 'command'
  const activeGroups = slashGroups.value.filter((g) => (g.title === '命令') === activeTabIsCommand)
  return activeGroups.flatMap((g) => g.items)
})

/** Skills 栏的分组列表，每项附带其在 slashMatches 中的平铺索引（用于高亮对齐）与折叠状态。 */
const slashSkillGroupsRendered = computed<Array<{ title: string; count: number; collapsed: boolean; items: Array<{ entry: SlashEntry; index: number }> }>>(() => {
  const groups: Array<{ title: string; count: number; collapsed: boolean; items: Array<{ entry: SlashEntry; index: number }> }> = []
  let offset = 0
  for (const g of slashGroups.value) {
    if (g.title === '命令') continue
    const mapped = g.items.map((entry) => ({ entry, index: offset++ }))
    groups.push({
      title: g.title,
      count: g.items.length,
      collapsed: !!collapsedSkillGroups[g.title],
      items: mapped
    })
  }
  return groups
})

/** Skills 栏命中总数（用于顶部显示与空态判断）。 */
const slashSkillMatchCount = computed(() =>
  slashSkillGroupsRendered.value.reduce((sum, g) => sum + g.items.length, 0)
)
/** 是否有分组处于折叠状态（用于“全部展开”按钮态）。 */
const hasCollapsedSkillGroup = computed(() =>
  slashSkillGroupsRendered.value.some((g) => g.collapsed)
)
/** 全部展开 / 全部折叠。 */
function toggleAllSkillGroups(): void {
  const anyCollapsed = slashSkillGroupsRendered.value.some((g) => g.collapsed)
  for (const g of slashSkillGroupsRendered.value) {
    collapsedSkillGroups[g.title] = anyCollapsed ? false : true
  }
}

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

/** 中文输入法开始组合输入。 */
function handleCompositionStart(): void {
  imeComposing = true
}

/** 中文输入法结束组合输入。 */
function handleCompositionEnd(): void {
  imeComposing = false
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
  // 切出 Skills 栏时清空其内部搜索，避免残留过滤条件影响下次查看。
  if (tab !== 'skill') {
    skillSearchQuery.value = ''
  }
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
    // 内置模式命令（/plan /spec /goal）：不往输入框里塞冗长模板文本，
    // 而是以一个「模式芯片」标示当前已选中的模式，用户只需描述自己的任务即可。
    if (entry.builtin && entry.intentHint.startsWith('global-assistant-v2:')) {
      const newValue = prefix + afterCaret
      emit('update:modelValue', newValue)
      slashOpen.value = false
      slashQuery.value = ''
      textareaRef.value.focus()
      const pos = prefix.length
      textareaRef.value.setSelectionRange(pos, pos)
      autosize(textareaRef.value)
      selectedMode.value = { key: entry.key, label: entry.label, intentHint: entry.intentHint }
      pendingIntent.value = entry.intentHint
      return
    }
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
/** 当前已选中的「模式」芯片（/plan /spec /goal），仅作视觉标示，不写入输入框。 */
const selectedMode = ref<{ key: string; label: string; intentHint: string } | null>(null)
function flushIntent(): string | undefined {
  const v = pendingIntent.value
  pendingIntent.value = null
  return v ?? undefined
}
/** 移除已选中的模式芯片：同时清空意图，发送时回落默认 chat。 */
function clearMode(): void {
  selectedMode.value = null
  if (pendingIntent.value?.startsWith('global-assistant-v2:')) pendingIntent.value = null
}

function sendWithIntent(): void {
  const intent = flushIntent()
  // 发送后复位已选中的模式芯片，避免下一轮还残留旧模式标示
  if (selectedMode.value && intent?.startsWith('global-assistant-v2:')) {
    selectedMode.value = null
  }
  // 若有文件仍在后台读取/保存，先等它们完成，确保附件内容完整后再发送。
  void Promise.all(pendingFileLoads).then(() => {
    emit('send', intent)
  })
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

/** 正在后台读取/保存的本地文件任务，发送前需等待全部完成，确保附件内容完整。 */
let pendingFileLoads: Promise<void>[] = []

/** 是否应在后台读取为内联文本的本地文件（文本类且体积适中）。 */
function isInlineTextFile(file: File): boolean {
  return (
    file.type.startsWith('text/') ||
    /\.(txt|md|markdown|mdown|mkd|json|js|ts|py|css|html|xml|csv|log|ya?ml|ini|sql|sh)$/i.test(file.name)
  ) && file.size <= 2 * 1024 * 1024
}

/**
 * 读取本地文件并作为「文件引用」加入待发送附件（以文件名按钮形式展示）。
 *
 * 性能优化：
 *  - 先立即上抛「文件名芯片」让按钮瞬间出现，避免大文件读取/编码/保存期间界面无反馈；
 *  - 再在后台并发达读取内容或保存到工作区，完成后通过 update-file 回填，不阻塞交互。
 */
async function addFilesAsAttachment(files: File[]): Promise<void> {
  if (files.length === 0) return

  // 第一步：立刻把文件名芯片加入待发送附件，让用户第一时间看到反馈。
  for (const file of files) {
    emit('add-file', {
      name: file.name,
      content: '',
      mime: file.type || 'application/octet-stream',
      size: file.size
    })
  }

  // 第二步：并发加载内容 / 保存工作区，完成后再回填芯片字段。
  const task = (async () => {
    const tasks = files.map(async (file) => {
      const refKey = `file:${file.name}`
      let content = ''
      let savedPath: string | undefined
      let savedSize = file.size

      if (isInlineTextFile(file)) {
        try {
          content = await file.text()
        } catch {
          content = ''
        }
      }

      // 二进制/不可内联文件（如压缩包、图片、音视频）：读取为 base64 保存到工作区
      // 上传目录，并把相对路径随附件下发，让 AI 能用 file_read / file_list 等工具读取。
      if (!content && file.size > 0) {
        try {
          const buffer = await file.arrayBuffer()
          const base64 = bytesToBase64(buffer)
          if (base64.length <= 25 * 1024 * 1024) {
            const res = await window.characterArc.saveAssistantUpload({
              projectId: props.projectId ?? undefined,
              fileName: file.name,
              mime: file.type || 'application/octet-stream',
              dataBase64: base64
            })
            if (res?.success && res.path) {
              savedPath = res.path
              if (typeof res.size === 'number') savedSize = res.size
            }
          }
        } catch {
          // 保存失败则仅以文件名引用，仍可发送（AI 只看到文件名）
        }
      }

      emit('update-file', refKey, { content, path: savedPath, size: savedSize })
    })

    await Promise.all(tasks)
  })()

  pendingFileLoads = [...pendingFileLoads, task]
  try {
    await task
  } finally {
    // 完成后移除，避免数组无限增长
    pendingFileLoads = pendingFileLoads.filter((t) => t !== task)
  }
}

/** 把 ArrayBuffer 转为 base64 字符串（用 apply 批量拼接，规避超长参数栈并提升性能）。 */
function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(binary)
}

// ── 本地文件拖拽上传 + 章节/分卷引用拖拽 ──
const isDragOver = ref(false)
const ACCEPTED_TEXT_EXT = ['txt', 'md', 'markdown', 'mdown', 'mkd']

const ARC_REF_MIME = 'application/x-arc-ref'
/** 项目资源区拖拽（文件/文件夹）使用的自定义 MIME（与 ProjectResourcesPanel 约定）。 */
const ARC_RESOURCE_MIME = 'application/x-arc-resource'

function hasArcRef(event: DragEvent): boolean {
  return !!event.dataTransfer?.types?.includes(ARC_REF_MIME)
}

function hasArcResourceRef(event: DragEvent): boolean {
  return !!event.dataTransfer?.types?.includes(ARC_RESOURCE_MIME)
}

function handleDragEnter(event: DragEvent): void {
  event.preventDefault()
  if (props.isStreaming) return
  if (event.dataTransfer?.types?.includes('Files') || hasArcRef(event) || hasArcResourceRef(event)) {
    isDragOver.value = true
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  if (props.isStreaming) return
  if (event.dataTransfer?.types?.includes('Files') || hasArcRef(event) || hasArcResourceRef(event)) {
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

  // 资源区文件/文件夹拖拽：解析自定义 MIME，加入待发送附件芯片
  if (event.dataTransfer?.types?.includes(ARC_RESOURCE_MIME)) {
    try {
      const raw = event.dataTransfer.getData(ARC_RESOURCE_MIME) ?? ''
      const res = JSON.parse(raw) as { kind: 'resource-file' | 'resource-dir'; path: string; name: string }
      if (res && res.path) {
        emit('add-resource', {
          kind: res.kind === 'resource-dir' ? 'resource-dir' : 'resource',
          path: res.path,
          label: res.name || res.path
        })
      }
    } catch {
      // 忽略无法解析的拖拽数据
    }
    return
  }

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

/**
 * 引用文件芯片区鼠标滚轮事件：将纵向滚动转换为横向滚动，
 * 便于在单行内查看更多引用文件（滚动条隐藏不显示）。
 */
function handleChipsWheel(event: WheelEvent): void {
  const el = chipsRef.value
  if (!el) return
  // 仅在存在横向溢出（即引用文件较多、需要横向滑动）时拦截滚轮，
  // 否则放行让页面正常滚动，避免影响其他交互。
  const canScroll = el.scrollWidth > el.clientWidth
  if (!canScroll) return
  event.preventDefault()
  el.scrollLeft += event.deltaY + event.deltaX
}

function handleKeydown(event: KeyboardEvent) {
  // 中文输入法组合输入（IME）进行中：不做任何按键拦截，避免阻断候选字选择/上屏，
  // 仅放行，否则方向键/回车被 preventDefault 会导致输入法选字失败（输入文字“概率失败”）。
  // 部分浏览器确认候选字的回车那一刻 event.isComposing 已为 false，故叠加手动标记 imeComposing。
  if (event.isComposing || imeComposing) return
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

/** 斜杠菜单在 textarea 失去焦点时是否应保持打开（例如焦点移入 Skills 搜索框）。 */
function handleSlashBlur(event: FocusEvent): void {
  const related = event.relatedTarget as Node | null
  const wrap = textareaRef.value?.closest('.composer-wrap')
  // 焦点仍落在本组件（含斜杠菜单、Skills 搜索框）内则不关闭，便于继续输入搜索。
  if (related && wrap && wrap.contains(related)) {
    return
  }
  slashOpen.value = false
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

/** 根据撤回/回退携带的意图，还原对应的「模式」芯片（如 /standard 标准模式）。 */
function restoreModeFromIntent(intent: string): void {
  // 仅恢复模式类命令（内置模式芯片）；其它意图（slash:* 等）会写入模板文本，无需恢复芯片
  if (!intent.startsWith('global-assistant-v2:')) return
  const entry = BUILTIN_COMMANDS.find((c) => c.intentHint === intent)
  if (!entry) return
  selectedMode.value = { key: entry.key, label: entry.label, intentHint: entry.intentHint }
  pendingIntent.value = entry.intentHint
}

watch(
  () => props.restoredIntent,
  (restored) => {
    if (!restored?.intent) return
    restoreModeFromIntent(restored.intent)
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
      松开以添加本地文件或资源引用
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
      <!-- 已选中的模式芯片（/plan /spec /goal）：标示当前模式，不写入输入框 -->
      <div v-if="selectedMode" class="mode-chip-bar">
        <span class="mode-chip">
          <span class="mode-chip-label">{{ selectedMode.label }}</span>
          <button type="button" class="mode-chip-x" title="移除模式" aria-label="移除模式" @click="clearMode">
            <X :size="11" />
          </button>
        </span>
      </div>
      <!-- 待发送的引用附件芯片（章节/分卷/Skill），可单独叉掉 -->
      <div
        v-if="props.attachments && props.attachments.length > 0"
        ref="chipsRef"
        class="attach-chips"
        @wheel="handleChipsWheel"
      >
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
            <!-- Skills 栏：支持搜索与分组展开/折叠 -->
            <template v-if="slashSkillEntries.length">
              <div class="slash-skill-toolbar">
                <div class="slash-skill-search">
                  <Search :size="13" class="slash-skill-search-icon" />
                  <input
                    v-model="skillSearchQuery"
                    type="text"
                    placeholder="搜索 skills…"
                    class="slash-skill-search-input"
                    @mousedown.stop
                    @keydown.esc="slashOpen = false"
                    @blur="handleSlashBlur"
                  />
                </div>
                <button
                  type="button"
                  class="slash-skill-collapse-all"
                  :title="hasCollapsedSkillGroup ? '全部展开' : '全部收起'"
                  @mousedown.prevent="toggleAllSkillGroups"
                >
                  <component :is="hasCollapsedSkillGroup ? ChevronsUpDown : ChevronsDownUp" :size="13" />
                </button>
              </div>
              <template v-if="slashSkillMatchCount">
                <template v-for="(group, gi) in slashSkillGroupsRendered" :key="gi">
                  <button
                    type="button"
                    class="slash-group-toggle"
                    @mousedown.prevent="toggleSkillGroup(group.title)"
                  >
                    <ChevronDown :size="13" class="slash-group-chevron" :class="{ collapsed: group.collapsed }" />
                    <span class="slash-group-title">{{ group.title }}</span>
                    <span class="slash-group-count">{{ group.count }}</span>
                  </button>
                  <template v-if="!group.collapsed">
                    <button
                      v-for="({ entry, index }, ei) in group.items"
                      :key="slashEntryKey(entry)"
                      type="button"
                      class="slash-item"
                      :class="{ active: index === slashActiveIdx }"
                      @mousedown.prevent="onSlashItemMouseDown($event, index)"
                      @mouseenter="slashActiveIdx = index"
                    >
                      <span class="slash-label">{{ entry.label }}</span>
                      <span class="slash-desc">{{ entry.description }}</span>
                    </button>
                  </template>
                </template>
              </template>
              <div v-else class="slash-empty">没有匹配的 Skills</div>
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
        @blur="handleSlashBlur"
        @compositionstart="handleCompositionStart"
        @compositionend="handleCompositionEnd"
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
            v-if="hasSpeech && !props.isStreaming"
            size="small"
            :title="props.speechListening ? '正在录音…（再次点击停止）' : '语音转文字（已启用）'"
            :type="props.speechListening ? 'error' : 'info'"
            :secondary="!props.speechListening"
            class="voice-btn"
            :class="{ 'is-recording': props.speechListening }"
            @click="emit('voice-input')"
          >
            <template #icon>
              <span v-if="props.speechListening" class="voice-wave" aria-hidden="true">
                <i /><i /><i /><i />
              </span>
              <Mic v-else :size="13" />
            </template>
          </NButton>
          <NButton
            size="small"
            title="添加文件引用"
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
      <div v-if="addCommandVisible" class="add-cmd-overlay" @mousedown.self="closeAddCommand">
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
            <button type="button" class="add-cmd-btn" @click="closeAddCommand">取消</button>
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
/* ── 语音转文字录音按钮动画 ── */
.voice-btn.is-recording {
  animation: voice-pulse 1.2s ease-in-out infinite;
}
.voice-wave {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 13px;
  padding: 0 1px;
}
.voice-wave i {
  display: inline-block;
  width: 2.5px;
  height: 5px;
  border-radius: 1px;
  background: currentColor;
  animation: voice-wave-bounce 1s ease-in-out infinite;
}
.voice-wave i:nth-child(1) { animation-delay: 0s; }
.voice-wave i:nth-child(2) { animation-delay: 0.18s; }
.voice-wave i:nth-child(3) { animation-delay: 0.36s; }
.voice-wave i:nth-child(4) { animation-delay: 0.54s; }
@keyframes voice-wave-bounce {
  0%, 100% { height: 4px; opacity: 0.7; }
  50% { height: 13px; opacity: 1; }
}
@keyframes voice-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--arc-error, #d03050) 40%, transparent); }
  50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--arc-error, #d03050) 0%, transparent); }
}
/* ── 斜杠命令菜单 ── */
.composer {
  position: relative;
}
.attach-chips {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  /* 隐藏滚动条（透明不可见） */
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-bottom: 2px;
}
.attach-chips::-webkit-scrollbar {
  display: none;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 170px;
  padding: 2px 4px 2px 7px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 11.5px;
  cursor: default;
}
.attach-chip-label {
  min-width: 0;
  max-width: 120px;
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
  left: 14px;
  right: 14px;
  bottom: calc(100% + 10px);
  z-index: 20;
  max-height: 320px;
  border: 1px solid var(--arc-border-strong);
  border-radius: 14px;
  background: var(--arc-bg-surface);
  box-shadow: 0 8px 32px color-mix(in srgb, var(--arc-text-primary) 12%, transparent);
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
  border-radius: 8px;
  padding: 6px 12px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
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
/* ── Skills 栏：搜索 + 分组展开/折叠 ── */
.slash-skill-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 6px;
}
.slash-skill-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-bg-body) 70%, transparent);
  transition: border-color 0.15s ease;
}
.slash-skill-search:focus-within {
  border-color: var(--arc-primary);
}
.slash-skill-search-icon {
  color: var(--arc-text-hint);
  flex: 0 0 auto;
}
.slash-skill-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--arc-text-primary);
  font-size: 12px;
  font-family: inherit;
}
.slash-skill-search-input::placeholder {
  color: var(--arc-text-hint);
}
.slash-skill-collapse-all {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border: 1px solid var(--arc-border);
  border-radius: 7px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.slash-skill-collapse-all:hover {
  color: var(--arc-primary);
  border-color: var(--arc-primary);
}
.slash-group-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--arc-text-primary);
  text-align: left;
  padding: 5px 8px 3px;
  cursor: pointer;
  font-family: inherit;
}
.slash-group-toggle:hover {
  background: color-mix(in srgb, var(--arc-text-secondary) 6%, transparent);
}
.slash-group-toggle .slash-group-title {
  padding: 0;
  flex: 0 0 auto;
  color: var(--arc-text-secondary);
}
.slash-group-count {
  font-family: var(--v2-mono);
  font-size: 10.5px;
  color: var(--arc-text-hint);
  margin-left: auto;
  padding-right: 4px;
}
.slash-group-chevron {
  color: var(--arc-text-hint);
  flex: 0 0 auto;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.slash-group-chevron.collapsed {
  transform: rotate(-90deg);
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
  border-radius: 16px;
  box-shadow: 0 12px 40px color-mix(in srgb, var(--arc-text-primary) 15%, transparent);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
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
  border-radius: 10px;
  padding: 9px 12px;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font: inherit;
  font-size: 13px;
  resize: vertical;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.add-cmd-field input:focus,
.add-cmd-field textarea:focus {
  outline: none;
  border-color: var(--arc-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}
.add-cmd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.add-cmd-btn {
  border: 1px solid var(--arc-border-strong);
  border-radius: 999px;
  padding: 7px 16px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.add-cmd-btn:hover {
  background: var(--arc-bg-weak);
  border-color: var(--arc-border);
}
.add-cmd-btn.primary {
  background: var(--arc-primary);
  border-color: var(--arc-primary);
  color: #fff;
}
.add-cmd-btn.primary:hover {
  background: color-mix(in srgb, var(--arc-primary) 90%, var(--arc-text-primary));
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
  border-radius: 10px;
  background: transparent;
  color: var(--arc-text-primary);
  text-align: left;
  padding: 9px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s ease;
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
  padding: 14px 36px 24px;
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
  inset: 4px 16px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed var(--arc-primary);
  border-radius: 18px;
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
}
.composer {
  max-width: 720px;
  margin: 0 auto;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  border-radius: 22px;
  padding: 14px 16px 10px;
  box-shadow: 0 2px 12px color-mix(in srgb, var(--arc-text-primary) 6%, transparent);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.composer:focus-within {
  border-color: color-mix(in srgb, var(--arc-primary) 50%, var(--arc-border-strong));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}
.composer.streaming {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border-strong));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 6%, transparent);
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
.mode-chip-bar {
  display: flex;
  align-items: center;
}
.mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 4px 3px 9px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 12px;
}
.mode-chip-label {
  font-family: var(--v2-mono);
  font-weight: 700;
}
.mode-chip-x {
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
.mode-chip-x:hover {
  background: color-mix(in srgb, var(--arc-primary) 14%, transparent);
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
  /* 隐藏原生滚动条（上/下箭头+滑块），保留滚动功能，滚动条视觉上隐形 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
textarea::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
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
