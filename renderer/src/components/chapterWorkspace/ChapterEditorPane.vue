<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronRight, Folder, FocusIcon, History, Maximize2, Menu, MessageSquareQuote, Minus, Minimize2, Plus, Redo2, RefreshCw, Save, Search, ShieldAlert, Sparkles, Type, Undo2, Wand2 } from 'lucide-vue-next'
import EditorCommandPalette from './EditorCommandPalette.vue'
import type { CommandPaletteAction } from './editorCommandPalette'
import { NAlert, NDropdown, NDynamicTags, NForm, NFormItem, NInput, NModal, NSelect, NTag, NTooltip, useMessage } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import SimpleChapterEditor from './SimpleChapterEditor.vue'
import type { ChapterRecoverySnapshot } from './SimpleChapterEditor.vue'
import ChapterVersionDialog from './ChapterVersionDialog.vue'
import EditorFindBar from './EditorFindBar.vue'
import EditorContextMenu from './EditorContextMenu.vue'
import QuickScrollBar from './QuickScrollBar.vue'
import { getChapterCharacterCount, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { editorFontOptions, getEditorFontOption, isEditorFont } from '@/features/chapters/editorTypography'
import { toIpcPayload } from '@/utils/ipcPayload'
import { formatChapterWordTargetLabel, parseChapterWordTarget } from '@/features/chapters/wordTarget'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { useAppStore } from '@/stores/app'

defineProps<{
  aiOpen: boolean
  focusMode: boolean
  showSidebarToggle?: boolean
}>()

const emit = defineEmits<{
  toggleAi: []
  toggleFocus: []
  toggleSidebar: []
  selectionAction: [action: string, text: string]
  generateDraft: []
}>()

const appStore = useAppStore()
const message = useMessage()

// 正文字号：默认 17px，范围 10~50px，支持 +- 按钮、手动输入与 Ctrl+滚轮 调节
const MIN_FONT = 10
const MAX_FONT = 50
const DEFAULT_FONT = 17
const fontSize = ref(DEFAULT_FONT)
// 字号输入框编辑状态与草稿
const editingFont = ref(false)
const fontSizeDraft = ref(String(DEFAULT_FONT))
const fontSizeInputEl = ref<HTMLInputElement | null>(null)
const versionDialogVisible = ref(false)
// ── 章节内快速新建伏笔 ──
const quickCreateThreadVisible = ref(false)
// AI 生成伏笔进行中标记
const aiGeneratingThread = ref(false)
const quickThreadForm = reactive({
  title: '',
  description: '',
  priority: 'medium' as 'low' | 'medium' | 'high',
  plannedCloseChapterId: '',
  tags: [] as string[],
  remark: ''
})
// 「计划回收章节」只允许选择当前章节之后的分卷/章节（伏笔应在后面回收）。
// 按分卷顺序 + 分卷内章节顺序过滤：同分卷里排在当前章节之后、以及所有后续分卷中的章节。
const quickChapterOptions = computed(() => {
  const current = currentChapter.value
  if (!current) return []
  const volumes = appStore.outlineVolumes
  const chapters = appStore.chapters
  const currentVolumeIndex = volumes.findIndex((v) => v.id === current.volumeId)
  const currentChapterIndexInVolume = chapters
    .filter((c) => c.volumeId === current.volumeId)
    .findIndex((c) => c.id === current.id)
  return chapters
    .filter((c) => {
      const volIndex = volumes.findIndex((v) => v.id === c.volumeId)
      // 后续分卷中的章节均可回收
      if (volIndex > currentVolumeIndex) return true
      // 同分卷内，必须是当前章节之后的章节
      if (volIndex === currentVolumeIndex && volIndex !== -1) {
        const idxInVolume = chapters
          .filter((x) => x.volumeId === c.volumeId)
          .findIndex((x) => x.id === c.id)
        return idxInVolume > currentChapterIndexInVolume
      }
      return false
    })
    .map((c) => ({ label: c.title || '未命名章节', value: c.id }))
})

function openQuickCreateThread(): void {
  // 无分卷或无章节时不允许新建伏笔
  if (!appStore.outlineVolumes.length || !appStore.chapters.length) {
    message.warning('当前没有分卷或者没有章节，无法新建伏笔')
    return
  }
  quickThreadForm.title = ''
  quickThreadForm.description = ''
  quickThreadForm.priority = 'medium'
  quickThreadForm.plannedCloseChapterId = ''
  quickThreadForm.tags = []
  quickThreadForm.remark = ''
  quickCreateThreadVisible.value = true
}

function confirmQuickCreateThread(): void {
  const title = quickThreadForm.title.trim()
  if (!title) {
    message.warning('请填写伏笔标题')
    return
  }
  appStore.createPlotThread({
    title,
    description: quickThreadForm.description.trim(),
    openedInChapterId: currentChapter.value?.id ?? '',
    plannedCloseChapterId: quickThreadForm.plannedCloseChapterId || undefined,
    status: 'pending',
    tags: quickThreadForm.tags,
    priority: quickThreadForm.priority,
    remark: quickThreadForm.remark.trim()
  })
  message.success('伏笔已添加')
  quickCreateThreadVisible.value = false
}

// AI 生成伏笔：调用 AI 根据章节正文与项目设定生成一条伏笔，并自动写入伏笔线索
async function aiGenerateThread(): Promise<void> {
  if (aiGeneratingThread.value || appStore.isAiTaskRunning('plot-thread-generate')) {
    message.warning('AI 正在生成伏笔，请稍候')
    return
  }
  const project = appStore.currentProject
  const chapter = currentChapter.value
  if (!project || !chapter) {
    message.warning('当前没有可用的项目或章节，无法生成伏笔')
    return
  }
  const plainText = getPlainTextFromEditorContent(chapter.content ?? '').trim()
  const existingThreads = appStore.plotThreads
    .filter((t) => t.status === 'pending')
    .map((t) => `${t.title}（${t.description}）`)
  const hint = quickThreadForm.title.trim() || quickThreadForm.description.trim() || quickThreadForm.remark.trim()

  aiGeneratingThread.value = true
  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: 'plot-thread-generate',
        kind: 'plot-thread',
        label: 'AI 生成伏笔',
        description: `为《${chapter.title || '未命名章节'}》生成一条新伏笔`,
        panel: 'chapters'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          clientTaskId: appStore.getClientTaskId(),
          task: 'plot-thread-generate',
          settings: appStore.appSettings,
          context: {
            projectTitle: project.title,
            projectGenre: project.genre,
            chapterTitle: chapter.title || '未命名章节',
            chapterContent: plainText.slice(0, 6000),
            hint,
            existingThreads,
            worldviewEntries: appStore.worldviewEntries.slice(0, 8).map((e) => ({
              type: e.type, title: e.title, content: String(e.content ?? '').replace(/\s+/g, ' ').slice(0, 200)
            })),
            characters: appStore.characters.slice(0, 8).map((c) => ({
              name: c.name, role: c.role, description: String(c.description ?? '').replace(/\s+/g, ' ').slice(0, 160)
            }))
          }
        }))
    )

    if (!result.success) {
      message.error(result.error ?? 'AI 生成伏笔失败')
      return
    }
    const entries = Array.isArray((result.result as Record<string, unknown>)?.entries)
      ? ((result.result as Record<string, unknown>).entries as Array<Record<string, unknown>>)
      : []
    const entry = entries[0]
    if (!entry || !String(entry.title ?? '').trim()) {
      message.warning('AI 未生成有效的伏笔，请重试')
      return
    }
    appStore.createPlotThread({
      title: String(entry.title).trim(),
      description: String(entry.description ?? '暂无描述'),
      openedInChapterId: chapter.id,
      status: 'pending',
      tags: Array.isArray(entry.tags) ? (entry.tags as string[]).map(String) : []
    })
    message.success('AI 伏笔已生成并同步到伏笔线索')
    quickCreateThreadVisible.value = false
  } catch (error) {
    if (!(error instanceof Error) || (!error.message.includes('任务已中断') && !error.message.includes('任务已被取消'))) {
      message.error(error instanceof Error ? error.message : 'AI 生成伏笔失败，请检查模型配置')
    }
  } finally {
    aiGeneratingThread.value = false
  }
}
// 章节摘要默认折叠，点击目标字数右侧按钮展开
const summaryExpanded = ref(false)

