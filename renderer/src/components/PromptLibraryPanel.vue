<script setup lang="ts">
import { computed, reactive, ref, nextTick } from 'vue'
import {
  Bookmark,
  BookmarkCheck,
  Copy,
  Download,
  FileJson,
  FileText,
  FileSpreadsheet,
  FileType2,
  MoreVertical,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Upload,
  Wand2
} from 'lucide-vue-next'
import {
  NButton,
  NDropdown,
  NDynamicTags,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { DropdownOption } from 'naive-ui'
import type { PromptCategory, PromptEntry } from '@/types/app'
import { BUILTIN_PROMPT_TEMPLATES } from '@/features/prompts/templates'
import { useIncrementalList } from '@/composables/useIncrementalList'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

// ── 提示词模板变量 ──
const TEMPLATE_VARIABLES = [
  { key: 'content', placeholder: '{{content}}', description: '编辑器中选中的文本内容' },
  { key: 'chapter', placeholder: '{{chapter}}', description: '当前章节名称' },
  { key: 'role', placeholder: '{{role}}', description: '当前选中的角色名称' }
] as const

// ── 状态 ──
const keyword = ref('')
const activeCategoryId = ref<string>('all')
const favoriteFilter = ref(false)
const pinnedFilter = ref(false)
const editorVisible = ref(false)
const editingEntryId = ref<string | null>(null)
const categoryManagerVisible = ref(false)
const newCategoryName = ref('')
const selectedEntryIds = ref<string[]>([])
const importExportVisible = ref(false)

// 编辑表单
const form = reactive({
  categoryId: '',
  title: '',
  content: '',
  tags: [] as string[],
  remark: '',
  isFavorite: false,
  isPinned: false
})

// ── 计算属性 ──
const allCategories = computed(() => {
  const cats = [...appStore.promptCategories]
  return [
    { id: 'all', name: '全部提示词', sortOrder: -1, isBuiltin: true, createdAt: '', updatedAt: '' },
    ...cats
  ]
})

const promptEntries = computed(() => {
  const entries = [...appStore.promptEntries]
  // 置顶优先，再按 sortOrder 排列
  return entries.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  })
})

const filteredEntries = computed(() => {
  const query = [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase()
  return promptEntries.value.filter((entry) => {
    // 分类筛选
    if (activeCategoryId.value !== 'all' && entry.categoryId !== activeCategoryId.value) return false
    // 收藏筛选
    if (favoriteFilter.value && !entry.isFavorite) return false
    // 置顶筛选
    if (pinnedFilter.value && !entry.isPinned) return false
    // 关键词搜索：标题/内容/标签
    const matchesQuery = !query
      || `${entry.title} ${entry.content} ${entry.tags.join(' ')} ${entry.remark}`.toLowerCase().includes(query)
    return matchesQuery
  })
})

const visibleEntries = useIncrementalList(
  filteredEntries,
  computed(() => `${props.searchQuery ?? ''}\u0000${keyword.value}\u0000${activeCategoryId.value}\u0000${favoriteFilter.value}\u0000${pinnedFilter.value}`)
)

const isEditing = computed(() => Boolean(editingEntryId.value))
const templateVariableHint = computed(() =>
  TEMPLATE_VARIABLES.map((v) => v.placeholder).join('、')
)

// ── 批量操作 ──
const selectedEntryIdSet = computed(() => new Set(selectedEntryIds.value))
const allEntriesSelected = computed(
  () => filteredEntries.value.length > 0 && selectedEntryIds.value.length === filteredEntries.value.length
)

const categoryOptions = computed(() =>
  allCategories.value
    .filter((c) => c.id !== 'all')
    .map((c) => ({ label: c.name, value: c.id }))
)

// ── 方法 ──
function toggleSelectEntry(entryId: string): void {
  selectedEntryIds.value = selectedEntryIds.value.includes(entryId)
    ? selectedEntryIds.value.filter((id) => id !== entryId)
    : [...selectedEntryIds.value, entryId]
}

function toggleSelectAllEntries(): void {
  selectedEntryIds.value = allEntriesSelected.value
    ? []
    : filteredEntries.value.map((e) => e.id)
}

function clearEntrySelection(): void {
  selectedEntryIds.value = []
}

function handleBatchDelete(): void {
  const ids = selectedEntryIds.value
  if (!ids.length) return
  dialog.warning({
    title: '确认批量删除',
    content: `确定要删除选中的 ${ids.length} 条提示词吗？删除后无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deletePromptEntries(ids)
      selectedEntryIds.value = []
      message.success(`已删除 ${ids.length} 条提示词`)
    }
  })
}

function handleBatchMove(categoryId: string): void {
  const ids = selectedEntryIds.value
  if (!ids.length || !categoryId) return
  appStore.movePromptEntriesToCategory(ids, categoryId)
  selectedEntryIds.value = []
  message.success(`已移动 ${ids.length} 条提示词到所选分类`)
}

// ── 分类管理 ──
function openCategoryManager(): void {
  newCategoryName.value = ''
  categoryManagerVisible.value = true
}

function handleAddCategory(): void {
  const added = appStore.createPromptCategory(newCategoryName.value)
  if (added) {
    message.success(`已新增分类「${newCategoryName.value.trim()}」`)
    newCategoryName.value = ''
  } else {
    message.warning('分类名称不能为空或已存在')
  }
}

function handleDeleteCategory(category: PromptCategory): void {
  if (category.isBuiltin) return
  dialog.warning({
    title: '删除分类',
    content: `确定要删除分类「${category.name}」吗？该分类下的提示词将一并删除。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deletePromptCategory(category.id)
      if (activeCategoryId.value === category.id) {
        activeCategoryId.value = 'all'
      }
      message.success(`已删除分类「${category.name}」`)
    }
  })
}

