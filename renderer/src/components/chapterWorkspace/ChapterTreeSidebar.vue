<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, ChevronDown, ChevronsDownUp, FilePlus, FileText, FolderPlus, GripVertical, MoreVertical, Plus, Search } from 'lucide-vue-next'
import { NButton, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, NTag, NTooltip, useDialog, useMessage } from 'naive-ui'
import ChapterMetaDialog from './ChapterMetaDialog.vue'
import { useAppStore } from '@/stores/app'
import { formatVolumeLabel, normalizeVolumeWordTarget } from '@/features/workspace/outlineVolumes'
import { getChapterCharacterCount, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import type { OutlineDropPosition } from '@/features/workspace/outlineReorder'
import type { ChapterDraft, OutlineItem, OutlineVolume } from '@/types/app'
import type { DropdownOption, SelectOption } from 'naive-ui'
import { toIpcPayload } from '@/utils/ipcPayload'

const emit = defineEmits<{
  navigate: []
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

const keyword = ref('')
const collapsed = reactive<Record<string, boolean>>({})
const draggingChapterId = ref<string | null>(null)
const dragTargetChapterId = ref<string | null>(null)
const dragTargetPosition = ref<OutlineDropPosition | null>(null)
const dragTargetVolumeId = ref<string | null>(null)
const draggingVolumeId = ref<string | null>(null)
const volumeDragTargetId = ref<string | null>(null)
const volumeDragTargetPosition = ref<OutlineDropPosition | null>(null)

const metaDialogVisible = ref(false)
const metaDialogChapter = ref<ChapterDraft | null>(null)
const volumeDialogVisible = ref(false)
const editingVolumeId = ref<string | null>(null)
const createDialogVisible = ref(false)
const createForm = reactive({
  volumeId: '',
  outlineItemId: '',
  title: ''
})
const volumeForm = reactive({
  bindVolumeId: '',
  title: '',
  wordTarget: '',
  summary: ''
})

// ── 本地文件导入（新建章节 / 新建分卷）──
const importingVolumeFile = ref(false)
const importingChapterFile = ref(false)
// 新建章节时导入的文件内容缓存（用于创建后写入正文与生成摘要）
const importedChapterContent = ref('')
const importedChapterCharCount = ref(0)
const isGeneratingImportedSummary = ref(false)

/** 读取本地文件并做基本解析（标题取文件名，若为数字则按第 X 章命名） */
async function pickImportFile(): Promise<{
  fileName: string
  title: string
  content: string
  charCount: number
} | null> {
  const result = await window.characterArc.pickChapterImportFile()
  if (result.canceled || !result.file) {
    return null
  }
  if (!result.success) {
    message.error(result.error ?? '读取文件失败')
    return null
  }
  return result.file
}

/** 根据文件名推断标题：纯数字名视为“第X章”，否则用文件名 */
function resolveImportedTitle(fileName: string, content: string, fallbackIndex: number): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim() || fileName.trim()
  if (/^\d+$/.test(base)) {
    return `第${base}章：导入章节`
  }
  return base || `第${fallbackIndex}章：导入章节`
}

/** 调用 AI 为导入文本生成摘要 */
async function generateImportSummary(content: string, title: string): Promise<string> {
  const plainContent = content.trim()
  if (!plainContent) {
    return ''
  }
  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: 'import-file-summary',
        kind: 'chapter-summary',
        label: 'AI 生成导入摘要',
        description: `正在为《${title}》提炼摘要`,
        panel: 'chapters',
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'chapter-summarize',
          settings: appStore.appSettings,
          context: {
            chapterTitle: title,
            chapterContent: plainContent.slice(0, 12000)
          }
        }))
    )
    if (!result.success || !result.result) {
      return ''
    }
    const text = String(
      result.result && typeof result.result === 'object'
        ? (result.result as Record<string, unknown>).content ?? ''
        : ''
    ).trim()
    return text || ''
  } catch {
    return ''
  }
}

/** 新建分卷：从本地文件导入标题与摘要 */
async function handleImportVolumeFile(): Promise<void> {
  if (importingVolumeFile.value) return
  importingVolumeFile.value = true
  try {
    const file = await pickImportFile()
    if (!file) return
    volumeForm.title = resolveImportedTitle(file.fileName, file.content, appStore.outlineVolumes.length + 1)
    volumeForm.wordTarget = String(file.charCount)
    isGeneratingImportedSummary.value = true
    try {
      const summary = await generateImportSummary(file.content, volumeForm.title)
      volumeForm.summary = summary || file.content.slice(0, 120)
      message.success('已从文件导入，并生成摘要')
    } finally {
      isGeneratingImportedSummary.value = false
    }
  } finally {
    importingVolumeFile.value = false
  }
}

