<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { ArrowDown, ArrowUp, ArrowUpDown, CheckSquare, Square, Trash2, Wand2, X } from 'lucide-vue-next'
import type { ProjectSummary } from '@/types/app'
import { useAppStore } from '@/stores/app'
import HomepageProjectCard from './HomepageProjectCard.vue'

/** 首页“我的作品”的排序维度 */
type SortDimension = 'created' | 'edited' | 'wordCount' | 'titleLength'
/** 排序方向：asc 升序 / desc 降序 */
type SortDirection = 'asc' | 'desc'
/** 完整排序方式（含手动） */
type SortMode = SortDimension | 'manual'

/** 各排序维度的展示名与用户首选方向 */
const SORT_OPTIONS: { key: SortDimension; label: string; defaultDirection: SortDirection }[] = [
  { key: 'created', label: '按建立时间', defaultDirection: 'asc' }, // 最早在前
  { key: 'edited', label: '按最近编辑', defaultDirection: 'desc' }, // 最新编辑在前
  { key: 'wordCount', label: '按作品字数', defaultDirection: 'desc' }, // 字数最多在前
  { key: 'titleLength', label: '按作品名称', defaultDirection: 'desc' } // 名称最长在前
]

/** 每个维度的方向文案（用于悬浮窗中的方向切换） */
const DIRECTION_LABEL: Record<SortDirection, string> = {
  asc: '升序',
  desc: '降序'
}

const props = defineProps<{
  projects: ProjectSummary[]
  menuOptions: DropdownOption[]
}>()

const emit = defineEmits<{
  (e: 'open', projectId: string): void
  (e: 'menuSelect', action: string | number, projectId: string): void
  (e: 'batchDelete', projectIds: string[]): void
  (e: 'batchCreate'): void
  (e: 'reorder', projectIds: string[]): void
}>()

const appStore = useAppStore()

const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
/** 当前排序方式，默认按建立时间（最早在前），持久化在 store */
const sortMode = computed<SortMode>(() => {
  const stored = appStore.projectSortMode
  if (stored === 'manual') return 'manual'
  return SORT_OPTIONS.some((o) => o.key === stored) ? (stored as SortMode) : 'created'
})
/** 当前排序维度的方向（默认取该维度的首选方向，持久化在 store） */
const sortDirection = computed<SortDirection>(() => {
  if (sortMode.value === 'manual') return 'asc'
  const opt = SORT_OPTIONS.find((o) => o.key === sortMode.value)
  return appStore.projectSortDirections[sortMode.value] ?? opt?.defaultDirection ?? 'asc'
})
/** 悬浮窗中每个维度当前应展示的方向（升/降） */
const dimensionDirection = (key: SortDimension): SortDirection =>
  appStore.projectSortDirections[key] ?? SORT_OPTIONS.find((o) => o.key === key)?.defaultDirection ?? 'asc'
const sortVisible = ref(false)

const allSelected = computed(() =>
  props.projects.length > 0 && selectedIds.value.size === props.projects.length
)

const selectedCount = computed(() => selectedIds.value.size)

/** 展示用作品列表：手动模式直接使用 store 已排好的顺序，其余按所选维度 + 方向实时排序 */
const displayProjects = computed<ProjectSummary[]>(() => {
  if (sortMode.value === 'manual') {
    return props.projects
  }
  const list = [...props.projects]
  const mode = sortMode.value as SortDimension
  const dir = sortDirection.value
  list.sort((a, b) => {
    // 统一先按“升序基准”比较，再按方向决定正反
    let base = 0
    if (mode === 'created') {
      base = toTimestamp(a.createdAt) - toTimestamp(b.createdAt)
    } else if (mode === 'edited') {
      base = toTimestamp(a.lastEdited) - toTimestamp(b.lastEdited)
    } else if (mode === 'wordCount') {
      base = parseWordCount(a.wordCount) - parseWordCount(b.wordCount)
    } else {
      base = (a.title?.length ?? 0) - (b.title?.length ?? 0)
    }
    return dir === 'asc' ? base : -base
  })
  return list
})