/** 拖拽排序分类 */
let dragCategoryId: string | null = null
function onCategoryDragStart(category: PromptCategory): void {
  dragCategoryId = category.id
}
function onCategoryDragOver(event: DragEvent): void {
  event.preventDefault()
}
function onCategoryDrop(targetCategory: PromptCategory): void {
  event?.preventDefault()
  if (!dragCategoryId || dragCategoryId === targetCategory.id) return
  const orderedIds = allCategories.value
    .filter((c) => c.id !== 'all')
    .map((c) => c.id)
  const fromIndex = orderedIds.indexOf(dragCategoryId)
  const toIndex = orderedIds.indexOf(targetCategory.id)
  if (fromIndex < 0 || toIndex < 0) return
  orderedIds.splice(fromIndex, 1)
  orderedIds.splice(toIndex, 0, dragCategoryId)
  appStore.reorderPromptCategories(orderedIds)
  dragCategoryId = null
}

// ── 提示词编辑 ──
function openCreateEditor(categoryId?: string): void {
  editingEntryId.value = null
  form.categoryId = categoryId || (activeCategoryId.value !== 'all' ? activeCategoryId.value : appStore.promptCategories[0]?.id || '')
  form.title = ''
  form.content = ''
  form.tags = []
  form.remark = ''
  form.isFavorite = false
  form.isPinned = false
  editorVisible.value = true
}

function openEditor(entry?: PromptEntry): void {
  editingEntryId.value = entry?.id ?? null
  form.categoryId = entry?.categoryId ?? activeCategoryId.value
  form.title = entry?.title ?? ''
  form.content = entry?.content ?? ''
  form.tags = [...(entry?.tags ?? [])]
  form.remark = entry?.remark ?? ''
  form.isFavorite = entry?.isFavorite ?? false
  form.isPinned = entry?.isPinned ?? false
  editorVisible.value = true
}

/** 从内置模板复制创建 */
function duplicateBuiltin(entry: PromptEntry): void {
  appStore.createPromptEntry({
    categoryId: entry.categoryId,
    title: `${entry.title}（副本）`,
    content: entry.content,
    tags: [...entry.tags],
    remark: entry.remark,
    isFavorite: false,
    isPinned: false
  })
  message.success('已复制为自定义提示词')
}

function submitEntry(): void {
  if (!form.title.trim() || !form.content.trim()) {
    message.warning('请完整填写提示词标题和内容')
    return
  }

  if (editingEntryId.value) {
    appStore.updatePromptEntry(editingEntryId.value, {
      categoryId: form.categoryId,
      title: form.title,
      content: form.content,
      tags: [...form.tags],
      remark: form.remark,
      isFavorite: form.isFavorite,
      isPinned: form.isPinned
    })
    message.success('提示词已更新')
  } else {
    appStore.createPromptEntry({
      categoryId: form.categoryId,
      title: form.title,
      content: form.content,
      tags: [...form.tags],
      remark: form.remark,
      isFavorite: form.isFavorite,
      isPinned: form.isPinned
    })
    message.success('提示词已创建')
  }
  editorVisible.value = false
}