/** 新建章节：从本地文件导入标题与正文，创建时写入正文与摘要 */
async function handleImportChapterFile(): Promise<void> {
  if (importingChapterFile.value) return
  importingChapterFile.value = true
  try {
    const file = await pickImportFile()
    if (!file) return
    importedChapterContent.value = file.content
    importedChapterCharCount.value = file.charCount
    createForm.title = resolveImportedTitle(file.fileName, file.content, appStore.chapters.length + 1)
    message.success(`已从文件导入（${file.charCount.toLocaleString()} 字），创建章节时将自动写入正文并生成摘要`)
  } finally {
    importingChapterFile.value = false
  }
}

const chapterMenuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑章节信息' },
  { key: 'export-txt', label: '导出 TXT' },
  { key: 'delete', label: '删除章节' }
]

const volumeMenuOptions = computed<DropdownOption[]>(() => [
  { key: 'edit', label: '编辑分卷信息' },
  { key: 'delete', label: '删除分卷' }
])

const filteredGroups = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return appStore.chapterVolumeGroups
  return appStore.chapterVolumeGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((c) =>
        `${c.title} ${c.summary} ${c.status}`.toLowerCase().includes(query)
      )
    }))
    .filter((group) => group.items.length > 0)
})

const totalVisible = computed(() =>
  filteredGroups.value.reduce((n, g) => n + g.items.length, 0)
)

const totalWords = computed(() =>
  appStore.chapters.reduce((n, c) => n + getChapterCharacterCount(c.content), 0)
)

type ChapterTreeGroup = (typeof appStore.chapterVolumeGroups)[number]
type ChapterTreeRow =
  | { key: string; kind: 'volume'; group: ChapterTreeGroup }
  | { key: string; kind: 'chapter'; group: ChapterTreeGroup; chapter: ChapterDraft }
  | { key: string; kind: 'add'; group: ChapterTreeGroup }

const TREE_ROW_HEIGHT = 40
const TREE_OVERSCAN = 8
const treeScrollRef = ref<HTMLDivElement | null>(null)
const treeScrollTop = ref(0)
const treeViewportHeight = ref(0)
let treeResizeObserver: ResizeObserver | null = null

const treeRows = computed<ChapterTreeRow[]>(() => {
  const rows: ChapterTreeRow[] = []
  for (const group of filteredGroups.value) {
    rows.push({ key: `volume:${group.volume.id}`, kind: 'volume', group })
    if (collapsed[group.volume.id]) continue
    for (const chapter of group.items) {
      rows.push({ key: `chapter:${chapter.id}`, kind: 'chapter', group, chapter })
    }
    rows.push({ key: `add:${group.volume.id}`, kind: 'add', group })
  }
  return rows
})

const virtualTreeWindow = computed(() => {
  const total = treeRows.value.length
  const start = Math.max(0, Math.floor(treeScrollTop.value / TREE_ROW_HEIGHT) - TREE_OVERSCAN)
  const visibleCount = Math.ceil(treeViewportHeight.value / TREE_ROW_HEIGHT) + TREE_OVERSCAN * 2
  const end = Math.min(total, start + Math.max(visibleCount, TREE_OVERSCAN * 2))
  return {
    rows: treeRows.value.slice(start, end),
    top: start * TREE_ROW_HEIGHT,
    bottom: Math.max(0, (total - end) * TREE_ROW_HEIGHT)
  }
})

function syncTreeViewport(): void {
  const el = treeScrollRef.value
  if (!el) return
  treeScrollTop.value = el.scrollTop
  treeViewportHeight.value = el.clientHeight
}

function handleTreeScroll(event: Event): void {
  treeScrollTop.value = (event.currentTarget as HTMLDivElement).scrollTop
}

const allCollapsed = computed(() =>
  appStore.outlineVolumes.length > 0 && appStore.outlineVolumes.every((v) => collapsed[v.id])
)

const createVolumeOptions = computed<SelectOption[]>(() =>
  appStore.outlineVolumes.map((volume, index) => ({
    label: formatVolumeLabel(volume, index, 'formal'),
    value: volume.id
  }))
)

const bindVolumeOptions = computed<SelectOption[]>(() => [
  { label: '新建一条分卷信息', value: '' },
  ...createVolumeOptions.value
])

const createOutlineOptions = computed<SelectOption[]>(() => {
  const targetVolumeId = createForm.volumeId
  if (!targetVolumeId) return []
  const items = appStore.outlineItems.filter((item) => !targetVolumeId || item.volumeId === targetVolumeId)
  return items.map((item) => {
    const linkedCount = appStore.chapters.filter((chapter) => chapter.outlineItemId === item.id).length
    return {
      label: linkedCount > 0 ? `${item.title} · 已关联 ${linkedCount} 章，可继续绑定` : item.title,
      value: item.id
    }
  })
})