const currentEditorFont = computed(() => getEditorFontOption(appStore.appSettings.editorFont))
const editorFontMenuOptions = computed<DropdownOption[]>(() =>
  editorFontOptions.map((option) => ({
    key: option.id,
    label: () => h(
      'span',
      {
        style: {
          display: 'inline-flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '24px',
          width: '170px',
          fontFamily: option.fontFamily
        }
      },
      [
        h('span', option.label),
        h('span', { style: { color: 'var(--arc-text-hint)', fontSize: '12px' } }, '“引号”')
      ]
    ),
    icon: () => h(Check, {
      size: 14,
      style: { opacity: option.id === currentEditorFont.value.id ? '1' : '0' }
    })
  }))
)

function selectEditorFont(key: string | number): void {
  if (isEditorFont(key)) {
    appStore.updateAppSetting('editorFont', key)
  }
}

function stepFont(delta: number): void {
  fontSize.value = Math.max(MIN_FONT, Math.min(MAX_FONT, fontSize.value + delta))
  fontSizeDraft.value = String(fontSize.value)
}

// 手动输入字号：失去焦点 / 回车 / 上一步按钮时应用，并夹在 10~50 范围内
async function startEditingFont(): Promise<void> {
  fontSizeDraft.value = String(fontSize.value)
  editingFont.value = true
  await nextTick()
  fontSizeInputEl.value?.focus()
  fontSizeInputEl.value?.select()
}

function applyFontSize(): void {
  editingFont.value = false
  const parsed = Number.parseInt(fontSizeDraft.value, 10)
  const next = Number.isNaN(parsed)
    ? fontSize.value
    : Math.max(MIN_FONT, Math.min(MAX_FONT, parsed))
  fontSize.value = next
  fontSizeDraft.value = String(next)
}

function cancelEditingFont(): void {
  editingFont.value = false
  fontSizeDraft.value = String(fontSize.value)
}

// Ctrl+滚轮缩放：用 rAF 合并连续滚轮事件，避免每滚动一格就触发一次渲染导致卡顿
let wheelAccumulator = 0
let wheelRafId: number | null = null

function handleEditorWheel(e: WheelEvent): void {
  // Ctrl(或 Cmd)+滚轮 调整正文字号，避免触发页面/浏览器缩放
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  // 累积滚轮步进值，合并到下一帧统一应用
  wheelAccumulator += e.deltaY > 0 ? -1 : 1
  if (wheelRafId !== null) return
  wheelRafId = requestAnimationFrame(() => {
    wheelRafId = null
    if (wheelAccumulator === 0) return
    const steps = Math.round(wheelAccumulator)
    wheelAccumulator = 0
    stepFont(steps)
  })
}

const currentChapter = computed(() => appStore.selectedChapter)
const currentVolume = computed(() => appStore.selectedChapterVolume)
const currentVolumeIndex = computed(() =>
  appStore.outlineVolumes.findIndex((v) => v.id === currentVolume.value?.id)
)
const volumeLabel = computed(() =>
  currentVolume.value
    ? formatVolumeLabel(currentVolume.value, Math.max(currentVolumeIndex.value, 0), 'compact')
    : '未分卷'
)

