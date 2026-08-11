<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { BookMarked, CheckCircle, Circle, MoreVertical, Plus, Sparkles } from 'lucide-vue-next'
import { NButton, NDivider, NDynamicTags, NDropdown, NEmpty, NForm, NFormItem, NInput, NInputNumber, NModal, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import BatchDeleteBar from './BatchDeleteBar.vue'
import { useAppStore } from '@/stores/app'
import type { DropdownOption } from 'naive-ui'
import type { PlotThread } from '@/types/app'
import { useIncrementalList } from '@/composables/useIncrementalList'
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
  closedInChapterId: '',
  status: 'open' as 'open' | 'resolved',
  tags: [] as string[]
})

// 按 open/resolved 分组过滤
const filteredThreads = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  const threads = appStore.plotThreads
  if (!query) return threads
  return threads.filter((t) =>
    `${t.title} ${t.description} ${t.tags.join(' ')}`.toLowerCase().includes(query)
  )
})

const openThreads = computed(() => filteredThreads.value.filter((t) => t.status === 'open'))
const resolvedThreads = computed(() => filteredThreads.value.filter((t) => t.status === 'resolved'))
const threadResetKey = computed(() => props.searchQuery?.trim().toLowerCase() ?? '')
const visibleOpenThreads = useIncrementalList(openThreads, threadResetKey, { initialSize: 30, batchSize: 30 })
const visibleResolvedThreads = useIncrementalList(resolvedThreads, threadResetKey, { initialSize: 30, batchSize: 30 })
const isEditing = computed(() => Boolean(editingThreadId.value))

// 章节选项，用于关联哪章埋下/哪章收束
const chapterOptions = computed(() =>
  appStore.chapters.map((c) => ({ label: c.title || '未命名章节', value: c.id }))
)

const menuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑线索' },
  { key: 'toggle', label: '切换状态' },
  { key: 'delete', label: '删除线索' }
]