const selectedCreateOutline = computed<OutlineItem | null>(() =>
  appStore.outlineItems.find((item) => item.id === createForm.outlineItemId && item.volumeId === createForm.volumeId) ?? null
)

watch(
  () => createForm.volumeId,
  (volumeId) => {
    const firstOutline = appStore.outlineItems.find((item) => item.volumeId === volumeId)
    createForm.outlineItemId = firstOutline?.id ?? ''
    createForm.title = firstOutline?.title ?? ''
  }
)

watch(
  () => createForm.outlineItemId,
  () => {
    const item = selectedCreateOutline.value
    if (!item) return
    createForm.title = item.title
  }
)

watch(
  () => treeRows.value.length,
  () => {
    requestAnimationFrame(() => {
      const el = treeScrollRef.value
      if (!el) return
      const maxScroll = Math.max(0, treeRows.value.length * TREE_ROW_HEIGHT - el.clientHeight)
      if (el.scrollTop > maxScroll) el.scrollTop = maxScroll
      syncTreeViewport()
    })
  }
)

watch(
  () => appStore.selectedChapterId,
  (chapterId) => {
    requestAnimationFrame(() => {
      const el = treeScrollRef.value
      if (!el) return
      const index = treeRows.value.findIndex((row) => row.kind === 'chapter' && row.chapter.id === chapterId)
      if (index < 0) return
      const top = index * TREE_ROW_HEIGHT
      const bottom = top + TREE_ROW_HEIGHT
      if (top < el.scrollTop) el.scrollTop = top
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    })
  }
)

onMounted(() => {
  syncTreeViewport()
  treeResizeObserver = new ResizeObserver(syncTreeViewport)
  if (treeScrollRef.value) treeResizeObserver.observe(treeScrollRef.value)
})

onBeforeUnmount(() => {
  treeResizeObserver?.disconnect()
})

function toggleVolume(id: string): void {
  collapsed[id] = !collapsed[id]
}

function toggleCollapseAll(): void {
  const next = !allCollapsed.value
  for (const v of appStore.outlineVolumes) collapsed[v.id] = next
}

function readDraggedChapterId(event: DragEvent): string {
  const dataStr = event.dataTransfer?.getData('text/plain') ?? ''
  return dataStr.trim()
}

function readDraggedVolumeId(event: DragEvent): string {
  const dataStr = event.dataTransfer?.getData('text/plain') ?? ''
  return dataStr.trim()
}

function resolveDropPosition(event: DragEvent): OutlineDropPosition {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function autoScrollDragContainer(event: DragEvent): void {
  const container = (event.currentTarget as HTMLElement).closest('.ts-scroll')
  if (!(container instanceof HTMLElement)) {
    return
  }

  const rect = container.getBoundingClientRect()
  const edgeSize = Math.min(56, rect.height / 4)
  const maxStep = 14
  if (event.clientY < rect.top + edgeSize) {
    const intensity = (rect.top + edgeSize - event.clientY) / edgeSize
    container.scrollBy({ top: -Math.ceil(maxStep * intensity) })
  } else if (event.clientY > rect.bottom - edgeSize) {
    const intensity = (event.clientY - (rect.bottom - edgeSize)) / edgeSize
    container.scrollBy({ top: Math.ceil(maxStep * intensity) })
  }
}

function handleChapterDragStart(chapterId: string, event: DragEvent): void {
  draggingChapterId.value = chapterId
  dragTargetChapterId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = null
  resetVolumeDragState()

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', chapterId)
    const dragImage = (event.currentTarget as HTMLElement).closest('.chapter-row')
    if (dragImage instanceof HTMLElement) {
      event.dataTransfer.setDragImage(dragImage, 24, 18)
    }
  }
}

function handleVolumeDragStart(volumeId: string, event: DragEvent): void {
  draggingVolumeId.value = volumeId
  volumeDragTargetId.value = null
  volumeDragTargetPosition.value = null
  draggingChapterId.value = null
  dragTargetChapterId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = null

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', volumeId)
    const dragImage = (event.currentTarget as HTMLElement).closest('.volume-head')
    if (dragImage instanceof HTMLElement) {
      event.dataTransfer.setDragImage(dragImage, 24, 14)
    }
  }
}

function handleChapterDragOver(chapterId: string, event: DragEvent): void {
  if (!draggingChapterId.value || draggingChapterId.value === chapterId) {
    return
  }

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  autoScrollDragContainer(event)
  dragTargetChapterId.value = chapterId
  dragTargetPosition.value = resolveDropPosition(event)
  dragTargetVolumeId.value = null
}

function handleChapterDragLeave(chapterId: string, event: DragEvent): void {
  const currentTarget = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return
  }
  if (dragTargetChapterId.value === chapterId) {
    dragTargetChapterId.value = null
    dragTargetPosition.value = null
  }
}