const wordCount = computed(() => getChapterCharacterCount(currentChapter.value?.content ?? ''))
const targetWords = computed(() => parseChapterWordTarget(currentChapter.value?.wordTarget))
const progressPercent = computed(() => {
  if (!targetWords.value) return 0
  return Math.min(100, Math.round((wordCount.value / targetWords.value) * 100))
})

const saveStatusText = computed(() => {
  if (appStore.persistenceError) return '保存失败'
  if (appStore.isPersisting) return '正在保存'
  if (appStore.isPersistencePending) return '等待自动保存'
  return '已保存'
})

const chapterIndex = computed(() => {
  const i = appStore.chapters.findIndex((c) => c.id === currentChapter.value?.id)
  return i >= 0 ? i + 1 : 1
})

const postGenerationIssues = computed(() => {
  const chapterId = currentChapter.value?.id ?? ''
  return chapterId ? appStore.getChapterPostGenerationIssues(chapterId) : null
})

const postGenerationIssueType = computed(() =>
  postGenerationIssues.value?.issues.some((issue) => issue.severity === 'error') ? 'error' : 'warning'
)

function dismissPostGenerationIssues(): void {
  const chapterId = currentChapter.value?.id ?? ''
  if (!chapterId) {
    return
  }
  appStore.dismissChapterPostGenerationIssues(chapterId)
}

const selToolbarVisible = ref(false)
const selToolbarTop = ref(0)
const selToolbarLeft = ref(0)
// 在 selectionchange 时缓存选区文本——mousedown 时浏览器会清除 window.getSelection()，
// click 时用这个缓存值兜底，避免 handleSelAction 读到空选区。
let cachedSelectionText = ''
const scrollRef = ref<HTMLDivElement | null>(null)
const editorRef = ref<InstanceType<typeof SimpleChapterEditor> | null>(null)
const findBarRef = ref<InstanceType<typeof EditorFindBar> | null>(null)
const quickScrollRef = ref<InstanceType<typeof QuickScrollBar> | null>(null)
const findBarVisible = ref(false)
const findInitialTerm = ref('')
const recoverySnapshot = ref<ChapterRecoverySnapshot | null>(null)
// editorRef.value.editor 通过模板 ref 自动 unwrap 为 Editor | undefined
const tiptapEditor = computed(() => (editorRef.value as any)?.editor ?? null)

function openFindBar(): void {
  const editor = tiptapEditor.value
  let preset = ''
  if (editor) {
    const { from, to } = editor.state.selection
    if (from !== to) {
      const text = editor.state.doc.textBetween(from, to, '\n').trim()
      // 选区单行才预填，多段选区跳过
      if (text && !text.includes('\n')) preset = text
    }
  }
  findInitialTerm.value = preset
  if (findBarVisible.value) {
    // 已打开：强制用选区文本覆盖（如果没选区，则保留原搜索词）
    if (preset) {
      ;(findBarRef.value as any)?.setTerm(preset)
    } else {
      ;(findBarRef.value as any)?.focus()
    }
  } else {
    findBarVisible.value = true
  }
}

const ctxMenuVisible = ref(false)
const ctxMenuX = ref(0)
const ctxMenuY = ref(0)
const ctxMenuHasSelection = ref(false)

function handleEditorContextMenu(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  // 扩大右键范围：整个正文编辑区（含 .ProseMirror 及其两侧留白、标题、摘要等）都弹出菜单
  const scrollEl = scrollRef.value
  // 快速滑动按钮也是有效的右键目标（其内部不再显示关闭叉号，改为通过右键菜单关闭）
  const onQuickScroll = !!target?.closest('.arc-qsb')
  if (!target || (!scrollEl || !scrollEl.contains(target)) && !onQuickScroll) return
  // 若右键点在可编辑/可输入控件（标题 input、按钮等）上，交给默认行为，避免干扰
  const tag = target.tagName
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.closest('.ep-title') ||
    target.closest('button') ||
    target.closest('.n-tag') ||
    target.closest('a')
  ) {
    return
  }
  e.preventDefault()
  const editor = tiptapEditor.value
  const sel = editor?.state.selection
  ctxMenuHasSelection.value = !!sel && sel.from !== sel.to
  ctxMenuX.value = e.clientX
  ctxMenuY.value = e.clientY
  ctxMenuVisible.value = true
}

async function handleCtxAction(id: string): Promise<void> {
  const editor = tiptapEditor.value
  if (!editor) return
  if (id === 'copy') {
    const { from, to } = editor.state.selection
    if (from === to) return
    const text = editor.state.doc.textBetween(from, to, '\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 剪贴板被拒绝时回退到执行命令
      document.execCommand('copy')
    }
  } else if (id === 'cut') {
    const { from, to } = editor.state.selection
    if (from === to) return
    const text = editor.state.doc.textBetween(from, to, '\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      document.execCommand('cut')
      return
    }
    editor.chain().focus().deleteSelection().run()
  } else if (id === 'paste') {
    try {
      const text = await navigator.clipboard.readText()
      if (text) editor.chain().focus().insertContent(text).run()
    } catch {
      document.execCommand('paste')
    }
  } else if (id === 'paste-plain') {
    try {
      const text = await navigator.clipboard.readText()
      if (text) editor.chain().focus().insertContent(text).run()
    } catch {
      /* ignore */
    }
  } else if (id === 'select-all') {
    editor.chain().focus().selectAll().run()
  } else if (id === 'find') {
    openFindBar()
  } else if (id === 'minimap') {
    // 切换正文右侧快速滑动按钮开关，持久化到应用设置
    appStore.updateAppSetting('editorMinimap', !appStore.appSettings.editorMinimap)
    if (appStore.appSettings.editorMinimap) {
      nextTick(() => quickScrollRef.value?.redraw())
    }
  } else if (id === 'float-undo') {
    // 切换正文左下角回退悬浮按钮开关，持久化到应用设置（软件重启后保持上次设置）
    appStore.updateAppSetting('editorFloatUndo', !appStore.appSettings.editorFloatUndo)
  }
}

