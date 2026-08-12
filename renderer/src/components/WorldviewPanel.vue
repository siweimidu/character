<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRaw, watch } from 'vue'
import { Download, MoreVertical, Plus, Search, Sparkles, Tags, Upload } from 'lucide-vue-next'
import { NButton, NDropdown, NDynamicTags, NForm, NFormItem, NInput, NModal, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import type { DropdownOption } from 'naive-ui'
import type { WorldviewEntry } from '@/types/app'
import AiEnhancePreview from './AiEnhancePreview.vue'
import BatchDeleteBar from './BatchDeleteBar.vue'
import BatchGenerateDialog from './BatchGenerateDialog.vue'
import type { EnhanceFieldDiff } from './AiEnhancePreview.vue'
import { normalizeCatalogTags, useCatalogBatch } from '@/composables/useCatalogBatch'
import { useIncrementalList } from '@/composables/useIncrementalList'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词，用于过滤世界观词条
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
// 根据当前项目配置生成写作风格上下文，供 AI 生成时参考
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))
// 本面板唯一 AI 任务 key；交给全局注册表后切换面板仍能保持 loading 态
const AI_TASK_KEY = 'catalog-batch:worldview'
const isGenerating = computed(() => appStore.isAiTaskRunning(AI_TASK_KEY))
const batchVisible = ref(false)
const batchProgress = ref(0)
const keyword = ref('')
const typeFilter = ref<string | null>(null)
const { generateCatalogBatch } = useCatalogBatch()
const editorVisible = ref(false) // 控制词条编辑弹窗的显示
const editingEntryId = ref<string | null>(null) // 当前正在编辑的词条 ID，null 表示新建模式
// 批量删除：勾选模式下的已选词条 ID 集合
const selectedEntryIds = ref<string[]>([])
const focusedEntryId = ref<string>('')
// 词条编辑表单数据
const form = reactive({
  type: '地理',
  title: '',
  content: '',
  tags: [] as string[]
})

const entryTypes = ['时代背景', '地理', '势力', '法则', '物种', '历史'] // 世界观词条的分类列表
const typeOptions = computed(() =>
  [...new Set([...entryTypes, ...appStore.worldviewEntries.map((entry) => entry.type.trim()).filter(Boolean)])]
    .map((type) => ({ label: type, value: type }))
)