function handleChapterDrop(chapterId: string, event: DragEvent): void {
  event.preventDefault()
  const draggedChapterId = readDraggedChapterId(event)

  if (!draggedChapterId || draggedChapterId === chapterId) {
    resetChapterDragState()
    return
  }

  const position = dragTargetChapterId.value === chapterId && dragTargetPosition.value
    ? dragTargetPosition.value
    : resolveDropPosition(event)
  appStore.moveChapter(draggedChapterId, chapterId, position)
  resetChapterDragState()
}

function handleVolumeDragOver(volumeId: string, event: DragEvent): void {
  if (draggingVolumeId.value) {
    if (draggingVolumeId.value === volumeId) {
      return
    }

    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    autoScrollDragContainer(event)
    volumeDragTargetId.value = volumeId
    volumeDragTargetPosition.value = resolveDropPosition(event)
    dragTargetVolumeId.value = null
    return
  }

  if (!draggingChapterId.value) {
    return
  }

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  autoScrollDragContainer(event)
  dragTargetChapterId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = volumeId
}

function handleVolumeDragLeave(volumeId: string, event: DragEvent): void {
  const currentTarget = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return
  }
  if (dragTargetVolumeId.value === volumeId) {
    dragTargetVolumeId.value = null
  }
  if (volumeDragTargetId.value === volumeId) {
    volumeDragTargetId.value = null
    volumeDragTargetPosition.value = null
  }
}

function handleDropOnVolume(volumeId: string, event: DragEvent): void {
  event.preventDefault()
  if (draggingVolumeId.value) {
    const draggedVolumeId = readDraggedVolumeId(event)

    if (!draggedVolumeId || draggedVolumeId === volumeId) {
      resetVolumeDragState()
      return
    }

    const position = volumeDragTargetId.value === volumeId && volumeDragTargetPosition.value
      ? volumeDragTargetPosition.value
      : resolveDropPosition(event)
    appStore.moveOutlineVolume(draggedVolumeId, volumeId, position)
    resetVolumeDragState()
    return
  }

  const draggedChapterId = readDraggedChapterId(event)

  if (!draggedChapterId) {
    resetChapterDragState()
    return
  }

  appStore.moveChaptersToVolumeEnd([draggedChapterId], volumeId)
  resetChapterDragState()
}

function resetChapterDragState(): void {
  draggingChapterId.value = null
  dragTargetChapterId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = null
}

function resetVolumeDragState(): void {
  draggingVolumeId.value = null
  volumeDragTargetId.value = null
  volumeDragTargetPosition.value = null
}

function allowDigitsOnly(value: string): boolean {
  return /^\d*$/.test(value)
}

function openVolumeDialog(volume?: OutlineVolume): void {
  editingVolumeId.value = volume?.id ?? null
  volumeForm.bindVolumeId = ''
  volumeForm.title = volume?.title ?? ''
  volumeForm.wordTarget = normalizeVolumeWordTarget(volume?.wordTarget) || '50000'
  volumeForm.summary = volume?.summary ?? ''
  volumeDialogVisible.value = true
}

function closeVolumeDialog(): void {
  volumeDialogVisible.value = false
}

function handleBindVolumeChange(volumeId: string): void {
  volumeForm.bindVolumeId = volumeId
  if (!volumeId) {
    volumeForm.title = ''
    volumeForm.wordTarget = '50000'
    volumeForm.summary = ''
    return
  }

  const volume = appStore.outlineVolumes.find((item) => item.id === volumeId)
  if (!volume) return
  volumeForm.title = volume.title
  volumeForm.wordTarget = normalizeVolumeWordTarget(volume.wordTarget) || '50000'
  volumeForm.summary = volume.summary
}

function submitVolume(): void {
  if (!volumeForm.title.trim()) {
    message.warning('请填写分卷标题')
    return
  }

  const payload = {
    title: volumeForm.title,
    wordTarget: normalizeVolumeWordTarget(volumeForm.wordTarget),
    summary: volumeForm.summary
  }

  if (editingVolumeId.value) {
    appStore.updateOutlineVolume(editingVolumeId.value, payload)
    message.success('分卷信息已更新')
  } else if (volumeForm.bindVolumeId) {
    appStore.updateOutlineVolume(volumeForm.bindVolumeId, payload)
    collapsed[volumeForm.bindVolumeId] = false
    message.success('已绑定大纲分卷信息')
  } else {
    const volumeId = appStore.createOutlineVolume(payload)
    collapsed[volumeId] = false
    message.success('已新建分卷信息')
  }

  closeVolumeDialog()
}