// ── 回退悬浮按钮：正文左下角的回退/撤销回退圆形按钮，不随正文滑动移动 ──
// tiptap 的 Undo/Redo 能力来自 StarterKit 内置的 History 扩展
// 用一个响应式版本号驱动重算：编辑器每次事务后自增，使 canUndo/canRedo 实时刷新
const editorRevision = ref(0)
const canUndo = computed(() => {
  void editorRevision.value
  return !!tiptapEditor.value?.can().undo()
})
const canRedo = computed(() => {
  void editorRevision.value
  return !!tiptapEditor.value?.can().redo()
})

function runFloatUndo(direction: 'undo' | 'redo'): void {
  const editor = tiptapEditor.value
  if (!editor) return
  const chain = editor.chain().focus()
  if (direction === 'undo') {
    chain.undo().run()
  } else {
    chain.redo().run()
  }
}

// 监听 tiptap 编辑器事务，实时刷新回退/撤销回退可用状态
watch(
  () => tiptapEditor.value,
  (editor) => {
    if (!editor) return
    const onTransaction = (): void => {
      editorRevision.value++
    }
    editor.on('transaction', onTransaction)
    return () => editor.off('transaction', onTransaction)
  }
)

// 章节正文更新后触发快速滑动按钮位置刷新
function onChapterContentUpdate(value: string, chapterId: string): void {
  appStore.updateChapterContent(value, chapterId)
  nextTick(() => quickScrollRef.value?.redraw())
}

function handleSelectionChange(): void {
  // 选区变化时同步刷新快速滑动按钮位置
  if (appStore.appSettings.editorMinimap) {
    quickScrollRef.value?.redraw()
  }
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    // 不在这里清空 cachedSelectionText：当用户点击悬浮工具栏按钮时，
    // 浏览器会因 mousedown 清除 window.getSelection()，触发 selectionchange，
    // 若在此清空缓存，handleSelAction 将拿不到选中文本（AI 润色/改写无反应）。
    // 清空缓存的职责由 handleMouseDown（点击非工具栏区域时）承担。
    selToolbarVisible.value = false
    return
  }
  const range = sel.getRangeAt(0)
  const scrollEl = scrollRef.value
  if (!scrollEl || !scrollEl.contains(range.commonAncestorContainer)) {
    selToolbarVisible.value = false
    return
  }
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    selToolbarVisible.value = false
    return
  }
  // 在工具栏显示前缓存选区文本，mousedown 时浏览器会清除 window.getSelection()
  cachedSelectionText = sel.toString().trim()
  const scrollRect = scrollEl.getBoundingClientRect()
  const toolbarH = 36
  const gap = 6
  let top = rect.top - toolbarH - gap
  if (top < scrollRect.top) top = rect.bottom + gap
  const toolbarW = 360
  let left = rect.left + rect.width / 2
  const minLeft = scrollRect.left + toolbarW / 2 + 4
  const maxLeft = scrollRect.right - toolbarW / 2 - 4
  if (left < minLeft) left = minLeft
  else if (left > maxLeft) left = maxLeft
  selToolbarTop.value = top
  selToolbarLeft.value = left
  selToolbarVisible.value = true
}

function handleSelAction(action: string): void {
  // 优先读实时选区，若浏览器已因 mousedown 清除则用缓存值兜底
  const sel = window.getSelection()
  const text = sel?.toString().trim() || cachedSelectionText
  cachedSelectionText = ''
  if (!text) return
  selToolbarVisible.value = false
  emit('selectionAction', action, text)
}

function handleMouseDown(e: MouseEvent): void {
  const toolbar = document.querySelector('.arc-sel-toolbar')
  if (toolbar?.contains(e.target as Node)) return
  selToolbarVisible.value = false
  // 点击非工具栏区域时清空选区缓存，避免旧的选中文本残留
  cachedSelectionText = ''
}

const commandPaletteVisible = ref(false)
const commandPaletteActions = computed<CommandPaletteAction[]>(() => [
  { id: 'save', title: '保存工作区', type: 'save', icon: Save, keyHint: 'Ctrl+S' },
  { id: 'save-version', title: '保存章节为历史版本', type: 'save-version', icon: History, keyHint: 'Ctrl+Shift+S' },
  { id: 'find', title: '查找 / 替换', type: 'find', icon: Search, keyHint: 'Ctrl+F' },
  { id: 'focus', title: '切换专注模式', type: 'focus', icon: FocusIcon, keyHint: 'F11' },
  { id: 'draft', title: '生成初稿', type: 'draft', icon: Wand2, keywords: '生成初稿 草稿 写作' },
  { id: 'ai', title: '切换 AI 助理', type: 'ai', icon: Sparkles, keyHint: 'Ctrl+Alt+A' },
  { id: 'sidebar', title: '切换侧边栏', type: 'sidebar', icon: Menu },
  { id: 'versions', title: '打开历史版本', type: 'versions', icon: History },
  { id: 'font-inc', title: '增大正文字号', type: 'font-inc', icon: Plus },
  { id: 'font-dec', title: '减小正文字号', type: 'font-dec', icon: Minus }
])