// ── 批量删除 ──
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
    content: `确定要删除选中的 ${ids.length} 条剧情线索吗？删除后无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deletePlotThreads(ids)
      selectedThreadIds.value = []
      message.success(`已删除 ${ids.length} 条剧情线索`)
    }
  })
}
function clearThreadSelection(): void {
  selectedThreadIds.value = []
}

function openCreateEditor(): void {
  editingThreadId.value = null
  form.title = ''
  form.description = ''
  form.openedInChapterId = appStore.selectedChapterId ?? ''
  form.closedInChapterId = ''
  form.status = 'open'
  form.tags = []
  editorVisible.value = true
}

function openEditEditor(thread: PlotThread): void {
  editingThreadId.value = thread.id
  form.title = thread.title
  form.description = thread.description
  form.openedInChapterId = thread.openedInChapterId
  form.closedInChapterId = thread.closedInChapterId ?? ''
  form.status = thread.status
  form.tags = [...thread.tags]
  editorVisible.value = true
}

function handleMenuSelect(key: string, thread: PlotThread): void {
  if (key === 'edit') {
    openEditEditor(thread)
  } else if (key === 'toggle') {
    const nextStatus = thread.status === 'open' ? 'resolved' : 'open'
    appStore.updatePlotThread(thread.id, {
      status: nextStatus,
      closedInChapterId: nextStatus === 'resolved' ? (appStore.selectedChapterId ?? '') : undefined
    })
    message.success(nextStatus === 'resolved' ? '已标记为已收尾' : '已重新激活')
  } else if (key === 'delete') {
    dialog.warning({
      title: '删除线索',
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
    message.warning('请填写线索标题')
    return
  }

  if (editingThreadId.value) {
    appStore.updatePlotThread(editingThreadId.value, {
      title: form.title.trim(),
      description: form.description.trim(),
      openedInChapterId: form.openedInChapterId,
      closedInChapterId: form.status === 'resolved' ? form.closedInChapterId : undefined,
      status: form.status,
      tags: form.tags
    })
    message.success('已更新')
  } else {
    appStore.createPlotThread({
      title: form.title.trim(),
      description: form.description.trim(),
      openedInChapterId: form.openedInChapterId,
      status: 'open',
      tags: form.tags
    })
    message.success('已添加')
  }
  editorVisible.value = false
}

function chapterTitleById(id: string): string {
  return appStore.chapters.find((c) => c.id === id)?.title || id || '未知章节'
}

function formatTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '刚刚'
  return parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── AI 批量生成剧情线索 ──
const BATCH_TASK_KEY = 'plot-thread-batch'
const batchLoading = computed(() => appStore.isAiTaskRunning(BATCH_TASK_KEY))
const batchModalVisible = ref(false)
const batchFocusModalVisible = ref(false)
const batchFocus = ref('')
// 批量生成的数量设置（1-10 条）
const batchCount = ref(5)
const generatedThreads = ref<Array<{ title: string; description: string; tags: string[]; selected: boolean }>>([])

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
    .map((t) => (t.status === 'open' ? `${t.title}（${t.description}）` : t.title))
  batchFocusModalVisible.value = false

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: BATCH_TASK_KEY,
        kind: 'plot-thread',
        label: 'AI 批量生成剧情线索',
        description: '正在根据大纲/角色/世界观批量设计伏笔与悬念',
        panel: 'plot-threads'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'plot-thread-batch',
          settings: appStore.appSettings,
          context: {
            projectId: project.id,
            projectTitle: project.title,
            projectGenre: project.genre,
            count: batchCount.value,
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
            characterRelationships: appStore.characterRelationships.slice(0, 12).map((r) => ({
              fromCharacterId: r.fromCharacterId, toCharacterId: r.toCharacterId, type: r.type, description: compactForAi(r.description, 160)
            })),
            outlineItems: appStore.outlineItems.slice(-12).map((item) => ({
              title: item.title, conflict: compactForAi(item.conflict, 140), summary: compactForAi(item.summary, 240)
            }))
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 批量生成剧情线索失败')
    }

    const entries = Array.isArray((result.result as Record<string, unknown>)?.entries)
      ? ((result.result as Record<string, unknown>).entries as Array<Record<string, unknown>>)
      : []

    if (entries.length === 0) {
      message.warning('AI 未返回有效的剧情线索')
      return
    }

    generatedThreads.value = entries.map((e) => ({
      title: String(e.title ?? '未命名伏笔'),
      description: String(e.description ?? '暂无描述'),
      tags: Array.isArray(e.tags) ? (e.tags as string[]).map(String).filter(Boolean) : [],
      selected: true
    }))
    batchModalVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 批量生成剧情线索失败，请检查模型配置')
  }
}

function openBatchGenerate(): void {
  batchFocus.value = ''
  batchCount.value = 5
  generatedThreads.value = []
  batchFocusModalVisible.value = true
}

function toggleGeneratedThread(index: number): void {
  generatedThreads.value[index].selected = !generatedThreads.value[index].selected
}

function confirmAddGeneratedThreads(): void {
  const toAdd = generatedThreads.value.filter((t) => t.selected)
  if (!toAdd.length) {
    message.warning('请至少勾选一条线索')
    return
  }
  const openedInChapterId = appStore.selectedChapterId ?? ''
  toAdd.forEach((t) => {
    appStore.createPlotThread({
      title: t.title,
      description: t.description,
      openedInChapterId,
      status: 'open',
      tags: t.tags
    })
  })
  message.success(`已添加 ${toAdd.length} 条剧情线索`)
  batchModalVisible.value = false
}
</script>

<template>
  <div class="threads-panel arc-scrollbar">
    <!-- 顶部工具栏 -->
    <div class="panel-toolbar">
      <div class="toolbar-stats">
        <span class="stat-badge open">活跃 {{ openThreads.length }}</span>
        <span class="stat-badge resolved">已收尾 {{ resolvedThreads.length }}</span>
      </div>
      <div class="toolbar-actions">
        <n-button
          size="small"
          secondary
          type="info"
          :loading="batchLoading"
          :disabled="batchLoading"
          @click="openBatchGenerate"
        >
          <template #icon><Sparkles :size="14" /></template>
          AI 批量生成
        </n-button>
        <n-button size="small" type="primary" @click="openCreateEditor">
          <template #icon><Plus :size="14" /></template>
          新建线索
        </n-button>
      </div>
    </div>

    <BatchDeleteBar
      v-if="filteredThreads.length > 0"
      :selected-count="selectedThreadIds.length"
      :total-count="filteredThreads.length"
      item-label="剧情线索"
      :all-selected="batchDeleteAllThreads"
      @toggle-all="toggleSelectAllThreads"
      @delete-selected="handleBatchDeleteThreads"
      @clear="clearThreadSelection"
    />

    <!-- 活跃线索 -->
    <div v-if="openThreads.length > 0" class="thread-group">
      <div class="group-label"><Circle :size="13" class="group-icon open-icon" /> 活跃伏笔</div>
      <div
        v-for="thread in visibleOpenThreads"
        :key="thread.id"
        class="thread-card"
      >
        <div class="thread-header">
          <label class="row-check" title="勾选以便批量删除" @click.stop>
            <input
              type="checkbox"
              :checked="selectedThreadIdSet.has(thread.id)"
              @change="toggleSelectThread(thread.id)"
            />
          </label>
          <div class="thread-title">{{ thread.title }}</div>
          <n-dropdown :options="menuOptions" @select="(key: string) => handleMenuSelect(key, thread)">
            <n-button text size="tiny" class="more-btn">
              <MoreVertical :size="14" />
            </n-button>
          </n-dropdown>
        </div>
        <div v-if="thread.description" class="thread-desc">{{ thread.description }}</div>
        <div class="thread-meta">
          <span v-if="thread.openedInChapterId" class="meta-item">
            埋入：{{ chapterTitleById(thread.openedInChapterId) }}
          </span>
          <span v-if="thread.tags.length" class="thread-tags">
            <n-tag
              v-for="tag in thread.tags"
              :key="tag"
              size="tiny"
              :bordered="false"
              class="tag-chip"
            >{{ tag }}</n-tag>
          </span>
          <span class="meta-time">{{ formatTime(thread.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- 已收尾线索 -->
    <div v-if="resolvedThreads.length > 0" class="thread-group resolved-group">
      <n-divider class="group-divider" />
      <div class="group-label"><CheckCircle :size="13" class="group-icon resolved-icon" /> 已收尾</div>
      <div
        v-for="thread in visibleResolvedThreads"
        :key="thread.id"
        class="thread-card resolved-card"
      >
        <div class="thread-header">
          <label class="row-check" title="勾选以便批量删除" @click.stop>
            <input
              type="checkbox"
              :checked="selectedThreadIdSet.has(thread.id)"
              @change="toggleSelectThread(thread.id)"
            />
          </label>
          <div class="thread-title resolved-title">{{ thread.title }}</div>
          <n-dropdown :options="menuOptions" @select="(key: string) => handleMenuSelect(key, thread)">
            <n-button text size="tiny" class="more-btn">
              <MoreVertical :size="14" />
            </n-button>
          </n-dropdown>
        </div>
        <div v-if="thread.description" class="thread-desc resolved-desc">{{ thread.description }}</div>
        <div class="thread-meta">
          <span v-if="thread.openedInChapterId" class="meta-item">
            埋入：{{ chapterTitleById(thread.openedInChapterId) }}
          </span>
          <span v-if="thread.closedInChapterId" class="meta-item">
            收尾：{{ chapterTitleById(thread.closedInChapterId) }}
          </span>
          <span class="meta-time">{{ formatTime(thread.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="openThreads.length === 0 && resolvedThreads.length === 0" class="empty-state">
      <n-empty description="暂无剧情线索">
        <template #icon><BookMarked :size="32" class="empty-icon" /></template>
        <template #extra>
          <n-button size="small" @click="openCreateEditor">添加第一条线索</n-button>
        </template>
      </n-empty>
    </div>

    <!-- 新建/编辑弹窗 -->
    <n-modal
      v-model:show="editorVisible"
      preset="card"
      :title="isEditing ? '编辑线索' : '新建线索'"
      class="arc-editor-modal-wide"
      :mask-closable="false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top" :show-feedback="false" class="thread-form">
            <n-form-item label="线索标题" required>
              <n-input v-model:value="form.title" placeholder="如：林莫的穿越遗物" maxlength="60" show-count />
            </n-form-item>
            <n-form-item label="埋入章节">
              <n-select
                v-model:value="form.openedInChapterId"
                :options="chapterOptions"
                placeholder="选择埋入的章节"
                clearable
                filterable
              />
            </n-form-item>
            <n-form-item v-if="isEditing" label="状态">
              <n-select
                v-model:value="form.status"
                :options="[{ label: '活跃（未收尾）', value: 'open' }, { label: '已收尾', value: 'resolved' }]"
              />
            </n-form-item>
            <n-form-item v-if="form.status === 'resolved'" label="收尾章节">
              <n-select
                v-model:value="form.closedInChapterId"
                :options="chapterOptions"
                placeholder="选择收尾的章节"
                clearable
                filterable
              />
            </n-form-item>
            <n-form-item label="关联标签">
              <n-dynamic-tags v-model:value="form.tags" />
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

    <!-- AI 批量生成：重点方向输入 -->
    <n-modal
      v-model:show="batchFocusModalVisible"
      preset="card"
      title="AI 批量生成剧情线索"
      style="width: 520px"
      :mask-closable="false"
    >
      <p class="ai-modal-hint">
        将根据项目的大纲、角色、世界观和已有线索，批量设计相互衔接的伏笔与悬念。可选填一个重点方向。
      </p>
      <n-input
        v-model:value="batchFocus"
        type="textarea"
        :rows="3"
        placeholder="如：围绕主角身世 / 反派势力的阴谋 / 下一卷的冲突重点（可留空）"
      />
      <div class="ai-modal-count-row" style="margin-top: 12px; display: flex; align-items: center; gap: 10px">
        <span class="ai-modal-count-label">生成数量</span>
        <n-input-number v-model:value="batchCount" :min="1" :max="10" :step="1" style="width: 120px" />
        <span class="ai-modal-count-hint" style="color: var(--arc-text-hint); font-size: 12px">1~10 条</span>
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
      title="AI 批量生成的剧情线索"
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
}

.toolbar-stats {
  display: flex;
  align-items: center;
  gap: 8px;
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

.stat-badge.open {
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 24%, var(--arc-border));
}

.thread-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.resolved-group {
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

.open-icon {
  color: var(--arc-primary);
}

.resolved-icon {
  color: var(--arc-success, #15803d);
}

.group-divider {
  margin: 4px 0 8px;
}

.thread-card {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: border-color 0.15s;
}

.thread-card:hover {
  border-color: var(--arc-border-strong);
}

.resolved-card {
  opacity: 0.65;
  background: var(--arc-bg-body);
}

.thread-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.row-check {
  display: inline-flex;
  align-items: center;
  padding-top: 1px;
  flex-shrink: 0;
}
.row-check input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--arc-danger);
  cursor: pointer;
}

.thread-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
  line-height: 1.4;
  flex: 1;
}

.resolved-title {
  text-decoration: line-through;
  color: var(--arc-text-hint);
}

.more-btn {
  flex-shrink: 0;
  color: var(--arc-text-hint);
}

.thread-desc {
  font-size: 12px;
  color: var(--arc-text-secondary);
  line-height: 1.55;
}

.resolved-desc {
  color: var(--arc-text-hint);
}

.thread-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.meta-item {
  font-size: 11px;
  color: var(--arc-text-hint);
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

.meta-time {
  font-size: 11px;
  color: var(--arc-text-hint);
  margin-left: auto;
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