function deletePrompt(entry: PromptEntry): void {
  dialog.warning({
    title: '确认删除提示词',
    content: `确定要删除「${entry.title}」吗？删除后无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deletePromptEntry(entry.id)
      message.success('提示词已删除')
    }
  })
}

// ── 一键套用与发送 ──
function resolveTemplateVars(content: string): string {
  const selectedText = appStore.currentChapterSelection?.text.trim() ?? ''
  const chapterTitle = appStore.selectedChapter?.title ?? ''
  let resolved = content
    .replaceAll('{{content}}', selectedText || '（未选中文本）')
    .replaceAll('{{chapter}}', chapterTitle || '（未选中章节）')
    .replaceAll('{{role}}', '')
  return resolved
}

function usePrompt(entry: PromptEntry): void {
  const resolved = resolveTemplateVars(entry.content)
  // 将提示词复制到剪贴板
  void navigator.clipboard?.writeText(resolved).catch(() => {})
  // 自增使用次数
  appStore.incrementPromptUsage(entry.id)
  message.success('提示词已复制，可粘贴到智能体使用')
}

// ── 导入导出 ──
async function handleExport(format: 'txt' | 'md' | 'json' | 'excel'): Promise<void> {
  const entries = selectedEntryIds.value.length
    ? filteredEntries.value.filter((e) => selectedEntryIdSet.value.has(e.id))
    : filteredEntries.value
  if (!entries.length) {
    message.warning('没有可导出的提示词')
    return
  }

  try {
    const data = entries.map((e) => ({
      title: e.title,
      content: e.content,
      tags: e.tags,
      remark: e.remark,
      category: appStore.promptCategories.find((c) => c.id === e.categoryId)?.name ?? '未分类',
      isFavorite: e.isFavorite,
      isPinned: e.isPinned,
      usageCount: e.usageCount
    }))

    const date = new Date().toISOString().slice(0, 10)
    const defaultPath = `提示词库-${date}.${format === 'md' ? 'md' : format === 'txt' ? 'txt' : format === 'excel' ? 'xlsx' : 'json'}`

    if (format === 'json') {
      const result = await window.characterArc.exportJson({
        data: { entries: data },
        title: '导出提示词库 JSON',
        defaultPath
      })
      if (result.success) message.success('提示词库已导出为 JSON')
    } else if (format === 'excel') {
      const result = await window.characterArc.exportExcel({
        data: { entries: data },
        title: '导出提示词库 Excel',
        defaultPath
      })
      if (result.success) message.success('提示词库已导出为 Excel')
    } else if (format === 'md') {
      const md = data.map((e) => [
        `### ${e.title}`,
        '',
        `**分类**：${e.category}`,
        ...(e.tags?.length ? [`**标签**：${e.tags.join('、')}`] : []),
        ...(e.remark ? [`**备注**：${e.remark}`] : []),
        '',
        e.content,
        ''
      ].join('\n')).join('---\n\n')
      const result = await window.characterArc.exportMarkdown({
        data: md,
        title: '导出提示词库 Markdown',
        defaultPath
      })
      if (result.success) message.success('提示词库已导出为 Markdown')
    } else {
      const txt = data.map((e) => [
        `【${e.category}】${e.title}`,
        ...(e.tags?.length ? [`标签：${e.tags.join('、')}`] : []),
        '',
        e.content,
        ...(e.remark ? [`备注：${e.remark}`] : []),
        ''
      ].filter((line) => line !== '').join('\n')).join('\n' + '='.repeat(36) + '\n\n')
      const result = await window.characterArc.exportText({
        data: txt,
        title: '导出提示词库 TXT',
        defaultPath
      })
      if (result.success) message.success('提示词库已导出为 TXT')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败')
  }
}

