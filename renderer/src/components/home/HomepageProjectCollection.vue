<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { ArrowDown, ArrowUp, CheckSquare, ChevronsUpDown, GripHorizontal, Square, Trash2, Wand2, X } from 'lucide-vue-next'
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

/** 手动排序时的本地列表（用于拖拽过程中的实时重排，落盘后同步给 store） */
const manualList = ref<ProjectSummary[]>([])
/** 当前被拖拽的作品 ID */
const draggingId = ref<string | null>(null)
/** 是否正在通过拖拽首次初始化手动列表（拖拽时以当前展示顺序为基准，防止被 watch 用 store 原始顺序覆盖） */
let isDragInit = false

const allSelected = computed(() =>
  props.projects.length > 0 && selectedIds.value.size === props.projects.length
)

const selectedCount = computed(() => selectedIds.value.size)

/** 展示用作品列表：手动模式走本地拖拽列表，其余按所选维度 + 方向实时排序 */
const displayProjects = computed<ProjectSummary[]>(() => {
  if (sortMode.value === 'manual') {
    return manualList.value
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

/** 在悬浮窗中选中某个排序维度 */
function selectSort(dimension: SortDimension): void {
  if (sortMode.value === 'manual' || sortMode.value !== dimension) {
    appStore.setProjectSortMode(dimension)
  }
  draggingId.value = null
  sortVisible.value = false
}

/** 切换某个排序维度的升/降方向 */
function toggleDirection(dimension: SortDimension): void {
  const next: SortDirection = dimensionDirection(dimension) === 'asc' ? 'desc' : 'asc'
  appStore.setProjectSortDirection(dimension, next)
  if (sortMode.value === dimension) {
    draggingId.value = null
  }
}

/** 是否开启手动排序 */
function enableManualSort(): void {
  appStore.setProjectSortMode('manual')
  draggingId.value = null
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

// ---------- 手动拖拽排序（基于 Pointer Events，比原生 HTML5 拖拽更可靠） ----------
interface DragState {
  active: boolean
  pointerId: number
  id: string
  startX: number
  startY: number
  moved: boolean
}

const dragState = ref<DragState | null>(null)
/** 拖拽结束抬起后，是否要吞掉随之而来的 click，避免误打开项目 */
const suppressClick = ref(false)
/** 被拖拽卡片相对鼠标按下点的位移（跟随鼠标移动，提供明确的拖拽视觉反馈） */
const dragOffset = ref<{ x: number; y: number } | null>(null)

function handlePointerDown(event: PointerEvent, projectId: string): void {
  // 批量管理模式下禁止拖拽；仅左键
  if (selectMode.value || event.button !== 0) return
  // 阻止默认行为，避免触发文本选择 / 原生 HTML5 拖拽 / 图像拖拽
  event.preventDefault()
  dragState.value = {
    active: true,
    pointerId: event.pointerId,
    id: projectId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false
  }
  // 在 window 上监听移动与抬起，保证拖出卡片边界后仍能持续响应
  window.addEventListener('pointermove', handleWindowPointerMove)
  window.addEventListener('pointerup', handleWindowPointerUp)
  window.addEventListener('pointercancel', handleWindowPointerUp)
}

function handleWindowPointerMove(event: PointerEvent): void {
  const ds = dragState.value
  if (!ds || !ds.active || event.pointerId !== ds.pointerId) return
  const dx = event.clientX - ds.startX
  const dy = event.clientY - ds.startY
  // 小于阈值视为点击，不启动拖拽，避免误进入手动排序
  if (!ds.moved && Math.hypot(dx, dy) < 6) return
  if (!ds.moved) {
    ds.moved = true
    // 首次移动即进入手动排序：以当前展示顺序作为基准，避免切换瞬间列表跳动
    isDragInit = true
    manualList.value = [...displayProjects.value]
    appStore.setProjectSortMode('manual')
    draggingId.value = ds.id
  }
  // 被拖拽卡片跟随鼠标移动，用户能清晰看到拖拽动作
  dragOffset.value = { x: dx, y: dy }
  reorderOnMove(event.clientX, event.clientY)
}

/** 根据指针当前所在的卡片，实时重排 manualList */
function reorderOnMove(x: number, y: number): void {
  const ds = dragState.value
  if (!ds || !ds.active || !ds.moved) return
  // 使用 elementsFromPoint 遍历 pointer 下所有层叠元素，跳过被拖拽卡片自身，
  // 避免 is-dragging 卡片放大并置顶后遮挡目标卡片导致命中失败（拖拽“没反应”）
  const pointEls =
    typeof document.elementsFromPoint === 'function'
      ? (document.elementsFromPoint(x, y) as HTMLElement[])
      : (document.elementFromPoint ? [document.elementFromPoint(x, y)] : [])
  let card: HTMLElement | null = null
  let targetId: string | null = null
  for (const el of pointEls) {
    if (!el || !el.closest) continue
    const c = el.closest('.homepage-project-card') as HTMLElement | null
    if (c && c.dataset.projectId && c.dataset.projectId !== ds.id) {
      card = c
      targetId = c.dataset.projectId
      break
    }
  }
  if (!card || !targetId) return

  const fromIndex = manualList.value.findIndex((p) => p.id === ds.id)
  const toIndex = manualList.value.findIndex((p) => p.id === targetId)
  if (fromIndex < 0 || toIndex < 0) return

  const rect = card.getBoundingClientRect()
  const belowMid = y > rect.top + rect.height / 2
  let insertAt = belowMid ? toIndex + 1 : toIndex
  if (fromIndex < toIndex) {
    insertAt -= 1
  }
  if (insertAt === fromIndex || insertAt === fromIndex + 1) return

  const next = [...manualList.value]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, moved)
  manualList.value = next
}

function handleWindowPointerUp(event: PointerEvent): void {
  const ds = dragState.value
  if (!ds || event.pointerId !== ds.pointerId) return
  window.removeEventListener('pointermove', handleWindowPointerMove)
  window.removeEventListener('pointerup', handleWindowPointerUp)
  window.removeEventListener('pointercancel', handleWindowPointerUp)
  // 真正发生了拖拽：吞掉紧随其后的 click，并提交最终顺序
  suppressClick.value = ds.moved
  if (ds.moved && draggingId.value) {
    const orderedIds = manualList.value.map((p) => p.id)
    emit('reorder', orderedIds)
  }
  draggingId.value = null
  dragState.value = null
  dragOffset.value = null
  // click 事件随后触发，处理完后再复位抑制标记
  requestAnimationFrame(() => {
    suppressClick.value = false
  })
}

function handleClickConsumed(): void {
  suppressClick.value = false
}

function isDragging(projectId: string): boolean {
  return draggingId.value === projectId
}

/** 被拖拽卡片的鼠标跟随偏移；非拖拽卡片返回 null */
function getDragOffset(projectId: string): { x: number; y: number } | null {
  if (draggingId.value !== projectId) return null
  return dragOffset.value
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
                <button class="sort-btn" :title="`排序：${SORT_OPTIONS.find((o) => o.key === sortMode)?.label ?? ''}（${sortMode === 'manual' ? '手动排序' : (sortDirection === 'asc' ? '最早/最短/最少/最早编辑' : '最晚/最长/最多/最新编辑')}）`">
                  <ChevronsUpDown :size="14" />
                  <span class="sort-btn-label">排序</span>
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
                  <span class="sort-option-dir manual-dir">拖拽</span>
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
          :draggable="!selectMode"
          :is-dragging="isDragging(project.id)"
          :drag-offset="getDragOffset(project.id)"
          :suppress-click="suppressClick"
          @open="emit('open', $event)"
          @menu-select="(action, projectId) => emit('menuSelect', action, projectId)"
          @toggle-select="toggleSelect"
          @pointer-down="handlePointerDown"
          @click-consumed="handleClickConsumed"
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