/** 把 ISO 时间戳（或“刚刚更新”等占位文案）解析为可比较的毫秒数，非法值一律按 0 处理 */
function toTimestamp(value?: string): number {
  const raw = (value || '').trim()
  if (!raw) return 0
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** 从“1,234 字”“待统计”等展示文本中解析出纯数字，用于按字数比较 */
function parseWordCount(value?: string): number {
  const cleaned = (value || '').replace(/[^0-9]/g, '')
  return cleaned ? Number(cleaned) : 0
}

// 项目增删时同步选中状态（手动模式顺序由 store 的 reorderProjects 统一维护）
watch(
  () => props.projects.map((p) => p.id).join(','),
  () => {
    const validIds = new Set(props.projects.map((p) => p.id))
    const next = new Set(Array.from(selectedIds.value).filter((id) => validIds.has(id)))
    if (next.size !== selectedIds.value.size) {
      selectedIds.value = next
    }
    if (next.size === 0 && selectMode.value) {
      selectMode.value = false
    }
  }
)

/** 手动排序中上移/下移一个位置，并将新顺序持久化到 store */
function moveProject(projectId: string, direction: 'up' | 'down'): void {
  const order = displayProjects.value.map((p) => p.id)
  const index = order.indexOf(projectId)
  if (index < 0) return
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= order.length) return
  const next = [...order]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  emit('reorder', next)
}

/** 在悬浮窗中选中某个排序维度 */
function selectSort(dimension: SortDimension): void {
  if (sortMode.value === 'manual' || sortMode.value !== dimension) {
    appStore.setProjectSortMode(dimension)
  }
  sortVisible.value = false
}

/** 切换某个排序维度的升/降方向 */
function toggleDirection(dimension: SortDimension): void {
  const next: SortDirection = dimensionDirection(dimension) === 'asc' ? 'desc' : 'asc'
  appStore.setProjectSortDirection(dimension, next)
}

/** 是否开启手动排序 */
function enableManualSort(): void {
  appStore.setProjectSortMode('manual')
  sortVisible.value = false
}

function toggleSelect(projectId: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(projectId)) {
    next.delete(projectId)
  } else {
    next.add(projectId)
  }
  selectedIds.value = next
  if (next.size === 0) {
    selectMode.value = false
  }
}

function enterSelectMode(): void {
  selectMode.value = true
}

function exitSelectMode(): void {
  selectMode.value = false
  selectedIds.value = new Set()
}

function toggleSelectAll(): void {
  if (allSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(props.projects.map((project) => project.id))
  }
}

function handleBatchDelete(): void {
  if (selectedIds.value.size === 0) {
    return
  }
  emit('batchDelete', Array.from(selectedIds.value))
}
</script>

<template>
  <section class="project-collection">
    <div v-if="!projects.length" class="homepage-empty-state">
      <n-empty description="还没有作品">
        <template #extra>
          <p class="empty-hint">先创建一个项目，然后从这里继续写作。</p>
        </template>
      </n-empty>
    </div>

    <template v-else>
      <div class="project-collection-header">
        <div class="project-collection-tools">
          <template v-if="!selectMode">
            <n-popover
              v-model:show="sortVisible"
              trigger="click"
              placement="bottom-start"
              :show-arrow="false"
              class="sort-popover"
            >
              <template #trigger>
                <button class="sort-btn" :title="`排序：${SORT_OPTIONS.find((o) => o.key === sortMode)?.label ?? ''}（${sortMode === 'manual' ? '手动排序' : (sortDirection === 'asc' ? '最早/最短/最少/最早编辑' : '最晚/最长/最多/最新编辑')}）`" aria-label="选择排序方式">
                  <ArrowUpDown :size="15" />
                </button>
              </template>
              <div class="sort-popover-body">
                <p class="sort-popover-title">选择排序方式</p>
                <div
                  v-for="opt in SORT_OPTIONS"
                  :key="opt.key"
                  class="sort-option"
                  :class="{ active: sortMode === opt.key }"
                  @click="selectSort(opt.key)"
                >
                  <span class="sort-option-label">{{ opt.label }}</span>
                  <button
                    class="sort-option-dir"
                    :title="`切换方向：当前${DIRECTION_LABEL[dimensionDirection(opt.key)]}`"
                    @click.stop="toggleDirection(opt.key)"
                  >
                    <ArrowUp v-if="dimensionDirection(opt.key) === 'asc'" :size="13" />
                    <ArrowDown v-else :size="13" />
                  </button>
                </div>
                <div
                  class="sort-option"
                  :class="{ active: sortMode === 'manual' }"
                  @click="enableManualSort"
                >
                  <span class="sort-option-label">手动排序</span>
                  <span class="sort-option-dir manual-dir">箭头调整</span>
                </div>
              </div>
            </n-popover>
            <button class="batch-mode-btn" title="批量管理" @click="enterSelectMode">
              <CheckSquare :size="14" />
              批量管理
            </button>
            <button class="batch-create-btn" title="批量生成作品" @click="emit('batchCreate')">
              <Wand2 :size="14" />
              批量生成作品
            </button>
          </template>
          <template v-else>
            <div class="batch-toolbar">
              <button class="batch-tool-btn" :class="{ 'is-active': allSelected }" @click="toggleSelectAll">
                <Square v-if="!allSelected" :size="14" />
                <CheckSquare v-else :size="14" />
                全选
              </button>
              <button class="batch-tool-btn" @click="exitSelectMode">
                <X :size="14" />
                退出
              </button>
              <span class="batch-count">已选 {{ selectedCount }} 个</span>
              <n-button
                type="error"
                size="small"
                :disabled="selectedCount === 0"
                @click="handleBatchDelete"
              >
                <template #icon><Trash2 :size="14" /></template>
                删除所选
              </n-button>
            </div>
          </template>
        </div>
      </div>

      <transition-group
        name="project-grid-move"
        tag="div"
        class="project-grid"
      >
        <HomepageProjectCard
          v-for="(project, index) in displayProjects"
          :key="project.id"
          :project="project"
          :menu-options="menuOptions"
          :animation-delay="`${index * 35}ms`"
          :select-mode="selectMode"
          :selected="selectedIds.has(project.id)"
          :manual-sort="sortMode === 'manual'"
          :move-up-disabled="sortMode === 'manual' && index === 0"
          :move-down-disabled="sortMode === 'manual' && index === displayProjects.length - 1"
          @open="emit('open', $event)"
          @menu-select="(action, projectId) => emit('menuSelect', action, projectId)"
          @toggle-select="toggleSelect"
          @move-up="(projectId) => moveProject(projectId, 'up')"
          @move-down="(projectId) => moveProject(projectId, 'down')"
        />
      </transition-group>
    </template>
  </section>
