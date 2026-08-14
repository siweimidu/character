<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { NButton, NEmpty } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { Check, CheckSquare, ChevronsUpDown, GripHorizontal, Square, Trash2, Wand2, X } from 'lucide-vue-next'
import type { ProjectSummary } from '@/types/app'
import { useAppStore } from '@/stores/app'
import HomepageProjectCard from './HomepageProjectCard.vue'

/** 首页“我的作品”的排序方式 */
type SortMode = 'created' | 'edited' | 'wordCount' | 'titleLength' | 'manual'

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'created', label: '按建立时间排序' },
  { key: 'edited', label: '按最近编辑排序' },
  { key: 'wordCount', label: '按作品字数排序' },
  { key: 'titleLength', label: '按书名长度排序' },
  { key: 'manual', label: '手动排序' }
]

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
/** 当前排序方式，默认按建立时间（与新建作品置顶的默认行为一致），持久化在 store */
const sortMode = computed<SortMode>(() => {
  const stored = appStore.projectSortMode
  return SORT_OPTIONS.some((o) => o.key === stored) ? (stored as SortMode) : 'created'
})
const sortVisible = ref(false)

/** 手动排序时的本地列表（用于拖拽过程中的实时重排，落盘后同步给 store） */
const manualList = ref<ProjectSummary[]>([])
/** 当前被拖拽的作品 ID */
const draggingId = ref<string | null>(null)
/** 是否正在通过拖拽首次初始化手动列表（拖拽时以当前展示顺序为基准，防止被 watch 用 store 原始顺序覆盖） */
let isDragInit = false

/** 排序下拉菜单选项：当前生效的排序方式带勾选标记 */
const sortMenuOptions = computed<DropdownOption[]>(() =>
  SORT_OPTIONS.map((opt) => {
    const isActive = sortMode.value === opt.key
    return {
      key: opt.key,
      label: opt.label,
      icon: isActive ? () => h(Check, { size: 14 }) : undefined
    }
  })
)

const allSelected = computed(() =>
  props.projects.length > 0 && selectedIds.value.size === props.projects.length
)

const selectedCount = computed(() => selectedIds.value.size)