function handleDeleteVolume(volume: OutlineVolume): void {
  const volumeIndex = appStore.outlineVolumes.findIndex((item) => item.id === volume.id)
  const remainingVolumes = appStore.outlineVolumes.filter((item) => item.id !== volume.id)
  const fallbackVolume = remainingVolumes[Math.max(0, volumeIndex - 1)] ?? remainingVolumes[0]
  const chapterCount = appStore.chapters.filter((chapter) => chapter.volumeId === volume.id).length
  const outlineCount = appStore.outlineItems.filter((item) => item.volumeId === volume.id).length
  const fallbackTitle = fallbackVolume?.title ? `「${fallbackVolume.title}」` : '相邻分卷'
  const isLastVolume = remainingVolumes.length === 0
  const moveTarget = isLastVolume ? '转为未分卷' : `移至${fallbackTitle}`

  dialog.warning({
    title: '确认删除分卷',
    content: `确定要删除"${volume.title}"吗？该分卷下的 ${chapterCount} 个章节和 ${outlineCount} 个大纲节点会${moveTarget}，分卷级创作记忆将一并删除。${isLastVolume ? '删除后分卷将清空。' : ''}`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteOutlineVolume(volume.id)
      message.success('分卷已删除')
    }
  })
}

function handleVolumeMenuSelect(key: string | number, volume: OutlineVolume): void {
  if (key === 'edit') {
    openVolumeDialog(volume)
    return
  }

  if (key === 'delete') {
    handleDeleteVolume(volume)
  }
}

function openCreateDialog(volumeId?: string): void {
  const targetVolumeId = volumeId ?? ''
  const firstOutline = targetVolumeId
    ? appStore.outlineItems.find((item) => item.volumeId === targetVolumeId)
    : null
  createForm.volumeId = targetVolumeId
  createForm.outlineItemId = firstOutline?.id ?? ''
  createForm.title = firstOutline?.title ?? ''
  createDialogVisible.value = true
}

function closeCreateDialog(): void {
  createDialogVisible.value = false
}

function submitCreateChapter(): void {
  if (!createForm.volumeId) {
    message.warning('请先选择所属分卷')
    return
  }

  // 从本地文件导入的章节：创建独立章节并写入正文与摘要
  const hasImportedContent = importedChapterContent.value.trim().length > 0
  if (hasImportedContent) {
    if (!createForm.title.trim()) {
      message.warning('请填写章节标题')
      return
    }
    appStore.createChapter(createForm.volumeId)
    const chapterId = appStore.selectedChapterId
    appStore.updateChapter(chapterId, {
      title: createForm.title.trim(),
      content: importedChapterContent.value,
      summary: importedChapterContent.value.slice(0, 120)
    })
    void (async () => {
      const summary = await generateImportSummary(importedChapterContent.value, createForm.title.trim())
      if (summary) {
        appStore.updateChapter(chapterId, { summary })
      }
    })()
    importedChapterContent.value = ''
    importedChapterCharCount.value = 0
    message.success('已从文件新建章节')
    closeCreateDialog()
    emit('navigate')
    return
  }

  const item = selectedCreateOutline.value
  if (!item) {
    message.warning('请先选择要绑定的大纲节点')
    return
  }
  if (!createForm.title.trim()) {
    message.warning('请填写章节标题')
    return
  }

  appStore.createChapterFromOutlineItem(item)
  appStore.updateChapter(appStore.selectedChapterId, {
    title: createForm.title.trim()
  })
  appStore.updateOutlineItem(item.id, {
    status: item.status === 'done' ? 'done' : 'drafting'
  })
  message.success('已根据大纲新建章节')
  closeCreateDialog()
  emit('navigate')
}

function formatStatus(status: ChapterDraft['status']): string {
  switch (status) {
    case 'final': return '已定稿'
    case 'polish': return '待润色'
    case 'review': return '待检查'
    default: return '草稿'
  }
}

function statusType(status: ChapterDraft['status']): 'default' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'final': return 'success'
    case 'polish': return 'info'
    case 'review': return 'warning'
    default: return 'default'
  }
}

function buildChapterExportFileName(chapter: ChapterDraft): string {
  const safeTitle = (chapter.title?.trim() || '未命名章节')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
  return `${safeTitle}.txt`
}

async function handleExportChapterTxt(chapter: ChapterDraft): Promise<void> {
  const result = await window.characterArc.exportChapterTxt(toIpcPayload({
    title: chapter.title,
    content: getPlainTextFromEditorContent(chapter.content ?? ''),
    defaultFileName: buildChapterExportFileName(chapter)
  }))

  if (result.success) {
    message.success(`已导出《${chapter.title || '未命名章节'}》TXT`)
    return
  }

  if (!result.canceled) {
    message.error(result.error ?? '导出章节 TXT 失败')
  }
}