async function handleImportJson(): Promise<void> {
  try {
    const result = await window.characterArc.importJson()
    if (!result.success) {
      if (result.error) message.error(result.error)
      return
    }
    const raw = result.payload as { entries?: Array<Record<string, unknown>> } | null
    const entries = raw?.entries ?? (Array.isArray(raw) ? raw : null)
    if (!entries || !entries.length) {
      message.warning('文件中没有有效的提示词数据')
      return
    }

    // 收集需要导入的分类
    const catNames = new Set(entries.map((e) => String(e.category ?? '').trim()).filter(Boolean))
    const existingCats = new Set(appStore.promptCategories.map((c) => c.name))
    const catIdMap = new Map<string, string>()

    // 先找到或创建分类
    for (const catName of catNames) {
      if (existingCats.has(catName)) {
        catIdMap.set(catName, appStore.promptCategories.find((c) => c.name === catName)?.id ?? '')
      } else {
        const newId = appStore.createPromptCategory(catName)
        if (newId) catIdMap.set(catName, newId)
      }
    }

    let imported = 0
    const newEntries: Array<Partial<PromptEntry>> = []
    for (const rawEntry of entries) {
      const title = String(rawEntry.title ?? '').trim()
      const content = String(rawEntry.content ?? '').trim()
      if (!title || !content) continue
      const catName = String(rawEntry.category ?? '').trim()
      newEntries.push({
        categoryId: catIdMap.get(catName) ?? appStore.promptCategories[0]?.id ?? '',
        title,
        content,
        tags: Array.isArray(rawEntry.tags) ? rawEntry.tags.map(String) : [],
        remark: String(rawEntry.remark ?? ''),
        isFavorite: Boolean(rawEntry.isFavorite),
        isPinned: Boolean(rawEntry.isPinned),
        usageCount: Number(rawEntry.usageCount) || 0
      })
      imported++
    }

    for (const entry of newEntries) {
      appStore.createPromptEntry(entry)
    }

    if (imported > 0) {
      message.success(`已导入 ${imported} 条提示词`)
    } else {
      message.warning('未能从文件中解析出有效提示词')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导入失败')
  }
}

function formatEntryTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '刚刚更新'
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getCategoryName(categoryId: string): string {
  return appStore.promptCategories.find((c) => c.id === categoryId)?.name ?? '未分类'
}

function getCategoryColor(categoryId: string): string {
  const index = appStore.promptCategories.findIndex((c) => c.id === categoryId)
  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899', '#f59e0b', '#10b981', '#6366f1', '#ef4444']
  return colors[Math.abs(index) % colors.length]
}

function handleMenuSelect(action: string | number, entry: PromptEntry): void {
  if (action === 'edit') {
    openEditor(entry)
  } else if (action === 'duplicate') {
    duplicateBuiltin(entry)
  } else if (action === 'delete') {
    deletePrompt(entry)
  }
}

const menuOptions = (entry: PromptEntry): DropdownOption[] => [
  { key: 'edit', label: '编辑提示词' },
  { key: 'duplicate', label: entry.isBuiltin ? '复制为自定义' : '复制一份' },
  { key: 'delete', label: '删除提示词' }
]

const batchMoveCategoryOptions = computed(() =>
  categoryOptions.value.map((c) => ({ label: c.label, value: c.value }))
)
</script>

<template>
  <section class="prompt-panel">
    <div class="section-head">
      <div class="section-title">
        <h2>提示词库</h2>
        <span class="section-subtitle">管理你的写作提示词模板</span>
      </div>
      <div class="head-actions">
        <n-button secondary strong @click="importExportVisible = true">
          <template #icon><Download :size="16" /></template>
          导入导出
        </n-button>
        <n-button secondary strong @click="openCategoryManager">
          <template #icon><Settings2 :size="16" /></template>
          分类管理
        </n-button>
        <n-button type="primary" strong @click="openCreateEditor()">
          <template #icon><Plus :size="16" /></template>
          新建提示词
        </n-button>
      </div>
    </div>

    <div class="catalog-toolbar">
      <div class="catalog-filters">
        <n-input v-model:value="keyword" class="entry-search" placeholder="搜索标题、内容或标签" clearable>
          <template #prefix><Search :size="16" /></template>
        </n-input>
        <div class="filter-toggles">
          <button
            type="button"
            class="filter-btn"
            :class="{ active: favoriteFilter }"
            title="仅看已收藏"
            @click="favoriteFilter = !favoriteFilter"
          >
            <Bookmark :size="13" />
            收藏
          </button>
          <button
            type="button"
            class="filter-btn"
            :class="{ active: pinnedFilter }"
            title="仅看已置顶"
            @click="pinnedFilter = !pinnedFilter"
          >
            <Pin :size="13" />
            置顶
          </button>
        </div>
      </div>
      <div class="result-summary">
        <strong>{{ filteredEntries.length }}</strong>
        <span>条提示词</span>
      </div>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="selectedEntryIds.length > 0" class="batch-bar">
      <span>已选 <strong>{{ selectedEntryIds.length }}</strong> 条</span>
      <div class="batch-actions">
        <button type="button" @click="clearEntrySelection">取消选择</button>
        <button type="button" @click="toggleSelectAllEntries">
          {{ allEntriesSelected ? '取消全选' : '全选' }}
        </button>
        <n-select
          :value="null"
          :options="batchMoveCategoryOptions"
          placeholder="移动到分类..."
          size="small"
          style="width: 140px"
          @update:value="(v) => { if (v) handleBatchMove(String(v)) }"
        />
        <button type="button" class="danger-btn" @click="handleBatchDelete">批量删除</button>
      </div>
    </div>

    <!-- 分类侧栏 + 提示词列表 -->
    <div class="prompt-layout">
      <!-- 分类导航 -->
      <aside class="category-sidebar">
        <div class="category-list">
          <button
            type="button"
            class="category-item"
            :class="{ active: activeCategoryId === 'all' }"
            @click="activeCategoryId = 'all'"
          >
            <span class="category-icon all-icon"><Wand2 :size="14" /></span>
            <span class="category-name">全部提示词</span>
            <span class="category-count">{{ promptEntries.length }}</span>
          </button>
          <button
            v-for="cat in allCategories.filter(c => c.id !== 'all')"
            :key="cat.id"
            type="button"
            class="category-item"
            :class="{ active: activeCategoryId === cat.id }"
            draggable="true"
            @dragstart="onCategoryDragStart(cat)"
            @dragover="onCategoryDragOver"
            @drop="onCategoryDrop(cat)"
            @click="activeCategoryId = cat.id"
          >
            <span class="category-icon" :style="{ background: getCategoryColor(cat.id), opacity: 0.15, color: getCategoryColor(cat.id) }">
              <FileText :size="14" />
            </span>
            <span class="category-name">{{ cat.name }}</span>
            <span class="category-count">{{ promptEntries.filter(e => e.categoryId === cat.id).length }}</span>
          </button>
        </div>
        <div v-if="appStore.promptCategories.some(c => !c.isBuiltin)" class="category-sidebar-hint">
          <span>拖拽分类可排序</span>
        </div>
      </aside>

      <!-- 提示词卡片列表 -->
      <div class="prompt-content">
        <div v-if="filteredEntries.length > 0" class="prompt-grid">
          <article
            v-for="entry in visibleEntries"
            :key="entry.id"
            class="prompt-card"
          >
            <div class="card-top">
              <label class="card-check" title="勾选以便批量操作" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedEntryIdSet.has(entry.id)"
                  @change="toggleSelectEntry(entry.id)"
                />
              </label>
              <div class="type-row">
                <span
                  class="entry-category"
                  :style="{
                    background: `color-mix(in srgb, ${getCategoryColor(entry.categoryId)} 14%, var(--arc-bg-mix))`,
                    color: getCategoryColor(entry.categoryId)
                  }"
                >
                  {{ getCategoryName(entry.categoryId) }}
                </span>
                <span v-if="entry.isBuiltin" class="builtin-tag">内置</span>
                <span v-if="entry.isPinned" class="pin-tag"><Pin :size="10" />置顶</span>
              </div>
              <div class="card-actions">
                <button
                  type="button"
                  class="action-btn"
                  :class="{ active: entry.isFavorite }"
                  :title="entry.isFavorite ? '取消收藏' : '收藏'"
                  @click="appStore.togglePromptFavorite(entry.id)"
                >
                  <BookmarkCheck v-if="entry.isFavorite" :size="15" />
                  <Bookmark v-else :size="15" />
                </button>
                <button
                  type="button"
                  class="action-btn"
                  :class="{ active: entry.isPinned }"
                  :title="entry.isPinned ? '取消置顶' : '置顶'"
                  @click="appStore.togglePromptPin(entry.id)"
                >
                  <Pin v-if="entry.isPinned" :size="15" />
                  <PinOff v-else :size="15" />
                </button>
                <n-dropdown
                  :options="menuOptions(entry)"
                  placement="bottom-end"
                  @select="(key) => handleMenuSelect(key, entry)"
                >
                  <button class="action-btn more-btn" type="button" title="更多操作" @click.stop>
                    <MoreVertical :size="15" />
                  </button>
                </n-dropdown>
              </div>
            </div>

            <h4>{{ entry.title }}</h4>
            <p class="prompt-preview" :title="entry.content">{{ entry.content }}</p>

            <div v-if="entry.tags.length" class="tag-row">
              <n-tag v-for="tag in entry.tags.slice(0, 3)" :key="tag" size="small">
                {{ tag }}
              </n-tag>
              <span v-if="entry.tags.length > 3" class="tag-overflow">+{{ entry.tags.length - 3 }}</span>
            </div>

            <div v-if="entry.remark" class="remark-line" :title="entry.remark">
              💡 {{ entry.remark }}
            </div>

            <div class="card-footer">
              <div class="footer-left">
                <span class="usage-count" title="使用次数">
                  <Sparkles :size="11" />
                  {{ entry.usageCount || 0 }} 次
                </span>
                <span>更新于 {{ formatEntryTime(entry.updatedAt) }}</span>
              </div>
              <button type="button" class="use-btn" @click="usePrompt(entry)">
                <Copy :size="12" />
                一键套用
              </button>
            </div>
          </article>
        </div>

        <div v-else class="arc-empty-state">
          {{ appStore.promptEntries.length === 0
            ? '还没有提示词，点击右上角「新建」创建第一条。'
            : '没有匹配当前筛选条件的提示词。' }}
        </div>
      </div>
    </div>

    <!-- 提示词编辑弹窗 -->
    <n-modal
      :show="editorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="isEditing ? '编辑提示词' : '新建提示词'"
      :bordered="false"
      @close="editorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <n-form-item label="所属分类">
              <n-select
                v-model:value="form.categoryId"
                :options="categoryOptions"
                placeholder="选择分类"
                filterable
              />
            </n-form-item>
            <n-form-item label="提示词标题">
              <n-input v-model:value="form.title" placeholder="例如：场景氛围渲染" />
            </n-form-item>
            <n-form-item label="标签">
              <n-dynamic-tags v-model:value="form.tags" />
            </n-form-item>
            <n-form-item label="备注说明">
              <n-input v-model:value="form.remark" placeholder="例如：用于增加场景氛围渲染" />
            </n-form-item>
            <div class="form-toggles">
              <label class="toggle-item">
                <input
                  type="checkbox"
                  v-model="form.isFavorite"
                />
                <span>收藏</span>
              </label>
              <label class="toggle-item">
                <input
                  type="checkbox"
                  v-model="form.isPinned"
                />
                <span>置顶</span>
              </label>
            </div>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">
            <span>提示词内容</span>
            <span class="variable-hint">支持变量：{{ templateVariableHint }}</span>
          </div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="form.content"
              type="textarea"
              placeholder="输入提示词正文，可用 {{content}} 引用选中文本、{{chapter}} 引用当前章节、{{role}} 引用角色名..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ form.content.length }} 字</span>
          <span>{{ form.tags.length }} 个标签</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitEntry">
            {{ isEditing ? '保存修改' : '创建提示词' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <!-- 分类管理弹窗 -->
    <n-modal
      v-model:show="categoryManagerVisible"
      preset="card"
      title="提示词分类管理"
      :bordered="false"
      style="width: min(520px, calc(100vw - 32px))"
      @close="categoryManagerVisible = false"
    >
      <p class="type-manager-hint">
        管理提示词分类。内置分类不可删除，可拖拽排序。删除自定义分类会将其下的提示词一并删除。
      </p>
      <div class="type-manager-add">
        <n-input
          v-model:value="newCategoryName"
          placeholder="输入新分类名称，如：翻译辅助"
          clearable
          @keyup.enter="handleAddCategory"
        />
        <n-button type="primary" @click="handleAddCategory">
          <template #icon><Plus :size="16" /></template>
          添加
        </n-button>
      </div>
      <div class="category-manager-list">
        <div
          v-for="cat in allCategories.filter(c => c.id !== 'all')"
          :key="cat.id"
          class="category-manager-item"
          :class="{ builtin: cat.isBuiltin }"
          draggable="true"
          @dragstart="onCategoryDragStart(cat)"
          @dragover="onCategoryDragOver"
          @drop="onCategoryDrop(cat)"
        >
          <span class="category-drag-icon">⠿</span>
          <span class="category-manager-name">{{ cat.name }}</span>
          <span class="category-count">{{ promptEntries.filter(e => e.categoryId === cat.id).length }} 条</span>
          <span v-if="cat.isBuiltin" class="builtin-badge">内置</span>
          <button
            v-else
            type="button"
            class="category-delete-btn"
            title="删除分类"
            @click="handleDeleteCategory(cat)"
          >
            ✕
          </button>
        </div>
      </div>
      <div class="type-manager-footer">
        <span>拖拽可排序 · 内置 {{ allCategories.filter(c => c.id !== 'all' && c.isBuiltin).length }} 个 / 自定义 {{ allCategories.filter(c => c.id !== 'all' && !c.isBuiltin).length }} 个</span>
        <n-button round strong @click="categoryManagerVisible = false">完成</n-button>
      </div>
    </n-modal>

    <!-- 导入导出弹窗 -->
    <n-modal
      v-model:show="importExportVisible"
      preset="card"
      title="导入 / 导出提示词"
      :bordered="false"
      style="width: min(460px, calc(100vw - 32px))"
      @close="importExportVisible = false"
    >
      <div class="import-export-content">
        <div class="io-section">
          <h4>导出</h4>
          <div class="io-format-grid">
            <button type="button" class="io-btn" @click="handleExport('txt')">
              <FileText :size="18" />
              <span>TXT</span>
            </button>
            <button type="button" class="io-btn" @click="handleExport('md')">
              <FileType2 :size="18" />
              <span>Markdown</span>
            </button>
            <button type="button" class="io-btn" @click="handleExport('json')">
              <FileJson :size="18" />
              <span>JSON</span>
            </button>
            <button type="button" class="io-btn" @click="handleExport('excel')">
              <FileSpreadsheet :size="18" />
              <span>Excel</span>
            </button>
          </div>
          <p class="io-hint">
            {{ selectedEntryIds.length > 0
              ? `将导出当前选中的 ${selectedEntryIds.length} 条提示词`
              : '将导出当前筛选结果中的所有提示词' }}
          </p>
        </div>
        <div class="io-section">
          <h4>导入</h4>
          <n-button block secondary strong @click="handleImportJson">
            <template #icon><Upload :size="16" /></template>
            从 JSON 文件导入
          </n-button>
          <p class="io-hint">支持导入包含 entries 数组的 JSON 文件，自动匹配或创建分类。</p>
        </div>
      </div>
    </n-modal>
  </section>
</template>

<style scoped>
.prompt-panel {
  max-width: 1280px;
  margin: 0 auto;
  min-width: 0;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
  flex-wrap: wrap;
}

.section-title h2 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
}

.section-subtitle {
  color: var(--arc-text-hint);
  font-size: 13px;
  margin-top: 2px;
  display: block;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.catalog-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-mix);
  padding: 10px;
}

