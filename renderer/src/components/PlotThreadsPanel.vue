<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick } from 'vue'
import {
  AlertTriangle, Archive, BookMarked, CheckCircle2, Circle,
  Download, FileUp, Flag, MoreVertical, Plus, Search, Sparkles, XCircle
} from 'lucide-vue-next'
import {
  NButton, NDivider, NDropdown, NDynamicTags, NEmpty, NForm, NFormItem,
  NInput, NInputNumber, NModal, NProgress, NSelect, NTag, NPopover, useDialog, useMessage
} from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import BatchDeleteBar from './BatchDeleteBar.vue'
import { useAppStore } from '@/stores/app'
import type { PlotThread, PlotThreadPriority, PlotThreadStatus } from '@/types/app'
import { useIncrementalList } from '@/composables/useIncrementalList'
import { normalizeCatalogTags, useCatalogBatch } from '@/composables/useCatalogBatch'
import { toIpcPayload } from '@/utils/ipcPayload'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

const editorVisible = ref(false)
const editingThreadId = ref<string | null>(null)
// 批量删除：已选线索 ID 集合
const selectedThreadIds = ref<string[]>([])
const form = reactive({
  title: '',
  description: '',
  openedInChapterId: '',
  plannedCloseChapterId: '',
  closedInChapterId: '',
  status: 'pending' as PlotThreadStatus,
  tags: [] as string[],
  priority: 'medium' as PlotThreadPriority,
  remark: ''
})

// 筛选状态
const statusFilter = ref<'all' | PlotThreadStatus>('all')
const chapterFilter = ref<string>('')

// 伏笔状态映射
const STATUS_MAP: Record<PlotThreadStatus, { label: string; color: string }> = {
  pending: { label: '待回收', color: '#eab308' },
  resolved: { label: '已回收', color: '#22c55e' },
  abandoned: { label: '废弃', color: '#6b7280' }
}

const PRIORITY_MAP: Record<PlotThreadPriority, { label: string; color: string }> = {
  low: { label: '低', color: '#94a3b8' },
  medium: { label: '中', color: '#eab308' },
  high: { label: '高', color: '#ef4444' }
}

// 按状态分组统计
const stats = computed(() => {
  const all = appStore.plotThreads
  return {
    total: all.length,
    pending: all.filter((t) => t.status === 'pending').length,
    resolved: all.filter((t) => t.status === 'resolved').length,
    abandoned: all.filter((t) => t.status === 'abandoned').length
  }
})

// 筛选+搜索
const filteredThreads = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  let threads = appStore.plotThreads

  // 状态筛选
  if (statusFilter.value !== 'all') {
    threads = threads.filter((t) => t.status === statusFilter.value)
  }

  // 章节筛选
  if (chapterFilter.value) {
    threads = threads.filter(
      (t) => t.openedInChapterId === chapterFilter.value || t.closedInChapterId === chapterFilter.value
    )
  }

  // 关键词搜索
  if (query) {
    threads = threads.filter((t) =>
      `${t.title} ${t.description} ${t.tags.join(' ')} ${t.remark ?? ''}`.toLowerCase().includes(query)
    )
  }

  return threads
})

const pendingThreads = computed(() => filteredThreads.value.filter((t) => t.status === 'pending'))
const resolvedThreads = computed(() => filteredThreads.value.filter((t) => t.status === 'resolved'))
const abandonedThreads = computed(() => filteredThreads.value.filter((t) => t.status === 'abandoned'))
const threadResetKey = computed(() => `${props.searchQuery?.trim().toLowerCase() ?? ''}-${statusFilter.value}-${chapterFilter.value}`)
const visiblePendingThreads = useIncrementalList(pendingThreads, threadResetKey, { initialSize: 30, batchSize: 30 })
const visibleResolvedThreads = useIncrementalList(resolvedThreads, threadResetKey, { initialSize: 30, batchSize: 30 })
const visibleAbandonedThreads = useIncrementalList(abandonedThreads, threadResetKey, { initialSize: 30, batchSize: 30 })
const isEditing = computed(() => Boolean(editingThreadId.value))

// ── 从灵感卡片跳转聚焦的伏笔 ──
const focusedThreadId = ref<string | null>(null)