</template>

<style scoped>
.project-collection {
  min-width: 0;
}

.project-collection-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-bottom: 12px;
}

.project-collection-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sort-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.2s, color 0.2s, background 0.2s, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.sort-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  transform: translateY(-1px);
}

.sort-btn:active {
  transform: translateY(0) scale(0.94);
}

/* 排序悬浮窗 */
.sort-popover-body {
  min-width: 210px;
  padding: 4px;
}

.sort-popover-title {
  margin: 0 0 4px;
  padding: 2px 8px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--arc-text-hint);
  border-bottom: 1px solid var(--arc-border);
}

.sort-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--arc-text-secondary);
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
}

.sort-option:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}

.sort-option.active {
  color: var(--arc-primary);
  font-weight: 600;
  background: color-mix(in srgb, var(--arc-primary) 7%, var(--arc-bg-surface));
}

.sort-option-label {
  white-space: nowrap;
}

.sort-option-dir {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.sort-option-dir:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
}

.sort-option.active .sort-option-dir {
  color: var(--arc-primary);
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
}

.manual-dir {
  width: auto;
  padding: 0 6px;
  border: none;
  font-size: 11px;
  color: var(--arc-text-hint);
  cursor: default;
}

.batch-create-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 12px;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}

.batch-create-btn:hover {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-surface));
}

.batch-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 12px;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}

.batch-mode-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
}

.batch-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
}

.batch-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}

.batch-tool-btn:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}

.batch-tool-btn.is-active {
  color: var(--arc-primary);
}

.batch-count {
  color: var(--arc-text-hint);
  font-size: 12px;
  padding: 0 4px;
}

.homepage-empty-state {
  display: flex;
  min-height: 280px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  margin: 10px 0;
}

.empty-hint {
  color: var(--arc-text-secondary);
  font-size: 13px;
  margin: 0;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

/* transition-group 的弹性位移动画（FLIP），拖拽时卡片会弹性地让位。
   注意：transition-group 的 name="project-grid-move" 时，移动过渡应用的是
   project-grid-move-move 这个类（Vue 会在 name 后拼 -move）。 */
.project-grid-move-move {
  transition: transform 0.3s cubic-bezier(0.34, 1.3, 0.4, 1);
  will-change: transform;
}

/* 拖拽排序时卡片让位/归位都走 transform，避免触发昂贵的布局与重绘 */
.project-grid-move-enter-active,
.project-grid-move-leave-active {
  transition: opacity 0.18s ease, transform 0.3s cubic-bezier(0.34, 1.3, 0.4, 1);
}

@media (max-width: 820px) {
  .project-grid {
    grid-template-columns: 1fr;
  }
}
</style>