function compactForAi(value: unknown, maxLength: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function buildAiWorldviewContext() {
  return appStore.worldviewEntries.slice(0, 12).map((entry) => ({
    type: entry.type,
    title: entry.title,
    content: compactForAi(entry.content, 320)
  }))
}

function buildAiCharactersContext() {
  return appStore.characters.slice(0, 12).map((character) => ({
    name: character.name,
    role: character.role,
    description: compactForAi(character.description, 240)
  }))
}

function buildAiOrganizationsContext() {
  return appStore.organizations.slice(0, 8).map((organization) => ({
    name: organization.name,
    type: organization.type,
    description: compactForAi(organization.description, 240),
    motto: compactForAi(organization.motto, 100)
  }))
}

function buildAiOutlineContext() {
  return appStore.outlineItems.slice(-12).map((item) => ({
    title: item.title,
    conflict: compactForAi(item.conflict, 160),
    summary: compactForAi(item.summary, 280)
  }))
}
// 根据搜索关键词过滤词条列表，在标题、类型和内容中进行全文匹配
const filteredEntries = computed(() => {
  const query = [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase()
  return appStore.worldviewEntries.filter((entry) => {
    const matchesType = !typeFilter.value || entry.type.trim() === typeFilter.value
    const matchesQuery = !query || `${entry.type} ${entry.title} ${entry.content} ${(entry.tags ?? []).join(' ')}`.toLowerCase().includes(query)
    return matchesType && matchesQuery
  })
})
const visibleEntries = useIncrementalList(
  filteredEntries,
  computed(() => `${props.searchQuery ?? ''}\u0000${keyword.value}\u0000${typeFilter.value ?? ''}`)
)
const isEditing = computed(() => Boolean(editingEntryId.value)) // 判断当前是编辑模式还是新建模式
const menuOptions: DropdownOption[] = [ // 词条卡片的右键菜单选项
  { key: 'edit', label: '编辑词条' },
  { key: 'delete', label: '删除词条' }
]

// 格式化词条的更新时间为中文简短格式（月/日 时:分）
function formatEntryMetaTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '刚刚更新'
  }

  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 打开新建词条弹窗，重置表单为空白状态
function handleCreateEntry(): void {
  editingEntryId.value = null
  form.type = '地理'
  form.title = ''
  form.content = ''
  form.tags = []
  editorVisible.value = true
}

// 调用 AI 接口自动生成一条世界观词条草稿
async function handleGenerateEntry(payload: { count: number; prompt: string; types: string[] }): Promise<void> {
  if (isGenerating.value) {
    return
  }

  try {
    batchProgress.value = 0
    const entries = await generateCatalogBatch({
      mode: 'worldview',
      count: payload.count,
      label: '批量生成世界观',
      panel: 'world',
      kind: 'worldview',
      keyField: 'title',
      existingKeys: appStore.worldviewEntries.map((entry) => entry.title),
      onProgress: (completed, total) => { batchProgress.value = Math.round(completed / total * 100) },
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        userPrompt: payload.prompt,
        requestedTypes: payload.types,
        worldviewEntries: buildAiWorldviewContext(),
        characters: buildAiCharactersContext(),
        organizations: buildAiOrganizationsContext(),
        outlineItems: buildAiOutlineContext()
      }
    })
    entries.forEach((entry) => appStore.createWorldviewEntry({
      type: String(entry.type ?? payload.types[0] ?? '地理'),
      title: String(entry.title ?? '新世界观词条'),
      content: String(entry.content ?? 'AI 未返回有效内容'),
      tags: normalizeCatalogTags(entry.tags)
    }))
    batchVisible.value = false
    message.success(`已生成 ${entries.length} 条世界观设定`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 扩写失败，请检查模型配置')
  }
}

// 打开词条编辑弹窗，传入词条时为编辑模式，不传则为新建模式
function openEditor(entry?: WorldviewEntry): void {
  editingEntryId.value = entry?.id ?? null
  form.type = entry?.type ?? '地理'
  form.title = entry?.title ?? ''
  form.content = entry?.content ?? ''
  form.tags = normalizeCatalogTags(entry?.tags)
  editorVisible.value = true
}

// 提交词条表单：校验必填项后根据编辑/新建模式调用对应 store 方法
function submitEntry(): void {
  if (!form.title.trim() || !form.content.trim()) {
    message.warning('请完整填写词条标题和词条内容')
    return
  }

  if (editingEntryId.value) {
    appStore.updateWorldviewEntry(editingEntryId.value, { ...form, tags: form.tags })
    message.success('世界观词条已更新')
  } else {
    appStore.createWorldviewEntry({ ...form, tags: form.tags })
    message.success('已新增世界观词条')
  }

  editorVisible.value = false
}

// 处理词条卡片的下拉菜单操作：编辑或删除词条（删除前弹出二次确认）
function handleMenuSelect(action: string | number, entry: WorldviewEntry): void {
  if (action === 'edit') {
    openEditor(entry)
    return
  }

  dialog.warning({
    title: '确认删除词条',
    content: `确定要删除”${entry.title}”吗？删除后词条内容将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteWorldviewEntry(entry.id)
      message.success('世界观词条已删除')
    }
  })
}

// ── 批量删除 ──
const selectedEntryIdSet = computed(() => new Set(selectedEntryIds.value))
const batchDeleteAllSelected = computed(
  () => filteredEntries.value.length > 0 && selectedEntryIds.value.length === filteredEntries.value.length
)
function toggleSelectEntry(entryId: string): void {
  selectedEntryIds.value = selectedEntryIds.value.includes(entryId)
    ? selectedEntryIds.value.filter((id) => id !== entryId)
    : [...selectedEntryIds.value, entryId]
}
function toggleSelectAllEntries(): void {
  selectedEntryIds.value =
    batchDeleteAllSelected.value
      ? []
      : filteredEntries.value.map((entry) => entry.id)
}
function handleBatchDeleteEntries(): void {
  const ids = selectedEntryIds.value
  if (!ids.length) return
  dialog.warning({
    title: '确认批量删除',
    content: `确定要删除选中的 ${ids.length} 条世界观词条吗？删除后内容将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteWorldviewEntries(ids)
      selectedEntryIds.value = []
      message.success(`已删除 ${ids.length} 条世界观词条`)
    }
  })
}