function handleCommandSelect(action: CommandPaletteAction): void {
  switch (action.type) {
    case 'save':
      void appStore.persistWorkspace().then(() => {
        if (appStore.persistenceError) message.error(appStore.persistenceError)
        else message.success('工作区已保存')
      })
      break
    case 'save-version':
      void appStore.saveCurrentChapterVersion().then((result) => {
        if (result.success) message.success('已保存当前章节版本')
        else message.error(result.error ?? '保存版本失败')
      })
      break
    case 'find':
      openFindBar()
      break
    case 'focus':
      emit('toggleFocus')
      break
    case 'draft':
      emit('generateDraft')
      break
    case 'ai':
      emit('toggleAi')
      break
    case 'sidebar':
      emit('toggleSidebar')
      break
    case 'versions':
      versionDialogVisible.value = true
      break
    case 'font-inc':
      stepFont(1)
      break
    case 'font-dec':
      stepFont(-1)
      break
  }
  commandPaletteVisible.value = false
}

function handleGlobalKeydown(e: KeyboardEvent): void {
  // 组合输入（IME）期间不触发任何快捷键/拦截，避免打断中文输入（正文编辑输入文字概率失败）
  if (e.isComposing) return
  const commandKey = e.ctrlKey || e.metaKey
  if (commandKey && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    commandPaletteVisible.value = true
    return
  }
  if (commandKey && e.key.toLowerCase() === 'f') {
    const scrollEl = scrollRef.value
    if (!scrollEl) return
    // 仅当焦点在当前编辑器区域内时才拦截
    const active = document.activeElement
    const inEditor = scrollEl.contains(active) || findBarVisible.value
    if (!inEditor) return
    e.preventDefault()
    openFindBar()
    return
  }
  if (commandKey && e.altKey && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    emit('toggleAi')
    return
  }
  if (commandKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (e.shiftKey) {
      void appStore.saveCurrentChapterVersion().then((result) => {
        if (result.success) message.success('已保存当前章节版本')
        else message.error(result.error ?? '保存版本失败')
      })
    } else {
      void appStore.persistWorkspace().then(() => {
        if (appStore.persistenceError) message.error(appStore.persistenceError)
        else message.success('工作区已保存')
      })
    }
  }
}

function restoreRecovery(): void {
  editorRef.value?.restoreRecovery()
  recoverySnapshot.value = null
  message.success('已恢复异常退出前的本地草稿')
}

function discardRecovery(): void {
  editorRef.value?.discardRecovery()
  recoverySnapshot.value = null
}

onMounted(() => {
  document.addEventListener('selectionchange', handleSelectionChange)
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('keydown', handleGlobalKeydown)
  scrollRef.value?.addEventListener('wheel', handleEditorWheel, { passive: false })
  scrollRef.value?.addEventListener('scroll', handleEditorScroll, { passive: true })
})

function handleEditorScroll(): void {
  quickScrollRef.value?.redraw()
}

// 切换章节时重新刷新快速滑动按钮位置，确保新章节正文立即可见
watch(
  () => currentChapter.value?.id,
  () => {
    nextTick(() => quickScrollRef.value?.redraw())
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', handleSelectionChange)
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('keydown', handleGlobalKeydown)
  scrollRef.value?.removeEventListener('wheel', handleEditorWheel)
  scrollRef.value?.removeEventListener('scroll', handleEditorScroll)
  // 清理未执行的滚轮缩放任务
  if (wheelRafId !== null) {
    cancelAnimationFrame(wheelRafId)
    wheelRafId = null
    wheelAccumulator = 0
  }
})
</script>