.catalog-filters {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.entry-search {
  width: min(320px, 32vw);
}

.filter-toggles {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.filter-btn {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.filter-btn:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
}

.filter-btn.active {
  border-color: color-mix(in srgb, var(--arc-primary) 34%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.result-summary {
  display: inline-flex;
  align-items: baseline;
  flex-shrink: 0;
  gap: 4px;
  color: var(--arc-text-hint);
  font-size: 12px;
  white-space: nowrap;
}

.result-summary strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

/* 批量操作栏 */
.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 24%, var(--arc-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-mix));
  padding: 10px 14px;
}

.batch-bar > span {
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.batch-bar > span strong {
  color: var(--arc-primary);
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.batch-actions button {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.batch-actions button:hover {
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
}

.batch-actions .danger-btn {
  color: var(--arc-danger);
}

.batch-actions .danger-btn:hover {
  background: color-mix(in srgb, var(--arc-danger) 10%, var(--arc-bg-surface));
}

/* 布局 */
.prompt-layout {
  display: flex;
  gap: 16px;
  min-height: 0;
}

.category-sidebar {
  width: 168px;
  flex-shrink: 0;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-mix);
  padding: 8px;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-secondary);
  padding: 6px 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.14s ease;
}

.category-item:hover {
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
}

.category-item.active {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  border-color: color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border));
  color: var(--arc-primary);
  font-weight: 600;
}

.category-icon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  flex-shrink: 0;
}