function clearEntrySelection(): void {
  selectedEntryIds.value = []
}

// ── 批量导入 / 导出 ──
const importLoading = ref(false)
const exportLoading = ref(false)
// 批量导入 txt/md/json 世界观文件
async function handleBatchImport(): Promise<void> {
  if (importLoading.value) return
  importLoading.value = true
  try {
    const result = await window.characterArc.worldviewImport()
    if (!result.success) {
      if (!result.canceled) message.error(result.error ?? '导入失败')
      return
    }
    const entries = result.entries ?? []
    if (!entries.length) {
      message.warning('所选文件中没有可导入的世界观词条')
      return
    }
    let created = 0
    for (const entry of entries) {
      appStore.createWorldviewEntry({
        type: entry.type || '地理',
        title: entry.title,
        content: entry.content,
        tags: entry.tags ?? []
      })
      created += 1
    }
    if (result.warning) message.warning(`已导入 ${created} 条。${result.warning}`)
    else message.success(`已导入 ${created} 条世界观词条`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '批量导入失败')
  } finally {
    importLoading.value = false
  }
}
// 批量导出世界观词条为 txt / md / json / excel
async function handleBatchExport(format: 'txt' | 'md' | 'json' | 'excel'): Promise<void> {
  const ids = selectedEntryIds.value
  // 多选时仅导出勾选的内容；未勾选则导出当前全部词条
  const source = ids.length
    ? filteredEntries.value.filter((e) => ids.includes(e.id))
    : appStore.worldviewEntries
  // 解包 Vue reactive 代理并生成纯净的普通对象，避免 IPC 结构化克隆报错
  const entries = source
    .map((entry) => toRaw(entry))
    .map((entry) => ({
      type: String(entry?.type ?? ''),
      title: String(entry?.title ?? ''),
      content: String(entry?.content ?? ''),
      tags: Array.isArray(entry?.tags) ? entry.tags.map((tag) => String(tag ?? '')) : []
    }))
  if (!entries.length) {
    message.warning('当前没有可导出的世界观词条')
    return
  }
  exportLoading.value = true
  try {
    const result = await window.characterArc.worldviewExport(toIpcPayload({ format, entries }))
    if (!result.success) {
      if (!result.canceled) message.error(result.error ?? '导出失败')
      return
    }
    message.success(`已导出 ${entries.length} 条世界观词条`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败')
  } finally {
    exportLoading.value = false
  }
}
const exportMenuOptions: DropdownOption[] = [
  { key: 'md', label: '导出为 Markdown' },
  { key: 'txt', label: '导出为 TXT' },
  { key: 'json', label: '导出为 JSON' },
  { key: 'excel', label: '导出为 Excel 表格' }
]
function handleExportSelect(key: string | number): void {
  void handleBatchExport(key as 'txt' | 'md' | 'json' | 'excel')
}

// ── 批量修改分类 / 标签 ──
const batchEditVisible = ref(false)
const batchEditForm = reactive({ type: '地理', tags: [] as string[] })
function openBatchEdit(): void {
  if (!selectedEntryIds.value.length) {
    message.warning('请先勾选需要修改的世界观词条')
    return
  }
  batchEditForm.type = '地理'
  batchEditForm.tags = []
  batchEditVisible.value = true
}
function submitBatchEdit(): void {
  const ids = selectedEntryIds.value
  if (!ids.length) return
  if (batchEditForm.type) {
    appStore.updateWorldviewEntriesType(ids, batchEditForm.type)
  }
  if (batchEditForm.tags.length) {
    appStore.updateWorldviewEntriesTags(ids, batchEditForm.tags)
  }
  batchEditVisible.value = false
  selectedEntryIds.value = []
  message.success(`已批量更新 ${ids.length} 条世界观词条`)
}

const ENHANCE_TASK_KEY = 'worldview-enhance'
const enhanceLoading = computed(() => appStore.isAiTaskRunning(ENHANCE_TASK_KEY))
const enhanceVisible = ref(false)
const enhanceFields = ref<EnhanceFieldDiff[]>([])

async function handleAiEnhance(): Promise<void> {
  if (enhanceLoading.value) return

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: ENHANCE_TASK_KEY,
        kind: 'worldview',
        label: 'AI 补充世界观',
        description: '正在根据上下文补充世界观词条',
        panel: 'world'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'worldview-enhance',
          settings: appStore.appSettings,
          context: {
            projectId: appStore.currentProject?.id,
            currentForm: { type: form.type, title: form.title, content: form.content },
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            worldviewTitles: appStore.worldviewEntries.map((e) => e.title),
            characterNames: appStore.characters.map((c) => c.name),
            worldviewEntries: buildAiWorldviewContext(),
            characters: buildAiCharactersContext(),
            organizations: buildAiOrganizationsContext(),
            outlineItems: buildAiOutlineContext()
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 补充失败，请检查模型配置')
    }

    const suggested = result.result as { type?: string; title?: string; content?: string }

    enhanceFields.value = [
      { key: 'type', label: '词条分类', type: 'select', original: form.type, suggested: suggested.type ?? form.type, changed: (suggested.type ?? form.type) !== form.type && Boolean(suggested.type?.trim()) },
      { key: 'title', label: '词条标题', type: 'text', original: form.title, suggested: suggested.title ?? '', changed: (suggested.title ?? '') !== form.title && Boolean(suggested.title?.trim()) },
      { key: 'content', label: '词条内容', type: 'textarea', original: form.content, suggested: suggested.content ?? '', changed: (suggested.content ?? '') !== form.content && Boolean(suggested.content?.trim()) }
    ]
    enhanceVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 补充失败，请检查模型配置')
  }
}