function handleMenuSelect(key: string | number, chapter: ChapterDraft): void {
  if (key === 'edit') {
    metaDialogChapter.value = chapter
    metaDialogVisible.value = true
    return
  }
  if (key === 'export-txt') {
    void handleExportChapterTxt(chapter)
    return
  }
  if (key === 'delete') {
    dialog.warning({
      title: '确认删除章节',
      content: `确定要删除"${chapter.title}"吗？删除后当前章节草稿将无法恢复。`,
      positiveText: '确认删除',
      negativeText: '取消',
      autoFocus: false,
      closable: false,
      onPositiveClick: () => appStore.deleteChapter(chapter.id)
    })
  }
}
</script>

<template>
  <aside class="tree-sidebar">
    <header class="ts-header">
      <div class="project-name">
        <span class="dot" />
        {{ appStore.currentProject?.title || '未命名项目' }}
      </div>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn" @click="appStore.backToWorkbench()">
            <ArrowLeft :size="14" />
          </button>
        </template>
        返回工作台
      </n-tooltip>
    </header>

    <div class="ts-toolbar">
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="openVolumeDialog()"><FolderPlus :size="14" /></button>
        </template>
        新建分卷信息
      </n-tooltip>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="openCreateDialog()"><FilePlus :size="14" /></button>
        </template>
        新建章节
      </n-tooltip>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="toggleCollapseAll">
            <ChevronsDownUp :size="14" />
          </button>
        </template>
        {{ allCollapsed ? '展开全部' : '折叠全部' }}
      </n-tooltip>
    </div>

    <div class="ts-search">
      <Search :size="12" />
      <input v-model="keyword" placeholder="搜索章节..." />
    </div>

    <div ref="treeScrollRef" class="ts-scroll arc-scrollbar" @scroll="handleTreeScroll">
      <div :style="{ height: virtualTreeWindow.top + 'px' }" aria-hidden="true" />
      <template v-for="row in virtualTreeWindow.rows" :key="row.key">
        <section
          v-if="row.kind === 'volume'"
          class="volume virtual-tree-row"
          :class="{
            collapsed: collapsed[row.group.volume.id],
            'drop-target': dragTargetVolumeId === row.group.volume.id,
            'volume-dragging': draggingVolumeId === row.group.volume.id,
            'volume-drop-before': volumeDragTargetId === row.group.volume.id && volumeDragTargetPosition === 'before',
            'volume-drop-after': volumeDragTargetId === row.group.volume.id && volumeDragTargetPosition === 'after'
          }"
          @dragover="handleVolumeDragOver(row.group.volume.id, $event)"
          @dragleave="handleVolumeDragLeave(row.group.volume.id, $event)"
          @drop="handleDropOnVolume(row.group.volume.id, $event)"
        >
        <button class="volume-head" @click="toggleVolume(row.group.volume.id)">
          <span
            class="volume-grip"
            draggable="true"
            title="拖动分卷排序"
            aria-label="拖动分卷排序"
            @click.stop
            @dragstart.stop="handleVolumeDragStart(row.group.volume.id, $event)"
            @dragend.stop="resetVolumeDragState"
          >
            <GripVertical :size="12" />
          </span>
          <ChevronDown :size="13" class="chevron" />
          <span class="volume-title">{{ formatVolumeLabel(row.group.volume, row.group.index, 'compact') }}</span>
          <span
            v-if="volumeDragTargetId === row.group.volume.id && volumeDragTargetPosition"
            class="volume-drop-label"
          >
            {{ volumeDragTargetPosition === 'before' ? '移到卷前' : '移到卷后' }}
          </span>
          <span v-if="dragTargetVolumeId === row.group.volume.id" class="volume-drop-label">放到卷末</span>
          <span class="volume-meta">{{ row.group.items.length }}</span>
          <n-dropdown :options="volumeMenuOptions" placement="bottom-end" @select="(k) => handleVolumeMenuSelect(k, row.group.volume)">
            <span class="volume-more" @click.stop>
              <MoreVertical :size="12" />
            </span>
          </n-dropdown>
        </button>
        </section>

        <div v-else-if="row.kind === 'chapter'" class="chapter-list virtual-tree-row">
          <button
            class="chapter-row"
            :class="{
              active: appStore.selectedChapterId === row.chapter.id,
              dragging: draggingChapterId === row.chapter.id,
              'drop-before': dragTargetChapterId === row.chapter.id && dragTargetPosition === 'before',
              'drop-after': dragTargetChapterId === row.chapter.id && dragTargetPosition === 'after'
            }"
            @click="appStore.selectChapter(row.chapter.id); emit('navigate')"
            @dragover.stop="draggingVolumeId ? handleVolumeDragOver(row.group.volume.id, $event) : handleChapterDragOver(row.chapter.id, $event)"
            @dragleave.stop="draggingVolumeId ? handleVolumeDragLeave(row.group.volume.id, $event) : handleChapterDragLeave(row.chapter.id, $event)"
            @drop.stop="draggingVolumeId ? handleDropOnVolume(row.group.volume.id, $event) : handleChapterDrop(row.chapter.id, $event)"
          >
            <span
              class="chap-grip"
              draggable="true"
              title="拖动排序"
              aria-label="拖动排序"
              @click.stop
              @dragstart.stop="handleChapterDragStart(row.chapter.id, $event)"
              @dragend.stop="resetChapterDragState"
            >
              <GripVertical :size="13" />
            </span>
            <FileText :size="13" class="chap-icon" />
            <span class="chap-title">{{ row.chapter.title }}</span>
            <n-tag size="tiny" :type="statusType(row.chapter.status)" :bordered="false">
              {{ formatStatus(row.chapter.status) }}
            </n-tag>
            <n-dropdown :options="chapterMenuOptions" placement="bottom-end" @select="(k) => handleMenuSelect(k, row.chapter)">
              <span class="chap-more" @click.stop>
                <MoreVertical :size="12" />
              </span>
            </n-dropdown>
          </button>
        </div>

        <div v-else class="chapter-list virtual-tree-row">
          <button class="chapter-add" @click="openCreateDialog(row.group.volume.id)">
            <Plus :size="12" /> 新增章节
          </button>
        </div>
      </template>
      <div :style="{ height: virtualTreeWindow.bottom + 'px' }" aria-hidden="true" />
    </div>

    <footer class="ts-footer">
      <span>{{ totalVisible }} / {{ appStore.chapters.length }} 章 · {{ totalWords.toLocaleString() }} 字</span>
    </footer>

    <ChapterMetaDialog
      v-model:show="metaDialogVisible"
      :chapter="metaDialogChapter"
    />

    <NModal
      v-model:show="volumeDialogVisible"
      preset="card"
      :title="editingVolumeId ? '编辑分卷信息' : '新建分卷信息'"
      :style="{ width: 'min(560px, 92vw)' }"
      :bordered="false"
    >
      <NForm label-placement="top">
        <NFormItem v-if="!editingVolumeId" label="绑定大纲分卷信息">
          <NSelect
            :value="volumeForm.bindVolumeId"
            :options="bindVolumeOptions"
            placeholder="选择已有大纲分卷，或保持新建"
            filterable
            @update:value="handleBindVolumeChange"
          />
        </NFormItem>
        <NFormItem label="分卷标题">
          <NInput v-model:value="volumeForm.title" placeholder="例如：霓虹下的老鼠" />
          <template #feedback>
            <NButton
              size="tiny"
              secondary
              :loading="importingVolumeFile"
              @click="handleImportVolumeFile"
            >
              <template #icon><FilePlus :size="12" /></template>
              从本地文件导入（txt / md）
            </NButton>
            <span v-if="isGeneratingImportedSummary" class="import-summary-hint">正在用 AI 生成摘要…</span>
          </template>
        </NFormItem>
        <NFormItem label="目标字数">
          <NInput v-model:value="volumeForm.wordTarget" placeholder="例如：50000" :allow-input="allowDigitsOnly">
            <template #suffix>字</template>
          </NInput>
        </NFormItem>
        <NFormItem label="分卷摘要">
          <NInput
            v-model:value="volumeForm.summary"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="概括这一卷的主线、冲突和情绪走向..."
          />
        </NFormItem>
      </NForm>

      <template #footer>
        <div class="create-actions">
          <NButton round strong @click="closeVolumeDialog">取消</NButton>
          <NButton type="primary" round strong @click="submitVolume">
            {{ editingVolumeId ? '保存分卷信息' : (volumeForm.bindVolumeId ? '绑定分卷信息' : '创建分卷信息') }}
          </NButton>
        </div>
      </template>
    </NModal>

    <NModal
      v-model:show="createDialogVisible"
      preset="card"
      title="新建章节"
      :style="{ width: 'min(520px, 92vw)' }"
      :bordered="false"
    >
      <NForm label-placement="top">
        <NFormItem label="所属分卷">
          <NSelect
            v-model:value="createForm.volumeId"
            :options="createVolumeOptions"
            placeholder="选择这一章所在的分卷"
          />
        </NFormItem>
        <NFormItem label="选择大纲">
          <NSelect
            v-model:value="createForm.outlineItemId"
            :options="createOutlineOptions"
            placeholder="先选择分卷，再选择要写作的大纲节点"
            filterable
          />
        </NFormItem>
        <NFormItem label="章节标题">
          <NInput v-model:value="createForm.title" placeholder="选择大纲后自动带入标题" />
          <template #feedback>
            <NButton size="tiny" secondary :loading="importingChapterFile" @click="handleImportChapterFile">
              <template #icon><FilePlus :size="12" /></template>
              从本地文件导入（txt / md）
            </NButton>
            <span v-if="importedChapterCharCount" class="import-summary-hint">
              已导入文件，共 {{ importedChapterCharCount.toLocaleString() }} 字，创建时将写入正文并生成摘要
            </span>
          </template>
        </NFormItem>
      </NForm>

      <template #footer>
        <div class="create-actions">
          <NButton round strong @click="closeCreateDialog">取消</NButton>
          <NButton
            type="primary"
            round
            strong
            :disabled="!createForm.volumeId || (!importedChapterContent.trim() && !selectedCreateOutline)"
            @click="submitCreateChapter"
          >
            创建章节
          </NButton>
        </div>
      </template>
    </NModal>
  </aside>