.category-icon.all-icon {
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.category-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-count {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
}

.category-item.active .category-count {
  color: var(--arc-primary);
}

.category-sidebar-hint {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--arc-border);
  color: var(--arc-text-hint);
  font-size: 11px;
  text-align: center;
}

.prompt-content {
  flex: 1;
  min-width: 0;
}

/* 提示词卡片 */
.prompt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 12px;
}

.prompt-card {
  position: relative;
  display: flex;
  min-height: 220px;
  flex-direction: column;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  padding: 14px;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.prompt-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 2%, var(--arc-bg-surface));
  box-shadow: var(--arc-shadow-sm);
}

.card-top,
.card-footer,
.type-row,
.tag-row {
  display: flex;
}

.card-top {
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
  accent-color: var(--arc-danger);
  cursor: pointer;
}

.type-row {
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

.entry-category,
.builtin-tag,
.pin-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 3px 7px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
}

.builtin-tag {
  background: color-mix(in srgb, #10b981 12%, var(--arc-bg-mix));
  color: #10b981;
}

.pin-tag {
  display: inline-flex;
  gap: 3px;
  background: color-mix(in srgb, #f59e0b 12%, var(--arc-bg-mix));
  color: #f59e0b;
}

.card-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.action-btn {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: all 0.14s ease;
}

.action-btn:hover {
  background: var(--arc-bg-mix);
  color: var(--arc-text-secondary);
}

.action-btn.active {
  color: #f59e0b;
}

.more-btn:hover {
  background: var(--arc-bg-mix);
  color: var(--arc-text-primary);
}

.prompt-card h4 {
  margin: 12px 0 7px;
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-preview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  white-space: pre-wrap;
  word-break: break-word;
}

.tag-row {
  min-height: 22px;
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

.remark-line {
  margin-top: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.card-footer {
  margin-top: auto;
  padding-top: 12px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.footer-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.usage-count {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--arc-text-hint);
  white-space: nowrap;
}

.use-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 24%, var(--arc-border));
  border-radius: 4px;
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  color: var(--arc-primary);
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.use-btn:hover {
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-surface));
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
}

/* 编辑弹窗 */
.form-toggles {
  display: flex;
  gap: 16px;
  margin-top: 4px;
}

.toggle-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.toggle-item input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: var(--arc-primary);
  cursor: pointer;
}