// 监听 store 中的 threadFocusTarget，切换面板后自动定位到指定伏笔
watch(
  () => appStore.threadFocusTarget,
  async (target) => {
    if (target?.threadId) {
      // 重置筛选以确保目标伏笔在列表中可见
      statusFilter.value = 'all'
      chapterFilter.value = ''
      focusedThreadId.value = target.threadId
      // 等待 DOM 渲染完成后再滚动到目标卡片
      await nextTick()
      await nextTick()
      const el = document.querySelector(`[data-thread-id="${target.threadId}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 高亮保持一段时间后自动清除
      setTimeout(() => {
        if (focusedThreadId.value === target.threadId) {
          focusedThreadId.value = null
        }
      }, 3000)
      // 清除 store 中的聚焦目标，避免重复触发
      appStore.clearThreadFocus()
    }
  },
  { immediate: true }
)

// 章节选项
const chapterOptions = computed(() =>
  appStore.chapters.map((c) => ({ label: c.title || '未命名章节', value: c.id }))
)

// 「计划回收章节」只允许选择埋设章节之后的分卷/章节（伏笔应在后面回收）。
const closeChapterOptions = computed(() => {
  const openedId = form.openedInChapterId
  const opened = appStore.chapters.find((c) => c.id === openedId)
  if (!opened) return chapterOptions.value
  const volumes = appStore.outlineVolumes
  const chapters = appStore.chapters
  const openedVolumeIndex = volumes.findIndex((v) => v.id === opened.volumeId)
  const openedIdxInVolume = chapters
    .filter((c) => c.volumeId === opened.volumeId)
    .findIndex((c) => c.id === opened.id)
  return chapters
    .filter((c) => {
      const volIndex = volumes.findIndex((v) => v.id === c.volumeId)
      if (volIndex > openedVolumeIndex) return true
      if (volIndex === openedVolumeIndex && volIndex !== -1) {
        const idxInVolume = chapters
          .filter((x) => x.volumeId === c.volumeId)
          .findIndex((x) => x.id === c.id)
        return idxInVolume > openedIdxInVolume
      }
      return false
    })
    .map((c) => ({ label: c.title || '未命名章节', value: c.id }))
})

// 埋设章节变化后，若当前选中的计划回收章节已不在“之后章节”范围内，则自动清空
watch(
  () => form.openedInChapterId,
  () => {
    const validIds = new Set(closeChapterOptions.value.map((o) => o.value))
    if (form.plannedCloseChapterId && !validIds.has(form.plannedCloseChapterId)) {
      form.plannedCloseChapterId = ''
    }
  }
)

const statusOptions = computed(() => [
  { label: '全部状态', value: 'all' },
  { label: '待回收', value: 'pending' },
  { label: '已回收', value: 'resolved' },
  { label: '废弃', value: 'abandoned' }
])

const priorityOptions = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' }
]

const menuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑伏笔' },
  { key: 'toggle', label: '切换状态' },
  { key: 'delete', label: '删除伏笔' }
]

// ── 批量操作 ──
const selectedThreadIdSet = computed(() => new Set(selectedThreadIds.value))
const batchDeleteAllThreads = computed(
  () => filteredThreads.value.length > 0 && selectedThreadIds.value.length === filteredThreads.value.length
)
function toggleSelectThread(threadId: string): void {
  selectedThreadIds.value = selectedThreadIds.value.includes(threadId)
    ? selectedThreadIds.value.filter((id) => id !== threadId)
    : [...selectedThreadIds.value, threadId]
}
function toggleSelectAllThreads(): void {
  selectedThreadIds.value =
    batchDeleteAllThreads.value
      ? []
      : filteredThreads.value.map((thread) => thread.id)
}
function handleBatchDeleteThreads(): void {
  const ids = selectedThreadIds.value
  if (!ids.length) return
  dialog.warning({
    title: '确认批量删除',
    content: `确定要删除选中的 ${ids.length} 条伏笔吗？删除后无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deletePlotThreads(ids)
      selectedThreadIds.value = []
      message.success(`已删除 ${ids.length} 条伏笔`)
    }
  })
}
function clearThreadSelection(): void {
  selectedThreadIds.value = []
}

// 批量修改状态
const batchStatusModalVisible = ref(false)
const batchStatus = ref<PlotThreadStatus>('pending')
function openBatchStatus(): void {
  if (!selectedThreadIds.value.length) {
    message.warning('请先选择要操作的伏笔')
    return
  }
  batchStatus.value = 'pending'
  batchStatusModalVisible.value = true
}
function confirmBatchStatus(): void {
  appStore.batchUpdatePlotThreadStatus(selectedThreadIds.value, batchStatus.value)
  message.success(`已将 ${selectedThreadIds.value.length} 条伏笔状态改为「${STATUS_MAP[batchStatus.value].label}」`)
  batchStatusModalVisible.value = false
  clearThreadSelection()
}

// 批量修改标签
const batchTagsModalVisible = ref(false)
const batchTags = ref<string[]>([])
function openBatchTags(): void {
  if (!selectedThreadIds.value.length) {
    message.warning('请先选择要操作的伏笔')
    return
  }
  batchTags.value = []
  batchTagsModalVisible.value = true
}
function confirmBatchTags(): void {
  appStore.batchUpdatePlotThreadTags(selectedThreadIds.value, batchTags.value)
  message.success(`已更新 ${selectedThreadIds.value.length} 条伏笔的标签`)
  batchTagsModalVisible.value = false
  clearThreadSelection()
}

// ── 导入 / 导出 ──
const importModalVisible = ref(false)
const importItems = ref<Array<Record<string, unknown>>>([])
const importErrors = ref<string[]>([])
const importLoading = ref(false)

function openImportModal(): void {
  importItems.value = []
  importErrors.value = []
  importModalVisible.value = true
  handleImport()
}