</template>

<style scoped>
.import-summary-hint {
  display: inline-block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--arc-text-hint);
}
.tree-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--arc-bg-weak);
  border-right: 1px solid var(--arc-border);
  overflow: hidden;
}

.ts-header {
  padding: 12px 12px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--arc-border);
}

.project-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-name .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-success);
  flex-shrink: 0;
}

.icon-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: 0.15s;
}

.icon-btn:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.icon-btn.flex { flex: 1; }

.ts-toolbar {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--arc-border);
}

.ts-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 12px;
  padding: 6px 10px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-sm);
  color: var(--arc-text-hint);
}

.ts-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--arc-text-primary);
}

.ts-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  contain: strict;
}

.virtual-tree-row {
  height: 40px;
  min-height: 40px;
  box-sizing: border-box;
}

.volume {
  position: relative;
  margin-bottom: 0;
}

.volume-head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 12px 6px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: var(--arc-text-secondary);
  letter-spacing: 0.04em;
  height: 40px;
}

.volume-head:hover {
  background: var(--arc-bg-surface-hover);
}

.volume.drop-target .volume-head {
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-text-primary);
  box-shadow: inset 2px 0 0 var(--arc-primary);
}

.volume.volume-dragging {
  opacity: 0.48;
}

.volume.volume-drop-before .volume-head,
.volume.volume-drop-after .volume-head {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-text-primary);
}