<template>
  <main class="editor-pane">
    <header v-if="!focusMode" class="ep-header">
      <button v-if="showSidebarToggle" class="toolbtn sidebar-toggle" @click="emit('toggleSidebar')">
        <Menu :size="14" />
      </button>
      <div class="breadcrumb">
        <Folder :size="13" />
        <span class="crumb-volume">{{ volumeLabel }}</span>
        <ChevronRight :size="12" />
        <span class="crumb-current">{{ currentChapter?.title || '未命名章节' }}</span>
      </div>

      <div class="ep-actions">
        <span class="save-indicator" :title="saveStatusText">
          <span
            class="dot"
            :class="{
              pending: appStore.isPersistencePending && !appStore.persistenceError,
              failed: Boolean(appStore.persistenceError)
            }"
          />
          <span class="save-label">{{ saveStatusText }}</span>
        </span>
        <span class="divider" />

        <n-dropdown
          trigger="click"
          placement="bottom-end"
          :options="editorFontMenuOptions"
          @select="selectEditorFont"
        >
          <button class="toolbtn font-picker-tool" :title="`正文字体：${currentEditorFont.label}`">
            <Type :size="13" />
            <span class="font-picker-label">{{ currentEditorFont.shortLabel }}</span>
            <ChevronDown :size="11" />
          </button>
        </n-dropdown>

        <n-tooltip placement="bottom">
          <template #trigger>
            <div class="font-stepper">
              <button :title="'减小正文字号 (最小 ' + MIN_FONT + 'px)'" @click="stepFont(-1)"><Minus :size="11" /></button>
              <input
                v-if="editingFont"
                ref="fontSizeInputEl"
                v-model="fontSizeDraft"
                class="level-input"
                type="number"
                :min="MIN_FONT"
                :max="MAX_FONT"
                @blur="applyFontSize"
                @keydown.enter="applyFontSize"
                @keydown.esc="cancelEditingFont"
              />
              <span v-else class="level" @dblclick="startEditingFont">{{ fontSize }}px</span>
              <button :title="'增大正文字号 (最大 ' + MAX_FONT + 'px)'" @click="stepFont(1)"><Plus :size="11" /></button>
            </div>
          </template>
          正文字号：可点击数字直接输入（{{ MIN_FONT }}~{{ MAX_FONT }}px），或按 Ctrl + 鼠标滚轮 放大/缩小
        </n-tooltip>

        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="toolbtn" @click="emit('toggleFocus')"><FocusIcon :size="13" /></button>
          </template>
          专注模式 (F11)
        </n-tooltip>
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="toolbtn" :disabled="!currentChapter" @click="versionDialogVisible = true">
              <History :size="13" />
            </button>
          </template>
          历史版本
        </n-tooltip>
        <button class="toolbtn" :disabled="!currentChapter" :title="'生成初稿'" @click="emit('generateDraft')">
          <Wand2 :size="13" />
          <span class="btn-label" data-full="生成初稿">生成初稿</span>
        </button>
        <button class="toolbtn" :disabled="!currentChapter" :title="'新建伏笔'" @click="openQuickCreateThread">
          <Plus :size="13" />
          <span class="btn-label" data-full="新建伏笔">新建伏笔</span>
        </button>
        <button class="toolbtn" :class="{ primary: !aiOpen, active: aiOpen }" :title="'AI 助理'" @click="emit('toggleAi')">
          <Sparkles :size="13" />
          <span class="btn-label" data-full="AI 助理">AI 助理</span>
        </button>
      </div>
    </header>

    <div class="ep-body">
      <div ref="scrollRef" class="ep-scroll arc-scrollbar" @contextmenu="handleEditorContextMenu">
        <div class="ep-canvas" :style="{ fontSize: fontSize + 'px' }">
        <div v-if="!currentChapter" class="ep-empty">
          请在左侧选择一个章节，或新建一个章节开始写作
        </div>
        <template v-else>
          <input
            class="ep-title"
            :value="currentChapter.title"
            placeholder="章节标题"
            @change="(e) => appStore.updateChapterTitle((e.target as HTMLInputElement).value)"
          />

          <div class="ep-meta-row">
            <n-tag size="small" :bordered="false">{{ wordCount.toLocaleString() }} 字</n-tag>
            <div class="target-words-group">
              <n-tag size="small" :bordered="false">目标 {{ formatChapterWordTargetLabel(currentChapter.wordTarget) }}</n-tag>
              <button
                v-if="currentChapter.summary"
                class="summary-toggle"
                :class="{ expanded: summaryExpanded }"
                type="button"
                :title="summaryExpanded ? '收起章节摘要' : '展开章节摘要'"
                @click="summaryExpanded = !summaryExpanded"
              >
                <ChevronDown :size="13" />
              </button>
            </div>
          </div>
          <div v-if="currentChapter.summary && summaryExpanded" class="meta-summary">
            <span class="meta-summary-label">章节摘要</span>
            {{ currentChapter.summary }}
          </div>

          <n-alert
            v-if="postGenerationIssues?.issues.length"
            :type="postGenerationIssueType"
            :show-icon="false"
            closable
            class="ep-postgen-alert"
            @close="dismissPostGenerationIssues"
          >
            <template #header>
              本章正文已生成，但后处理没有完全完成
            </template>
            <div class="ep-postgen-copy">
              你可以继续写作；如果依赖世界状态连续性或语义检索，建议稍后重试状态回填或重新触发一次生成。
            </div>
            <ul class="ep-postgen-list">
              <li
                v-for="(issue, idx) in postGenerationIssues.issues"
                :key="`${issue.stage}-${idx}-${issue.message}`"
              >
                {{ issue.message }}
              </li>
            </ul>
          </n-alert>

          <div v-if="recoverySnapshot" class="recovery-banner">
            <ShieldAlert :size="16" />
            <div class="recovery-copy">
              <strong>发现未同步的本地草稿</strong>
              <span>保存于 {{ new Date(recoverySnapshot.savedAt).toLocaleString('zh-CN') }}</span>
            </div>
            <button type="button" @click="discardRecovery">忽略</button>
            <button type="button" class="primary" @click="restoreRecovery">恢复草稿</button>
          </div>

          <SimpleChapterEditor
            ref="editorRef"
            class="ep-editor"
            :style="{ fontFamily: currentEditorFont.fontFamily }"
            :chapter-id="currentChapter.id"
            :model-value="currentChapter.content ?? ''"
            :insertion-request="appStore.pendingChapterInsertion"
            @update:model-value="onChapterContentUpdate"
            @consume-insertion="appStore.consumeChapterInsertion"
            @selection-change="appStore.updateChapterSelection"
            @recovery-available="recoverySnapshot = $event"
          />
        </template>
      </div>
      </div>

      <QuickScrollBar
        ref="quickScrollRef"
        :visible="appStore.appSettings.editorMinimap"
        :scroll-container="scrollRef"
        @contextmenu="handleEditorContextMenu"
      />

      <!-- 回退悬浮按钮：正文左下角圆形按钮，不随正文滑动移动；设置持久化，软件重启后保持 -->
      <Transition name="arc-float-fade">
        <div
          v-if="appStore.appSettings.editorFloatUndo && currentChapter"
          class="ep-float-undo"
          @contextmenu.prevent="handleEditorContextMenu"
        >
          <button
            type="button"
            class="ep-float-undo-btn"
            :class="{ disabled: !canUndo }"
            :disabled="!canUndo"
            title="回退"
            @mousedown.prevent
            @click="runFloatUndo('undo')"
          >
            <Undo2 :size="16" />
          </button>
          <button
            type="button"
            class="ep-float-undo-btn"
            :class="{ disabled: !canRedo }"
            :disabled="!canRedo"
            title="撤销回退"
            @mousedown.prevent
            @click="runFloatUndo('redo')"
          >
            <Redo2 :size="16" />
          </button>
        </div>
      </Transition>
    </div>

    <EditorFindBar
      ref="findBarRef"
      :visible="findBarVisible"
      :editor="tiptapEditor"
      :initial-term="findInitialTerm"
      :scroll-container="scrollRef"
      @close="findBarVisible = false"
    />

    <EditorContextMenu
      :visible="ctxMenuVisible"
      :x="ctxMenuX"
      :y="ctxMenuY"
      :has-selection="ctxMenuHasSelection"
      :minimap-active="appStore.appSettings.editorMinimap"
      :float-undo-active="appStore.appSettings.editorFloatUndo"
      @close="ctxMenuVisible = false"
      @action="handleCtxAction"
    />

    <EditorCommandPalette
      :visible="commandPaletteVisible"
      :actions="commandPaletteActions"
      @close="commandPaletteVisible = false"
      @select="handleCommandSelect"
    />

    <Teleport to="body">
      <Transition name="arc-sel-fade">
        <div
          v-if="selToolbarVisible"
          class="arc-sel-toolbar"
          :style="{ top: selToolbarTop + 'px', left: selToolbarLeft + 'px' }"
        >
          <button class="arc-sel-btn" @click="handleSelAction('润色')">
            <Wand2 :size="12" /> 润色
          </button>
          <button class="arc-sel-btn" @click="handleSelAction('改写')">
            <RefreshCw :size="12" /> 改写
          </button>
          <button class="arc-sel-btn" @click="handleSelAction('扩写')">
            <Maximize2 :size="12" /> 扩写
          </button>
          <button class="arc-sel-btn" @click="handleSelAction('缩写')">
            <Minimize2 :size="12" /> 缩写
          </button>
          <span class="arc-sel-divider" />
          <button class="arc-sel-btn" @click="handleSelAction('问AI')">
            <MessageSquareQuote :size="12" /> 问 AI
          </button>
        </div>
      </Transition>
    </Teleport>

    <footer v-if="!focusMode && currentChapter" class="ep-status">
      <div class="stats-group">
        <span>字数 {{ wordCount.toLocaleString() }}</span>
        <span>第 {{ chapterIndex }} / {{ appStore.chapters.length }} 章</span>
      </div>
      <div class="progress-block">
        <span class="progress-label">本章目标 {{ targetWords.toLocaleString() }}</span>
        <div class="progress-bar">
          <div class="fill" :style="{ width: Math.min(100, progressPercent) + '%' }" />
        </div>
        <span class="progress-pct">{{ progressPercent }}%</span>
      </div>
    </footer>

    <ChapterVersionDialog
      v-model:show="versionDialogVisible"
      :chapter="currentChapter ?? null"
    />

    <!-- 章节内快速新建伏笔 -->
    <n-modal
      v-model:show="quickCreateThreadVisible"
      preset="card"
      :title="`在「${currentChapter?.title || '本章'}」中新建伏笔`"
      style="width: 520px"
      :mask-closable="false"
    >
      <n-form label-placement="top" :show-feedback="false" class="quick-thread-form">
        <n-form-item label="伏笔标题" required>
          <n-input v-model:value="quickThreadForm.title" placeholder="如：林莫的穿越遗物" maxlength="60" show-count />
        </n-form-item>
        <n-form-item label="伏笔描述">
          <n-input
            v-model:value="quickThreadForm.description"
            type="textarea"
            :rows="3"
            placeholder="描述这条伏笔的内容、背景或潜在影响"
          />
        </n-form-item>
        <n-form-item label="计划回收章节">
          <n-select
            v-model:value="quickThreadForm.plannedCloseChapterId"
            :options="quickChapterOptions"
            placeholder="选择计划回收的章节"
            clearable
            filterable
          />
        </n-form-item>
        <n-form-item label="优先级">
          <n-select
            v-model:value="quickThreadForm.priority"
            :options="[
              { label: '低', value: 'low' },
              { label: '中', value: 'medium' },
              { label: '高', value: 'high' }
            ]"
          />
        </n-form-item>
        <n-form-item label="标签">
          <n-dynamic-tags v-model:value="quickThreadForm.tags" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="quickThreadForm.remark" type="textarea" :rows="2" placeholder="可选补充说明" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="quick-thread-actions">
          <n-button
            type="info"
            secondary
            :loading="aiGeneratingThread"
            :disabled="aiGeneratingThread"
            @click="aiGenerateThread"
          >
            <template #icon><Sparkles :size="14" /></template>
            AI 生成伏笔
          </n-button>
          <n-button @click="quickCreateThreadVisible = false">取消</n-button>
          <n-button type="primary" @click="confirmQuickCreateThread">添加伏笔</n-button>
        </div>
      </template>
    </n-modal>
  </main>