.variable-hint {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 400;
}

/* 分类管理 */
.type-manager-hint {
  margin: 0 0 16px;
  color: var(--arc-text-muted);
  line-height: 1.7;
}

.type-manager-add {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.type-manager-add .n-input {
  flex: 1;
}

.category-manager-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 4px;
}

.category-manager-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  padding: 8px 12px;
  cursor: grab;
  transition: all 0.14s ease;
}

.category-manager-item:hover {
  border-color: var(--arc-border-strong);
}

.category-manager-item.builtin {
  cursor: default;
  opacity: 0.85;
}

.category-drag-icon {
  color: var(--arc-text-hint);
  font-size: 14px;
  flex-shrink: 0;
}

.category-manager-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.category-count {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.builtin-badge {
  display: inline-flex;
  border-radius: 4px;
  background: color-mix(in srgb, #10b981 12%, var(--arc-bg-mix));
  color: #10b981;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 700;
}

.category-delete-btn {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 12px;
}

.category-delete-btn:hover {
  background: color-mix(in srgb, var(--arc-danger) 10%, var(--arc-bg-surface));
  color: var(--arc-danger);
}

.type-manager-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 18px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

/* 导入导出 */
.import-export-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.io-section h4 {
  margin: 0 0 10px;
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 600;
}

.io-format-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.io-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 12px 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s ease;
}

.io-btn:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 34%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface));
  color: var(--arc-primary);
}

.io-hint {
  margin: 8px 0 0;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 980px) {
  .section-head {
    align-items: flex-start;
  }

  .head-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .catalog-toolbar {
    align-items: flex-end;
  }

  .catalog-filters {
    flex: 1;
    flex-wrap: wrap;
  }

  .entry-search {
    width: min(100%, 340px);
  }
}

@media (max-width: 720px) {
  .head-actions :deep(.n-button) {
    flex: 1 1 calc(50% - 6px);
  }

  .catalog-toolbar,
  .catalog-filters {
    align-items: stretch;
    flex-direction: column;
  }

  .entry-search,
  .filter-toggles {
    width: 100%;
  }

  .filter-toggles {
    display: flex;
    gap: 8px;
  }

  .filter-btn {
    flex: 1;
    justify-content: center;
  }

  .result-summary {
    align-self: flex-end;
  }

  .prompt-layout {
    flex-direction: column;
  }

  .category-sidebar {
    width: 100%;
    max-height: 140px;
    overflow-y: auto;
  }

  .prompt-grid {
    grid-template-columns: 1fr;
  }

  .io-format-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