function handleEnhanceApply(accepted: Record<string, string | string[]>): void {
  if (accepted.type != null) form.type = accepted.type as string
  if (accepted.title != null) form.title = accepted.title as string
  if (accepted.content != null) form.content = accepted.content as string
  enhanceVisible.value = false
}

watch(
  () => appStore.assistantFocusTarget,
  async (target) => {
    if (!target || target.panel !== 'world') {
      return
    }

    focusedEntryId.value = target.entityId
    await nextTick()
    document.querySelector<HTMLElement>(`[data-assistant-focus-id="${target.entityId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      appStore.clearAssistantFocusTarget('world', target.entityId)
      if (focusedEntryId.value === target.entityId) {
        focusedEntryId.value = ''
      }
    }, 2200)
  },
  { immediate: true }
)
</script>

<template>
  <section class="world-panel">
    <div class="section-head">
      <div class="section-title">
        <h2>世界观设定</h2>
      </div>
      <div class="head-actions">
        <n-button secondary strong :loading="importLoading" @click="handleBatchImport">
          <template #icon><Upload :size="16" /></template>
          批量导入
        </n-button>
        <n-dropdown :options="exportMenuOptions" placement="bottom-end" @select="handleExportSelect">
          <n-button secondary strong :loading="exportLoading">
            <template #icon><Download :size="16" /></template>
            批量导出
          </n-button>
        </n-dropdown>
        <n-button secondary strong :loading="isGenerating" @click="batchVisible = true">
          <template #icon><Sparkles :size="16" /></template>
          批量生成
        </n-button>
        <n-button type="primary" strong @click="handleCreateEntry">
          <template #icon><Plus :size="16" /></template>
          新建词条
        </n-button>
      </div>
    </div>

    <div class="catalog-toolbar">
      <div class="catalog-filters">
        <n-input v-model:value="keyword" class="entry-search" placeholder="搜索分类、标题或内容" clearable>
          <template #prefix><Search :size="16" /></template>
        </n-input>
        <n-select
          v-model:value="typeFilter"
          class="type-filter"
          :options="typeOptions"
          placeholder="全部分类"
          clearable
          filterable
        />
      </div>
      <div class="result-summary">
        <strong>{{ filteredEntries.length }}</strong>
        <span>/ {{ appStore.worldviewEntries.length }} 条设定</span>
      </div>
    </div>

    <BatchDeleteBar
      v-if="filteredEntries.length > 0"
      :selected-count="selectedEntryIds.length"
      :total-count="filteredEntries.length"
      item-label="世界观词条"
      :all-selected="batchDeleteAllSelected"
      @toggle-all="toggleSelectAllEntries"
      @delete-selected="handleBatchDeleteEntries"
      @clear="clearEntrySelection"
    />

    <div v-if="selectedEntryIds.length > 0" class="batch-edit-row">
      <n-button size="small" secondary strong @click="openBatchEdit">
        <template #icon><Tags :size="14" /></template>
        批量修改分类/标签 ({{ selectedEntryIds.length }})
      </n-button>
    </div>

    <BatchGenerateDialog
      :show="batchVisible"
      title="批量生成世界观"
      description="按所选分类补齐世界设定，生成结果会自动避开已有标题。"
      item-label="设定"
      :loading="isGenerating"
      :progress="batchProgress"
      :type-options="typeOptions.filter((option) => option.value !== '历史')"
      :default-types="['势力', '地理', '法则', '物种']"
      allow-custom-types
      @close="batchVisible = false"
      @background="batchVisible = false"
      @submit="handleGenerateEntry"
    />

    <div v-if="filteredEntries.length > 0" class="world-list">
      <div class="world-list-head" aria-hidden="true">
        <span class="col-check">选</span>
        <span>分类</span>
        <span>设定内容</span>
        <span>更新信息</span>
        <span>操作</span>
      </div>
      <article
        v-for="entry in visibleEntries"
        :key="entry.id"
        class="world-row"
        :class="{ 'assistant-focused': focusedEntryId === entry.id }"
        :data-assistant-focus-id="entry.id"
        @click="openEditor(entry)"
      >
        <label class="row-check" title="勾选以便批量删除" @click.stop>
          <input
            type="checkbox"
            :checked="selectedEntryIdSet.has(entry.id)"
            @change="toggleSelectEntry(entry.id)"
          />
        </label>
        <span class="entry-type" :title="entry.type">{{ entry.type }}</span>
        <div class="entry-main">
          <h3>{{ entry.title }}</h3>
          <p :title="entry.content">{{ entry.content }}</p>
          <div v-if="(entry.tags ?? []).length" class="entry-tags">
            <n-tag v-for="tag in (entry.tags ?? []).slice(0, 3)" :key="tag" size="tiny" :bordered="false">
              {{ tag }}
            </n-tag>
            <span v-if="(entry.tags ?? []).length > 3" class="tag-overflow">+{{ (entry.tags ?? []).length - 3 }}</span>
          </div>
        </div>
        <div class="entry-meta">
          <span>更新于 {{ formatEntryMetaTime(entry.updatedAt) }}</span>
          <small>排序 {{ entry.sortOrder + 1 }}</small>
        </div>
        <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, entry)">
          <button class="more-button" type="button" title="更多操作" aria-label="更多操作" @click.stop>
            <MoreVertical :size="16" />
          </button>
        </n-dropdown>
      </article>
    </div>

    <div v-if="filteredEntries.length === 0" class="arc-empty-state">
      {{ appStore.worldviewEntries.length === 0 ? '还没有世界观设定，先新建一条词条。' : '没有匹配当前筛选条件的世界观设定。' }}
    </div>

    <n-modal
      :show="editorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="isEditing ? '编辑世界观词条' : '新建世界观词条'"
      :bordered="false"
      @close="editorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <n-form-item label="词条分类">
              <n-select v-model:value="form.type" :options="typeOptions" />
            </n-form-item>
            <n-form-item label="词条标题">
              <n-input v-model:value="form.title" placeholder="例如：新法则 / 地理区域 / 势力设定" />
            </n-form-item>
            <n-form-item label="词条标签">
              <n-dynamic-tags v-model:value="form.tags" placeholder="输入标签后回车" />
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">词条内容</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="form.content"
              type="textarea"
              placeholder="补充这个词条的核心设定与作用..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ form.content.length }} 字</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button round strong :loading="enhanceLoading" @click="handleAiEnhance">
            <template #icon><Sparkles :size="14" /></template>
            AI 补充
          </n-button>
          <n-button type="primary" round strong @click="submitEntry">
            {{ isEditing ? '保存修改' : '创建词条' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <n-modal
      :show="batchEditVisible"
      preset="card"
      style="width: min(460px, 92vw)"
      title="批量修改分类/标签"
      :bordered="false"
      @close="batchEditVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="分类">
          <n-select v-model:value="batchEditForm.type" :options="typeOptions" placeholder="选择要设置的分类" />
        </n-form-item>
        <n-form-item label="标签">
          <n-dynamic-tags v-model:value="batchEditForm.tags" placeholder="输入标签后回车，可添加多个" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="arc-modal-footer">
          <div class="arc-modal-footer-right">
            <n-button round strong @click="batchEditVisible = false">取消</n-button>
            <n-button type="primary" round strong @click="submitBatchEdit">确认修改</n-button>
          </div>
        </div>
      </template>
    </n-modal>

    <AiEnhancePreview
      :show="enhanceVisible"
      :fields="enhanceFields"
      :loading="enhanceLoading"
      @apply="handleEnhanceApply"
      @close="enhanceVisible = false"
    />
  </section>
</template>

<style scoped>
.world-panel {
  max-width: 1180px;
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
}

.entry-search {
  width: min(360px, 38vw);
}

.type-filter {
  width: 180px;
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

.world-list {
  overflow: hidden;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
}

.world-list-head,
.world-row {
  display: grid;
  grid-template-columns: 24px 104px minmax(0, 1fr) 150px 36px;
  align-items: center;
  gap: 12px;
}
.col-check {
  font-size: 11px;
  text-align: center;
}
.row-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.row-check input[type='checkbox'],
.col-check {
  accent-color: var(--arc-danger);
  cursor: pointer;
}

.world-list-head {
  min-height: 38px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-mix);
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 700;
  padding: 0 14px;
}

.world-row {
  min-height: 92px;
  border-bottom: 1px solid var(--arc-border);
  padding: 12px 14px;
  cursor: pointer;
  transition: background 0.16s ease;
}

.world-row:last-child {
  border-bottom: none;
}

.world-row:hover {
  background: color-mix(in srgb, var(--arc-primary) 3%, var(--arc-bg-surface));
}

.world-row.assistant-focused {
  position: relative;
  background: color-mix(in srgb, var(--arc-accent) 8%, var(--arc-bg-surface));
  box-shadow: inset 3px 0 0 var(--arc-accent);
}

.entry-type {
  display: block;
  max-width: 100%;
  overflow: hidden;
  border-radius: 4px;
  background: color-mix(in srgb, var(--arc-primary) 7%, var(--arc-bg-mix));
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 5px 8px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-main {
  min-width: 0;
}

.entry-main h3 {
  margin: 0 0 5px;
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.world-row:hover .entry-main h3 {
  color: var(--arc-primary);
}

.entry-main p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.entry-tags {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.tag-overflow {
  color: var(--arc-text-hint);
  font-size: 11px;
}

.batch-edit-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.entry-meta {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 4px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.entry-meta small {
  color: var(--arc-text-hint);
  font-size: 11px;
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

@media (max-width: 860px) {
  .section-head {
    align-items: flex-start;
  }

  .head-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .catalog-filters {
    flex: 1;
  }

  .entry-search {
    width: 100%;
  }

  .world-list-head,
  .world-row {
    grid-template-columns: 86px minmax(0, 1fr) 36px;
  }

  .world-list-head span:nth-child(3),
  .entry-meta {
    display: none;
  }
}

@media (max-width: 680px) {
  .head-actions :deep(.n-button) {
    flex: 1 1 calc(50% - 6px);
  }

  .catalog-toolbar,
  .catalog-filters {
    align-items: stretch;
    flex-direction: column;
  }

  .type-filter {
    width: 100%;
  }

  .result-summary {
    align-self: flex-end;
  }

  .world-list-head {
    display: none;
  }

  .world-row {
    grid-template-columns: minmax(0, 1fr) 32px;
    gap: 10px;
  }

  .entry-type {
    width: fit-content;
    max-width: 160px;
    grid-column: 1;
  }

  .entry-main {
    grid-column: 1;
  }

  .more-button {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
}
</style>