</template>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--arc-bg-body);
  overflow: hidden;
  position: relative;
}

.recovery-banner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  margin: 12px 0 18px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--arc-warning) 34%, var(--arc-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--arc-warning) 6%, var(--arc-bg-surface));
  color: var(--arc-warning);
}

.recovery-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.recovery-copy strong {
  color: var(--arc-text-primary);
  font-size: 12px;
}

.recovery-copy span {
  color: var(--arc-text-hint);
  font-size: 11px;
}

.recovery-banner button {
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--arc-border);
  border-radius: 5px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 11px;
}

.recovery-banner button.primary {
  border-color: var(--arc-primary);
  background: var(--arc-primary);
  color: white;
}

.ep-header {
  height: 44px;
  flex-shrink: 0;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--arc-bg-surface);
  border-bottom: 1px solid var(--arc-border);
  overflow: hidden;
  min-width: 0;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.breadcrumb svg {
  flex-shrink: 0;
  color: var(--arc-text-hint);
}

.crumb-volume {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
  max-width: 40%;
}

.crumb-current {
  color: var(--arc-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.ep-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
}

.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--arc-text-hint);
  white-space: nowrap;
}

.save-label {
  white-space: nowrap;
}

.btn-label {
  display: inline-block;
  white-space: nowrap;
}