/** 展示用作品列表：手动模式走本地拖拽列表，其余按所选方式实时排序 */
const displayProjects = computed<ProjectSummary[]>(() => {
  if (sortMode.value === 'manual') {
    return manualList.value
  }
  const list = [...props.projects]
  const mode = sortMode.value
  list.sort((a, b) => {
    if (mode === 'created') {
      return toTimestamp(b.createdAt) - toTimestamp(a.createdAt)
    }
    if (mode === 'edited') {
      return toTimestamp(b.lastEdited) - toTimestamp(a.lastEdited)
    }
    if (mode === 'wordCount') {
      return parseWordCount(b.wordCount) - parseWordCount(a.wordCount)
    }
    // titleLength：书名越长越靠前
    return (b.title?.length ?? 0) - (a.title?.length ?? 0)
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

// 手动排序开始时，以 store 原始顺序作为基准（通过下拉菜单切换时）；拖拽自动进入时保留拖拽前的展示顺序
watch(
  () => sortMode.value,
  () => {
    if (sortMode.value === 'manual') {
      if (!isDragInit) {
        manualList.value = [...props.projects]
      }
    }
    isDragInit = false
  },
  { immediate: true }
)

// 项目增删时同步手动列表
watch(
  () => props.projects.map((p) => p.id).join(','),
  () => {
    if (sortMode.value === 'manual') {
      manualList.value = [...props.projects]
    }
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

function selectSort(key: string | number): void {
  appStore.setProjectSortMode(String(key))
  sortVisible.value = false
  if (sortMode.value !== 'manual') {
    draggingId.value = null
  }
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

// ---------- 手动拖拽排序 ----------
function handleDragStart(event: DragEvent, projectId: string): void {
  // 批量管理模式下禁止拖拽；其余情况下允许拖拽，拖拽即自动进入手动排序
  if (selectMode.value) {
    event.preventDefault()
    return
  }
  if (sortMode.value !== 'manual') {
    // 以当前展示顺序作为手动排序的初始基准，避免切换瞬间列表跳动
    isDragInit = true
    manualList.value = [...displayProjects.value]
    appStore.setProjectSortMode('manual')
  }
  draggingId.value = projectId
  event.dataTransfer?.setData('text/plain', projectId)
  event.dataTransfer!.effectAllowed = 'move'
  // 让拖拽快照更轻量
  if (event.dataTransfer?.setDragImage && event.currentTarget instanceof HTMLElement) {
    const ghost = event.currentTarget.cloneNode(true) as HTMLElement
    ghost.style.opacity = '0.4'
    ghost.style.width = '240px'
    document.body.appendChild(ghost)
    event.dataTransfer.setDragImage(ghost, 120, 20)
    // 动画结束后移除幽灵元素，避免残留
    requestAnimationFrame(() => {
      if (ghost.parentNode) {
        ghost.parentNode.removeChild(ghost)
      }
    })
  }
}

function handleDragOver(event: DragEvent, targetId: string): void {
  if (sortMode.value !== 'manual' || !draggingId.value || draggingId.value === targetId) {
    return
  }
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'

  const fromIndex = manualList.value.findIndex((p) => p.id === draggingId.value)
  const toIndex = manualList.value.findIndex((p) => p.id === targetId)
  if (fromIndex < 0 || toIndex < 0) return

  // 根据鼠标落在目标卡片的上/下半，决定插入到目标之前还是之后
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const belowMid = event.clientY > rect.top + rect.height / 2
  let insertAt = toIndex
  if (belowMid) {
    insertAt = toIndex + 1
  }
  if (fromIndex < toIndex) {
    insertAt -= 1
  }
  if (insertAt === fromIndex || insertAt === fromIndex + 1) {
    return
  }
  const next = [...manualList.value]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, moved)
  manualList.value = next
}

function handleDrop(event: DragEvent): void {
  event.preventDefault()
  commitManualOrder()
}

function handleDragEnd(): void {
  draggingId.value = null
}

/** 拖拽结束后把最终顺序持久化到 store */
function commitManualOrder(): void {
  if (!draggingId.value) return
  const orderedIds = manualList.value.map((p) => p.id)
  emit('reorder', orderedIds)
  draggingId.value = null
}

function isDragging(projectId: string): boolean {
  return draggingId.value === projectId
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
            <n-dropdown
              v-model:show="sortVisible"
              trigger="click"
              placement="bottom-start"
              :options="sortMenuOptions"
              @select="selectSort"
            >
              <button class="sort-btn" :title="`排序：${SORT_OPTIONS.find((o) => o.key === sortMode)?.label ?? ''}`">
                <ChevronsUpDown :size="14" />
                <span class="sort-btn-label">排序</span>
              </button>
            </n-dropdown>
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
        @dragover.prevent
        @drop.prevent="handleDrop"
      >
        <HomepageProjectCard
          v-for="(project, index) in displayProjects"
          :key="project.id"
          :project="project"
          :menu-options="menuOptions"
          :animation-delay="`${index * 35}ms`"
          :select-mode="selectMode"
          :selected="selectedIds.has(project.id)"
          :draggable="!selectMode"
          :is-dragging="isDragging(project.id)"
          @open="emit('open', $event)"
          @menu-select="(action, projectId) => emit('menuSelect', action, projectId)"
          @toggle-select="toggleSelect"
          @drag-start="handleDragStart"
          @drag-over="handleDragOver"
          @drop="handleDrop"
          @drag-end="handleDragEnd"
        />
      </transition-group>
      <p v-if="sortMode === 'manual'" class="manual-sort-hint">
        <GripHorizontal :size="13" />
        手动排序已开启：鼠标悬浮在作品卡片上，拖动即可调整顺序
      </p>
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
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 12px;
  transition: border-color 0.2s, color 0.2s, background 0.2s, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.sort-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  transform: translateY(-1px);
}

.sort-btn:active {
  transform: translateY(0) scale(0.97);
}

.sort-btn-label {
  white-space: nowrap;
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

.manual-sort-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  color: var(--arc-text-hint);
  font-size: 12px;
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