async function handleImport(): Promise<void> {
  importLoading.value = true
  try {
    const result = await window.characterArc.importPlotThreads()
    if (result.canceled) {
      importModalVisible.value = false
      return
    }
    if (!result.success) {
      if (result.error) message.error(result.error)
      else message.warning('未解析到有效的伏笔数据')
      importModalVisible.value = false
      return
    }
    importItems.value = result.items ?? []
    importErrors.value = result.errors ?? []

    // 将解析到的伏笔导入 store
    if (importItems.value.length > 0) {
      const items = importItems.value.map((item) => ({
        title: String(item.title ?? ''),
        description: String(item.description ?? ''),
        status: (item.status as PlotThreadStatus) || 'pending',
        priority: (item.priority as PlotThreadPriority) || 'medium',
        tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
        remark: String(item.remark ?? '')
      }))
      appStore.importPlotThreads(items as Array<Partial<PlotThread> & { title: string }>)
      message.success(`成功导入 ${items.length} 条伏笔`)
    }

    if (importErrors.value.length > 0) {
      message.warning(`${importErrors.value.length} 个文件解析失败`)
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导入伏笔失败')
  } finally {
    importLoading.value = false
    importModalVisible.value = false
  }
}

function chapterTitleById(id: string): string {
  return appStore.chapters.find((c) => c.id === id)?.title || id || '未知章节'
}

function buildExportData(): Array<Record<string, unknown>> {
  const chapterTitleMap = new Map(appStore.chapters.map((c) => [c.id, c.title]))
  return appStore.plotThreads.map((t) => ({
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    tags: t.tags,
    remark: t.remark ?? '',
    openedInChapterId: t.openedInChapterId,
    openedInChapterTitle: chapterTitleMap.get(t.openedInChapterId) ?? '',
    plannedCloseChapterId: t.plannedCloseChapterId ?? '',
    plannedCloseChapterTitle: t.plannedCloseChapterId ? (chapterTitleMap.get(t.plannedCloseChapterId) ?? '') : '',
    closedInChapterId: t.closedInChapterId ?? '',
    closedInChapterTitle: t.closedInChapterId ? (chapterTitleMap.get(t.closedInChapterId) ?? '') : ''
  }))
}

async function exportThreads(format: 'md' | 'txt' | 'json'): Promise<void> {
  const data = buildExportData()
  if (!data.length) {
    message.warning('当前没有伏笔可以导出')
    return
  }
  const ext = format === 'json' ? 'json' : (format === 'md' ? 'md' : 'txt')
  const result = await window.characterArc.exportPlotThreads(toIpcPayload({
    data,
    format,
    title: `导出伏笔 ${ext.toUpperCase()}`,
    defaultPath: `plot-threads-${new Date().toISOString().slice(0, 10)}.${ext}`
  }))
  if (result.canceled) return
  result.success ? message.success(`伏笔已导出为 ${ext.toUpperCase()}`) : message.error(result.error ?? '导出失败')
}

// ── 章节跳转 ──
function jumpToChapter(chapterId: string): void {
  if (!chapterId) return
  appStore.setPanel('chapters')
  appStore.selectChapter(chapterId)
}

// ── 新建/编辑 ──
function openCreateEditor(chapterId?: string): void {
  editingThreadId.value = null
  form.title = ''
  form.description = ''
  form.openedInChapterId = chapterId ?? appStore.selectedChapterId ?? ''
  form.plannedCloseChapterId = ''
  form.closedInChapterId = ''
  form.status = 'pending'
  form.tags = []
  form.priority = 'medium'
  form.remark = ''
  editorVisible.value = true
}

function openEditEditor(thread: PlotThread): void {
  editingThreadId.value = thread.id
  form.title = thread.title
  form.description = thread.description
  form.openedInChapterId = thread.openedInChapterId
  form.plannedCloseChapterId = thread.plannedCloseChapterId ?? ''
  form.closedInChapterId = thread.closedInChapterId ?? ''
  form.status = thread.status
  form.tags = [...thread.tags]
  form.priority = thread.priority
  form.remark = thread.remark ?? ''
  editorVisible.value = true
}

function handleMenuSelect(key: string, thread: PlotThread): void {
  if (key === 'edit') {
    openEditEditor(thread)
  } else if (key === 'toggle') {
    const nextStatus: PlotThreadStatus =
      thread.status === 'pending' ? 'resolved' :
      thread.status === 'resolved' ? 'abandoned' : 'pending'
    appStore.updatePlotThread(thread.id, {
      status: nextStatus,
      closedInChapterId: nextStatus === 'resolved' ? (appStore.selectedChapterId ?? '') : undefined
    })
    message.success(`已标记为「${STATUS_MAP[nextStatus].label}」`)
  } else if (key === 'delete') {
    dialog.warning({
      title: '删除伏笔',
      content: `确定删除"${thread.title}"？此操作无法撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        appStore.deletePlotThread(thread.id)
        message.success('已删除')
      }
    })
  }
}

function handleSave(): void {
  if (!form.title.trim()) {
    message.warning('请填写伏笔标题')
    return
  }

  if (editingThreadId.value) {
    appStore.updatePlotThread(editingThreadId.value, {
      title: form.title.trim(),
      description: form.description.trim(),
      openedInChapterId: form.openedInChapterId,
      plannedCloseChapterId: form.plannedCloseChapterId || undefined,
      closedInChapterId: form.status === 'resolved' ? form.closedInChapterId : undefined,
      status: form.status,
      tags: form.tags,
      priority: form.priority,
      remark: form.remark.trim()
    })
    message.success('已更新')
  } else {
    appStore.createPlotThread({
      title: form.title.trim(),
      description: form.description.trim(),
      openedInChapterId: form.openedInChapterId,
      plannedCloseChapterId: form.plannedCloseChapterId || undefined,
      status: form.status,
      tags: form.tags,
      priority: form.priority,
      remark: form.remark.trim()
    })
    message.success('已添加')
  }
  editorVisible.value = false
}

function formatTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '刚刚'
  return parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── AI 批量生成伏笔 ──
// 复用 useCatalogBatch 的分批并行机制：单批 10 条、自适应并发（按批次数自动提升，最高 8 路），
// 大幅缩短大量伏笔的生成耗时，且总数量不再设上限。
const BATCH_TASK_KEY = 'catalog-batch:plot-thread'
const batchLoading = computed(() => appStore.isAiTaskRunning(BATCH_TASK_KEY))
const batchModalVisible = ref(false)
const batchFocusModalVisible = ref(false)
const batchFocus = ref('')
const batchCount = ref(10)
const batchProgress = ref(0)
const generatedThreads = ref<Array<{ title: string; description: string; tags: string[]; selected: boolean }>>([])
const { generateCatalogBatch } = useCatalogBatch()

function compactForAi(value: unknown, maxLength: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

async function handleAiBatchGenerate(): Promise<void> {
  if (batchLoading.value) return
  const project = appStore.currentProject
  if (!project) {
    message.warning('请先打开一个项目')
    return
  }

  const existingThreads = appStore.plotThreads
    .map((t) => (t.status === 'pending' ? `${t.title}（${t.description}）` : t.title))
  batchFocusModalVisible.value = false
  batchProgress.value = 0

  try {
    const entries = await generateCatalogBatch({
      mode: 'plot-thread',
      count: batchCount.value,
      label: 'AI 批量生成伏笔',
      panel: 'plot-threads',
      kind: 'plot-thread',
      keyField: 'title',
      existingKeys: appStore.plotThreads.map((t) => t.title),
      onProgress: (completed, total) => { batchProgress.value = Math.round(completed / total * 100) },
      context: {
        projectTitle: project.title,
        projectGenre: project.genre,
        focus: batchFocus.value.trim(),
        existingThreads,
        worldviewEntries: appStore.worldviewEntries.slice(0, 12).map((e) => ({
          type: e.type, title: e.title, content: compactForAi(e.content, 240)
        })),
        characters: appStore.characters.slice(0, 12).map((c) => ({
          name: c.name, role: c.role, description: compactForAi(c.description, 200)
        })),
        organizations: appStore.organizations.slice(0, 8).map((o) => ({
          name: o.name, type: o.type, description: compactForAi(o.description, 200)
        })),
        characterRelationships: appStore.characterRelationships,
        organizationMemberships: appStore.organizationMemberships,
        outlineItems: appStore.outlineItems.slice(-12).map((item) => ({
          title: item.title, conflict: compactForAi(item.conflict, 140), summary: compactForAi(item.summary, 240)
        }))
      }
    })

    if (entries.length === 0) {
      message.warning('AI 未返回有效的伏笔')
      return
    }

    generatedThreads.value = entries.map((e) => ({
      title: String(e.title ?? '未命名伏笔'),
      description: String(e.description ?? '暂无描述'),
      tags: normalizeCatalogTags(e.tags),
      selected: true
    }))
    batchModalVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 批量生成伏笔失败，请检查模型配置')
  }
}

function openBatchGenerate(): void {
  batchFocus.value = ''
  batchCount.value = 10
  generatedThreads.value = []
  batchFocusModalVisible.value = true
}

function toggleGeneratedThread(index: number): void {
  generatedThreads.value[index].selected = !generatedThreads.value[index].selected
}

function confirmAddGeneratedThreads(): void {
  const toAdd = generatedThreads.value.filter((t) => t.selected)
  if (!toAdd.length) {
    message.warning('请至少勾选一条伏笔')
    return
  }
  const openedInChapterId = appStore.selectedChapterId ?? ''
  toAdd.forEach((t) => {
    appStore.createPlotThread({
      title: t.title,
      description: t.description,
      openedInChapterId,
      status: 'pending',
      tags: t.tags
    })
  })
  message.success(`已添加 ${toAdd.length} 条伏笔`)
  batchModalVisible.value = false
}
</script>

<template>
  <div class="threads-panel arc-scrollbar">
    <!-- 顶部工具栏 -->
    <div class="panel-toolbar">
      <div class="toolbar-stats">
        <span class="stat-badge total">共 {{ stats.total }} 条</span>
        <span class="stat-badge pending">待回收 {{ stats.pending }}</span>
        <span class="stat-badge resolved">已回收 {{ stats.resolved }}</span>
        <span class="stat-badge abandoned">废弃 {{ stats.abandoned }}</span>
      </div>
      <div class="toolbar-actions">
        <n-button size="small" secondary type="info" :loading="batchLoading" :disabled="batchLoading" @click="openBatchGenerate">
          <template #icon><Sparkles :size="14" /></template>
          AI 生成
        </n-button>
        <n-dropdown
          trigger="click"
          :options="[
            { key: 'import', label: '导入伏笔（MD/TXT/JSON）' },
            { type: 'divider', key: 'd1' },
            { key: 'md', label: '导出为 Markdown' },
            { key: 'txt', label: '导出为 TXT' },
            { key: 'json', label: '导出为 JSON' }
          ]"
          @select="(key: string) => {
            if (key === 'import') openImportModal()
            else exportThreads(key as 'md' | 'txt' | 'json')
          }"
        >
          <n-button size="small" secondary>
            <template #icon><FileUp :size="14" /></template>
            导入/导出
          </n-button>
        </n-dropdown>
        <n-button size="small" type="primary" @click="openCreateEditor()">
          <template #icon><Plus :size="14" /></template>
          新建伏笔
        </n-button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <n-select
        v-model:value="statusFilter"
        :options="statusOptions"
        size="small"
        class="filter-status"
        placeholder="按状态筛选"
      />
      <n-select
        v-model:value="chapterFilter"
        :options="chapterOptions"
        size="small"
        class="filter-chapter"
        placeholder="按章节筛选"
        clearable
        filterable
      />
    </div>

    <!-- 批量操作栏 -->
    <div v-if="selectedThreadIds.length > 0" class="batch-actions">
      <span class="batch-count">已选 {{ selectedThreadIds.length }} 条</span>
      <n-button size="tiny" secondary type="primary" @click="openBatchStatus">修改状态</n-button>
      <n-button size="tiny" secondary type="primary" @click="openBatchTags">修改标签</n-button>
      <n-button size="tiny" secondary type="error" @click="handleBatchDeleteThreads">批量删除</n-button>
      <n-button size="tiny" text @click="clearThreadSelection">取消选择</n-button>
    </div>

    <BatchDeleteBar
      v-else-if="filteredThreads.length > 0"
      :selected-count="selectedThreadIds.length"
      :total-count="filteredThreads.length"
      item-label="伏笔"
      :all-selected="batchDeleteAllThreads"
      @toggle-all="toggleSelectAllThreads"
      @delete-selected="handleBatchDeleteThreads"
      @clear="clearThreadSelection"
    />

    <!-- 待回收伏笔 -->
    <div v-if="pendingThreads.length > 0" class="thread-group">
      <div class="group-label"><Circle :size="13" class="group-icon pending-icon" /> 待回收（{{ pendingThreads.length }}）</div>
      <div class="thread-grid">
        <article
          v-for="thread in visiblePendingThreads"
          :key="thread.id"
          class="thread-card"
          :class="[`priority-${thread.priority}`, { focused: focusedThreadId === thread.id }]"
          :data-thread-id="thread.id"
          @click="openEditEditor(thread)"
        >
          <div class="card-top">
            <label class="card-check" title="勾选以便批量操作" @click.stop>
              <input
                type="checkbox"
                :checked="selectedThreadIdSet.has(thread.id)"
                @change="toggleSelectThread(thread.id)"
              />
            </label>
            <span class="priority-badge" :style="{ color: PRIORITY_MAP[thread.priority].color }">
              <Flag :size="12" /> {{ PRIORITY_MAP[thread.priority].label }}
            </span>
            <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key: string) => handleMenuSelect(key, thread)">
              <button class="more-button" type="button" title="更多操作" @click.stop>
                <MoreVertical :size="16" />
              </button>
            </n-dropdown>
          </div>
          <h4 class="thread-title">{{ thread.title }}</h4>
          <p v-if="thread.description" class="thread-desc" :title="thread.description">{{ thread.description }}</p>
          <div v-if="thread.tags.length" class="tag-row">
            <n-tag v-for="tag in thread.tags.slice(0, 3)" :key="tag" size="small">{{ tag }}</n-tag>
            <span v-if="thread.tags.length > 3" class="tag-overflow">+{{ thread.tags.length - 3 }}</span>
          </div>
          <div class="card-footer">
            <span v-if="thread.openedInChapterId" class="chapter-link" @click.stop="jumpToChapter(thread.openedInChapterId)">
              埋设：{{ chapterTitleById(thread.openedInChapterId) }}
            </span>
            <span v-if="thread.plannedCloseChapterId" class="chapter-link" @click.stop="jumpToChapter(thread.plannedCloseChapterId)">
              计划回收：{{ chapterTitleById(thread.plannedCloseChapterId) }}
            </span>
            <span class="meta-time">{{ formatTime(thread.updatedAt) }}</span>
          </div>
        </article>
      </div>
    </div>

    <!-- 已回收伏笔 -->
    <div v-if="resolvedThreads.length > 0" class="thread-group resolved-group">
      <n-divider class="group-divider" />
      <div class="group-label"><CheckCircle2 :size="13" class="group-icon resolved-icon" /> 已回收（{{ resolvedThreads.length }}）</div>
      <div class="thread-grid">
        <article
          v-for="thread in visibleResolvedThreads"
          :key="thread.id"
          class="thread-card resolved-card"
          :class="[`priority-${thread.priority}`, { focused: focusedThreadId === thread.id }]"
          :data-thread-id="thread.id"
          @click="openEditEditor(thread)"
        >
          <div class="card-top">
            <label class="card-check" title="勾选以便批量操作" @click.stop>
              <input
                type="checkbox"
                :checked="selectedThreadIdSet.has(thread.id)"
                @change="toggleSelectThread(thread.id)"
              />
            </label>
            <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key: string) => handleMenuSelect(key, thread)">
              <button class="more-button" type="button" title="更多操作" @click.stop>
                <MoreVertical :size="16" />
              </button>
            </n-dropdown>
          </div>
          <h4 class="thread-title resolved-title">{{ thread.title }}</h4>
          <p v-if="thread.description" class="thread-desc resolved-desc" :title="thread.description">{{ thread.description }}</p>
          <div v-if="thread.tags.length" class="tag-row">
            <n-tag v-for="tag in thread.tags.slice(0, 3)" :key="tag" size="small">{{ tag }}</n-tag>
            <span v-if="thread.tags.length > 3" class="tag-overflow">+{{ thread.tags.length - 3 }}</span>
          </div>
          <div class="card-footer">
            <span v-if="thread.openedInChapterId" class="chapter-link" @click.stop="jumpToChapter(thread.openedInChapterId)">
              埋设：{{ chapterTitleById(thread.openedInChapterId) }}
            </span>
            <span v-if="thread.closedInChapterId" class="chapter-link" @click.stop="jumpToChapter(thread.closedInChapterId)">
              回收：{{ chapterTitleById(thread.closedInChapterId) }}
            </span>
            <span class="meta-time">{{ formatTime(thread.updatedAt) }}</span>
          </div>
        </article>
      </div>
    </div>

    <!-- 已废弃伏笔 -->
    <div v-if="abandonedThreads.length > 0" class="thread-group abandoned-group">
      <n-divider class="group-divider" />
      <div class="group-label"><XCircle :size="13" class="group-icon abandoned-icon" /> 已废弃（{{ abandonedThreads.length }}）</div>
      <div class="thread-grid">
        <article
          v-for="thread in visibleAbandonedThreads"
          :key="thread.id"
          class="thread-card abandoned-card"
          :class="{ focused: focusedThreadId === thread.id }"
          :data-thread-id="thread.id"
          @click="openEditEditor(thread)"
        >
          <div class="card-top">
            <label class="card-check" title="勾选以便批量操作" @click.stop>
              <input
                type="checkbox"
                :checked="selectedThreadIdSet.has(thread.id)"
                @change="toggleSelectThread(thread.id)"
              />
            </label>
            <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key: string) => handleMenuSelect(key, thread)">
              <button class="more-button" type="button" title="更多操作" @click.stop>
                <MoreVertical :size="16" />
              </button>
            </n-dropdown>
          </div>
          <h4 class="thread-title abandoned-title">{{ thread.title }}</h4>
          <p v-if="thread.description" class="thread-desc abandoned-desc" :title="thread.description">{{ thread.description }}</p>
          <div v-if="thread.remark" class="thread-remark">
            <Archive :size="12" /> {{ thread.remark }}
          </div>
          <div class="card-footer">
            <span v-if="thread.openedInChapterId" class="chapter-link" @click.stop="jumpToChapter(thread.openedInChapterId)">
              埋设：{{ chapterTitleById(thread.openedInChapterId) }}
            </span>
            <span class="meta-time">{{ formatTime(thread.updatedAt) }}</span>
          </div>
        </article>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="pendingThreads.length === 0 && resolvedThreads.length === 0 && abandonedThreads.length === 0" class="empty-state">
      <n-empty description="暂无伏笔">
        <template #icon><BookMarked :size="32" class="empty-icon" /></template>
        <template #extra>
          <div class="empty-actions">
            <n-button size="small" @click="openCreateEditor()">添加第一条伏笔</n-button>
            <n-button size="small" secondary @click="openImportModal()">批量导入</n-button>
          </div>
        </template>
      </n-empty>
    </div>

    <!-- 新建/编辑弹窗 -->
    <n-modal
      v-model:show="editorVisible"
      preset="card"
      :title="isEditing ? '编辑伏笔' : '新建伏笔'"
      class="arc-editor-modal-wide"
      :mask-closable="false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top" :show-feedback="false" class="thread-form">
            <n-form-item label="伏笔标题" required>
              <n-input v-model:value="form.title" placeholder="如：林莫的穿越遗物" maxlength="60" show-count />
            </n-form-item>
            <n-form-item label="埋设章节">
              <n-select
                v-model:value="form.openedInChapterId"
                :options="chapterOptions"
                placeholder="选择埋设的章节"
                clearable
                filterable
              />
            </n-form-item>
            <n-form-item label="计划回收章节">
              <n-select
                v-model:value="form.plannedCloseChapterId"
                :options="closeChapterOptions"
                placeholder="选择计划回收的章节"
                clearable
                filterable
              />
            </n-form-item>
            <n-form-item label="状态">
              <n-select
                v-model:value="form.status"
                :options="[
                  { label: '待回收', value: 'pending' },
                  { label: '已回收', value: 'resolved' },
                  { label: '废弃', value: 'abandoned' }
                ]"
              />
            </n-form-item>
            <n-form-item v-if="form.status === 'resolved'" label="实际回收章节">
              <n-select
                v-model:value="form.closedInChapterId"
                :options="chapterOptions"
                placeholder="选择回收的章节"
                clearable
                filterable
              />
            </n-form-item>
            <n-form-item label="优先级">
              <n-select
                v-model:value="form.priority"
                :options="priorityOptions"
              />
            </n-form-item>
            <n-form-item label="关联标签">
              <n-dynamic-tags v-model:value="form.tags" />
            </n-form-item>
            <n-form-item label="备注">
              <n-input
                v-model:value="form.remark"
                type="textarea"
                :rows="2"
                placeholder="补充说明，如回收时机、关联信息等"
              />
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">详细描述</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="form.description"
              type="textarea"
              placeholder="描述这条伏笔的内容、背景或潜在影响"
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ form.description.length }} 字</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button @click="editorVisible = false">取消</n-button>
          <n-button type="primary" @click="handleSave">{{ isEditing ? '保存' : '添加' }}</n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <!-- 批量修改状态弹窗 -->
    <n-modal
      v-model:show="batchStatusModalVisible"
      preset="card"
      title="批量修改伏笔状态"
      style="width: 400px"
      :mask-closable="false"
    >
      <p class="ai-modal-hint">将 {{ selectedThreadIds.length }} 条伏笔的状态改为：</p>
      <n-select
        v-model:value="batchStatus"
        :options="[
          { label: '待回收', value: 'pending' },
          { label: '已回收', value: 'resolved' },
          { label: '废弃', value: 'abandoned' }
        ]"
      />
      <div class="arc-modal-footer" style="margin-top: 16px">
        <div class="arc-modal-footer-right">
          <n-button @click="batchStatusModalVisible = false">取消</n-button>
          <n-button type="primary" @click="confirmBatchStatus">确认修改</n-button>
        </div>
      </div>
    </n-modal>

    <!-- 批量修改标签弹窗 -->
    <n-modal
      v-model:show="batchTagsModalVisible"
      preset="card"
      title="批量修改伏笔标签"
      style="width: 400px"
      :mask-closable="false"
    >
      <p class="ai-modal-hint">为 {{ selectedThreadIds.length }} 条伏笔统一设置标签（将覆盖原有标签）：</p>
      <n-dynamic-tags v-model:value="batchTags" />
      <div class="arc-modal-footer" style="margin-top: 16px">
        <div class="arc-modal-footer-right">
          <n-button @click="batchTagsModalVisible = false">取消</n-button>
          <n-button type="primary" @click="confirmBatchTags">确认修改</n-button>
        </div>
      </div>
    </n-modal>

    <!-- AI 批量生成：重点方向输入 -->
    <n-modal
      v-model:show="batchFocusModalVisible"
      preset="card"
      title="AI 批量生成伏笔"
      style="width: 520px"
      :mask-closable="false"
    >
      <p class="ai-modal-hint">
        将根据项目的大纲、角色、世界观和已有伏笔，批量设计相互衔接的伏笔与悬念。可选填一个重点方向。
      </p>
      <n-input
        v-model:value="batchFocus"
        type="textarea"
        :rows="3"
        placeholder="如：围绕主角身世 / 反派势力的阴谋 / 下一卷的冲突重点（可留空）"
      />
      <div class="ai-modal-count-row" style="margin-top: 12px; display: flex; align-items: center; gap: 10px">
        <span class="ai-modal-count-label">生成数量</span>
        <n-input-number v-model:value="batchCount" :min="1" :step="1" style="width: 120px" />
        <span class="ai-modal-count-hint" style="color: var(--arc-text-hint); font-size: 12px">不限条数，建议 10~50 条</span>
      </div>
      <div v-if="batchLoading" class="ai-modal-progress" style="margin-top: 12px">
        <n-progress type="line" :percentage="batchProgress" :show-indicator="false" />
        <span class="ai-modal-count-hint" style="color: var(--arc-text-hint); font-size: 12px">已生成 {{ batchProgress }}%（分批并行中，请稍候）</span>
      </div>
      <div class="arc-modal-footer" style="margin-top: 16px">
        <div class="arc-modal-footer-right">
          <n-button @click="batchFocusModalVisible = false">取消</n-button>
          <n-button type="primary" :loading="batchLoading" :disabled="batchLoading" @click="handleAiBatchGenerate">
            开始生成
          </n-button>
        </div>
      </div>
    </n-modal>

    <!-- AI 批量生成：结果预览与确认 -->
    <n-modal
      v-model:show="batchModalVisible"
      preset="card"
      title="AI 批量生成的伏笔"
      class="arc-editor-modal-wide"
      :mask-closable="false"
    >
      <div class="ai-result-list">
        <div v-for="(thread, index) in generatedThreads" :key="index" class="ai-result-item">
          <label class="row-check">
            <input type="checkbox" :checked="thread.selected" @change="toggleGeneratedThread(index)" />
          </label>
          <div class="ai-result-body">
            <div class="ai-result-title">{{ thread.title }}</div>
            <div class="ai-result-desc">{{ thread.description }}</div>
            <div v-if="thread.tags.length" class="thread-tags">
              <n-tag v-for="tag in thread.tags" :key="tag" size="tiny" :bordered="false" class="tag-chip">{{ tag }}</n-tag>
            </div>
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ generatedThreads.filter((t) => t.selected).length }} / {{ generatedThreads.length }} 条已选</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button @click="batchModalVisible = false">取消</n-button>
          <n-button type="primary" @click="confirmAddGeneratedThreads">添加所选</n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
.threads-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  gap: 8px;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.toolbar-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.stat-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--arc-radius-sm);
  border: 1px solid var(--arc-border);
  color: var(--arc-text-secondary);
  background: var(--arc-bg-body);
}

.stat-badge.total {
  color: var(--arc-text-primary);
}

.stat-badge.pending {
  color: #eab308;
  background: color-mix(in srgb, #eab308 10%, var(--arc-bg-body));
  border-color: color-mix(in srgb, #eab308 30%, var(--arc-border));
}

.stat-badge.resolved {
  color: #22c55e;
  background: color-mix(in srgb, #22c55e 10%, var(--arc-bg-body));
  border-color: color-mix(in srgb, #22c55e 30%, var(--arc-border));
}

.stat-badge.abandoned {
  color: #6b7280;
  background: color-mix(in srgb, #6b7280 10%, var(--arc-bg-body));
  border-color: color-mix(in srgb, #6b7280 30%, var(--arc-border));
}

.filter-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.filter-status {
  width: 120px;
  flex-shrink: 0;
}

.filter-chapter {
  flex: 1;
  min-width: 0;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--arc-radius-sm);
  background: var(--arc-primary-soft);
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  flex-wrap: wrap;
}

.batch-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-primary);
  margin-right: 4px;
}

.thread-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.resolved-group,
.abandoned-group {
  margin-top: 4px;
}

.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--arc-text-hint);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 0 2px;
}

.group-icon {
  flex-shrink: 0;
}

.pending-icon {
  color: #eab308;
}

.resolved-icon {
  color: #22c55e;
}

.abandoned-icon {
  color: #6b7280;
}

.group-divider {
  margin: 4px 0 8px;
}

.thread-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 12px;
}

.thread-card {
  position: relative;
  display: flex;
  min-height: 176px;
  flex-direction: column;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  padding: 14px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease;
}

.thread-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 2%, var(--arc-bg-surface));
}

.thread-card.focused {
  border-color: #6366f1;
  box-shadow:
    inset 3px 0 0 #6366f1,
    0 0 0 2px color-mix(in srgb, #6366f1 30%, transparent);
  background: color-mix(in srgb, #6366f1 5%, var(--arc-bg-surface));
}

.thread-card.priority-high {
  box-shadow: inset 3px 0 0 #ef4444;
}

.thread-card.priority-medium {
  box-shadow: inset 3px 0 0 #eab308;
}

.thread-card.priority-low {
  box-shadow: inset 3px 0 0 #94a3b8;
}

.resolved-card {
  opacity: 0.72;
  background: var(--arc-bg-body);
}

.abandoned-card {
  opacity: 0.48;
  background: var(--arc-bg-body);
}

.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.card-check {
  display: inline-flex;
  align-items: center;
  padding-top: 2px;
  flex-shrink: 0;
}
.card-check input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--arc-primary);
  cursor: pointer;
}

.thread-title {
  margin: 12px 0 7px;
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resolved-title {
  text-decoration: line-through;
  color: var(--arc-text-hint);
}

.abandoned-title {
  text-decoration: line-through;
  color: var(--arc-text-hint);
}

.priority-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  padding-top: 2px;
}

.more-button {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
}

.more-button:hover {
  background: var(--arc-bg-mix);
  color: var(--arc-text-secondary);
}

.thread-desc {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.resolved-desc,
.abandoned-desc {
  color: var(--arc-text-hint);
}

.tag-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  margin-top: 10px;
  overflow: hidden;
}

.tag-row :deep(.n-tag) {
  max-width: 88px;
  flex-shrink: 1;
}

.tag-row :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-overflow {
  flex-shrink: 0;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.card-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
  padding-top: 12px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.chapter-link {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  color: var(--arc-primary);
}

.chapter-link:hover {
  opacity: 0.8;
}

.meta-time {
  font-size: 11px;
  color: var(--arc-text-hint);
  margin-left: auto;
}

.thread-remark {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 11px;
  color: var(--arc-text-hint);
  padding-top: 6px;
  margin-top: 8px;
  border-top: 1px dashed var(--arc-border);
}

/* AI 生成结果列表内的行样式（保留） */
.row-check {
  display: inline-flex;
  align-items: center;
  padding-top: 2px;
  flex-shrink: 0;
}
.row-check input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--arc-primary);
  cursor: pointer;
}

.thread-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag-chip {
  background: var(--arc-bg-body) !important;
  color: var(--arc-text-secondary);
  font-size: 10px;
}

.empty-state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}

.empty-icon {
  color: var(--arc-text-hint);
}

.empty-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.thread-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-modal-hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-hint);
}

.ai-result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
}

.ai-result-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-body);
}

.ai-result-body {
  flex: 1;
  min-width: 0;
}

.ai-result-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--arc-text-primary);
  margin-bottom: 4px;
}

.ai-result-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-secondary);
}
</style>