/* 窗口变窄时：已保存文字隐藏、生成初稿→初稿、新建伏笔→伏笔、AI 助理→AI */
@media (max-width: 1500px) {
  .save-label {
    display: none;
  }
  .save-indicator {
    gap: 4px;
  }
}
@media (max-width: 1320px) {
  .btn-label[data-full="生成初稿"] { font-size: 0; }
  .btn-label[data-full="生成初稿"]::before { content: "初稿"; font-size: 12px; }
  .btn-label[data-full="新建伏笔"] { font-size: 0; }
  .btn-label[data-full="新建伏笔"]::before { content: "伏笔"; font-size: 12px; }
  .btn-label[data-full="AI 助理"] { font-size: 0; }
  .btn-label[data-full="AI 助理"]::before { content: "AI"; font-size: 12px; }
}
@media (max-width: 1180px) {
  .font-picker-label { display: none; }
  .font-picker-tool { min-width: 0; }
}
@media (max-width: 1080px) {
  .font-stepper { display: none; }
  .crumb-volume { max-width: 30%; }
}

.save-indicator .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-success);
}

.save-indicator .dot.pending {
  background: var(--arc-warning);
}

.save-indicator .dot.failed {
  background: var(--arc-danger);
}

.divider {
  width: 1px;
  height: 18px;
  background: var(--arc-border);
  margin: 0 4px;
}

.font-stepper {
  display: inline-flex;
  align-items: center;
  background: var(--arc-bg-surface-hover);
  border-radius: var(--arc-radius-sm);
  padding: 2px;
  gap: 2px;
}

.font-picker-tool {
  min-width: 68px;
  justify-content: center;
  white-space: nowrap;
}

.font-picker-label {
  min-width: 24px;
  text-align: center;
}

.font-stepper button {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.font-stepper button:hover {
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
}

.font-stepper .level {
  font-size: 11px;
  color: var(--arc-text-secondary);
  padding: 0 4px;
  min-width: 30px;
  text-align: center;
  cursor: text;
}

.font-stepper .level-input {
  width: 42px;
  font-size: 11px;
  color: var(--arc-text-primary);
  text-align: center;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-primary);
  border-radius: 4px;
  padding: 1px 2px;
  outline: none;
  -moz-appearance: textfield;
}

.font-stepper .level-input::-webkit-outer-spin-button,
.font-stepper .level-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.toolbtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--arc-radius-sm);
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: var(--arc-text-secondary);
  background: transparent;
  transition: 0.15s;
  flex-shrink: 0;
  white-space: nowrap;
}

.toolbtn:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.toolbtn.primary {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.toolbtn.primary:hover {
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-surface));
}

.toolbtn.active {
  background: var(--arc-primary);
  color: white;
}

.toolbtn.active:hover {
  background: var(--arc-primary-hover);
  color: white;
}

.ep-scroll {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 48px 0 96px;
  min-height: 0;
}

.ep-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
}

/* 回退悬浮按钮：固定在正文左下角（字数显示上方），不随正文滚动 */
.ep-float-undo {
  position: absolute;
  left: 20px;
  bottom: 16px;
  z-index: 30;
  display: flex;
  gap: 10px;
  pointer-events: none;
}

.ep-float-undo-btn {
  pointer-events: auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  transition: background 0.15s, color 0.15s, transform 0.1s;
}

.ep-float-undo-btn:hover:not(.disabled) {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.ep-float-undo-btn:active:not(.disabled) {
  transform: scale(0.94);
}

.ep-float-undo-btn.disabled {
  color: var(--arc-text-hint);
  cursor: not-allowed;
  opacity: 0.5;
}

.arc-float-fade-enter-active,
.arc-float-fade-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.arc-float-fade-enter-from,
.arc-float-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.ep-canvas {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 56px;
}

.ep-title {
  font-size: 32px;
  font-weight: 700;
  border: none;
  outline: none;
  width: 100%;
  color: var(--arc-text-primary);
  background: transparent;
  letter-spacing: -0.025em;
  margin-bottom: 12px;
  line-height: 1.25;
}

.ep-title::placeholder {
  color: var(--arc-text-hint);
}

.ep-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--arc-border);
  font-size: 12px;
  color: var(--arc-text-secondary);
  flex-wrap: wrap;
}

.target-words-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.summary-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, transform 0.2s;
}

.summary-toggle:hover {
  color: var(--arc-text-primary);
  border-color: var(--arc-border-strong);
}

.summary-toggle.expanded {
  transform: rotate(180deg);
  color: var(--arc-primary);
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
}

.meta-summary {
  margin-bottom: 16px;
  padding: 10px 12px;
  border-left: 3px solid color-mix(in srgb, var(--arc-primary) 45%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.meta-summary-label {
  display: block;
  margin-bottom: 2px;
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
}

.ep-editor {
  background: transparent;
}

.ep-postgen-alert {
  margin-bottom: 20px;
}

.ep-postgen-copy {
  font-size: 12px;
  line-height: 1.65;
}

.ep-postgen-list {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.65;
}

.ep-empty {
  text-align: center;
  padding: 80px 0;
  color: var(--arc-text-hint);
  font-size: 14px;
}

.ep-status {
  height: 32px;
  flex-shrink: 0;
  padding: 0 16px;
  background: var(--arc-bg-surface);
  border-top: 1px solid var(--arc-border);
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 11px;
  color: var(--arc-text-hint);
}

.stats-group {
  display: flex;
  gap: 12px;
}

.progress-block {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.progress-label {
  color: var(--arc-text-secondary);
  white-space: nowrap;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--arc-bg-surface-hover);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, var(--arc-success), var(--arc-primary));
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-pct {
  color: var(--arc-text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.quick-thread-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quick-thread-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

</style>

<style>
.arc-sel-toolbar {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: #1D1D1F;
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  z-index: 9999;
  transform: translateX(-50%);
  pointer-events: auto;
}

.arc-sel-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: white;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: 0.15s;
  white-space: nowrap;
}

.arc-sel-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.arc-sel-divider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 2px;
  flex-shrink: 0;
}

.arc-sel-fade-enter-active,
.arc-sel-fade-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.arc-sel-fade-enter-from,
.arc-sel-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}

</style>