.volume.volume-drop-before::before,
.volume.volume-drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  z-index: 4;
  height: 2px;
  border-radius: 999px;
  background: var(--arc-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
  pointer-events: none;
}

.volume.volume-drop-before::before {
  top: 0;
}

.volume.volume-drop-after::after {
  bottom: 0;
}

.volume-grip {
  display: inline-flex;
  width: 16px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
  cursor: grab;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.volume-grip:hover {
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
}

.volume-grip:active {
  cursor: grabbing;
}

.volume-head .chevron {
  transition: transform 0.15s;
  flex-shrink: 0;
}

.volume.collapsed .chevron {
  transform: rotate(-90deg);
}

.volume-title {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.volume-meta {
  font-size: 11px;
  color: var(--arc-text-hint);
  font-weight: 500;
}

.volume-drop-label {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: white;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0;
}

.volume-more {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

.volume-more:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.chapter-list {
  display: flex;
  flex-direction: column;
}

.chapter-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--arc-text-primary);
  border-left: 2px solid transparent;
  text-align: left;
  transition: background 0.15s ease;
  width: 100%;
  height: 40px;
}

.chapter-row:hover {
  background: var(--arc-bg-surface-hover);
}

.chapter-row.dragging {
  opacity: 0.45;
  background: var(--arc-bg-surface-hover);
}

.chapter-row.drop-before,
.chapter-row.drop-after {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
}

.chapter-row.drop-before::before,
.chapter-row.drop-after::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  height: 2px;
  border-radius: 999px;
  background: var(--arc-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
  pointer-events: none;
}

.chapter-row.drop-before::before {
  top: -1px;
}

.chapter-row.drop-after::after {
  bottom: -1px;
}

.chapter-row.active {
  background: var(--arc-primary-soft);
  border-left-color: var(--arc-primary);
  font-weight: 500;
}

.chap-grip {
  display: inline-flex;
  width: 16px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
  cursor: grab;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.chap-grip:hover {
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
}

.chap-grip:active {
  cursor: grabbing;
}

.chapter-row .chap-icon {
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

.chapter-row.active .chap-icon {
  color: var(--arc-primary);
}

.chap-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chap-more {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
}

.chap-more:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.chapter-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px 5px 26px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--arc-text-hint);
  cursor: pointer;
  width: 100%;
  height: 40px;
}

.chapter-add:hover {
  color: var(--arc-primary);
  background: var(--arc-bg-surface-hover);
}

.ts-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--arc-border);
  font-size: 11px;
  color: var(--arc-text-hint);
}

.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
