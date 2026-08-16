<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty, NPopover } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { Check, CheckSquare, Square, Trash2, Wand2, X } from 'lucide-vue-next'
import type { ProjectSummary } from '@/types/app'
import { useAppStore } from '@/stores/app'
import HomepageProjectCard from './HomepageProjectCard.vue'

type SortMode = 'created' | 'edited' | 'wordCount' | 'name' | 'manual'

const props = defineProps<{
  projects: ProjectSummary[]
  menuOptions: DropdownOption[]
}>()

const emit = defineEmits<{
  (e: 'open', projectId: string): void
  (e: 'menuSelect', action: string | number, projectId: string): void
  (e: 'batchDelete', projectIds: string[]): void
  (e: 'batchCreate'): void
}>()

const appStore = useAppStore()

const sortOptions: Array<{ key: SortMode; label: string }> = [
  { key: 'created', label: '按建立时间排序' },
  { key: 'edited', label: '按最近编辑排序' },
  { key: 'wordCount', label: '按作品字数排序' },
  { key: 'name', label: '按作品名称排序' },
  { key: 'manual', label: '手动排序' }
]

/** 当前排序方式（持久化在 store） */
const sortMode = computed<SortMode>(() => {
  const stored = appStore.projectSortMode
  if (stored === 'manual') return 'manual'
  return sortOptions.some((o) => o.key === stored) ? (stored as SortMode) : 'created'
})

/** 解析 wordCount 文本（如 "12,345 字"）中的数字，用于字数排序 */
function parseWordCount(value: string): number {
  const match = String(value ?? '').match(/\d[\d,]*/)
  return match ? Number(match[0].replace(/,/g, '')) || 0 : 0
}

/** 根据排序方式渲染的最终项目顺序 */
const orderedProjects = computed<ProjectSummary[]>(() => {
  const list = [...props.projects]
  if (sortMode.value === 'created') {
    return list.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  }
  if (sortMode.value === 'edited') {
    return list.sort((a, b) => (b.lastEdited ?? '').localeCompare(a.lastEdited ?? ''))
  }
  if (sortMode.value === 'wordCount') {
    return list.sort((a, b) => parseWordCount(b.wordCount) - parseWordCount(a.wordCount))
  }
  if (sortMode.value === 'name') {
    return list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  }
  // 手动排序：props.projects 已按 store 中的持久化顺序排列
  return props.projects
})

/** 选择排序方式（持久化到 store） */
function chooseSort(mode: SortMode): void {
  if (mode === 'manual') {
    // 进入手动模式前，以当前显示顺序作为手动排序的基准
    appStore.reorderProjects(orderedProjects.value.map((p) => p.id))
  }
  appStore.setProjectSortMode(mode)
}

/** 手动排序：上移/下移一个位置并持久化到 store */
function moveProject(projectId: string, direction: 'up' | 'down'): void {
  const order = props.projects.map((p) => p.id)
  const index = order.indexOf(projectId)
  if (index < 0) return
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= order.length) return
  const next = [...order]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  appStore.reorderProjects(next)
}

const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

const allSelected = computed(() =>
  props.projects.length > 0 && selectedIds.value.size === props.projects.length
)

const selectedCount = computed(() => selectedIds.value.size)

// 项目增删时同步选中状态
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
              trigger="click"
              placement="bottom-end"
              :show-arrow="false"
              :offset="6"
            >
              <template #trigger>
                <button class="sort-mode-btn" title="选择排序方式">
                  <svg
                    class="sort-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M11 5h10" />
                    <path d="M11 9h7" />
                    <path d="M11 13h4" />
                    <path d="m3 17 3 3 3-3" />
                    <path d="M6 18V4" />
                  </svg>
                </button>
              </template>
              <div class="sort-popover">
                <p class="sort-popover-title">选择排序方式</p>
                <button
                  v-for="option in sortOptions"
                  :key="option.key"
                  class="sort-option"
                  :class="{ 'is-active': sortMode === option.key }"
                  @click="chooseSort(option.key)"
                >
                  <span>{{ option.label }}</span>
                  <Check v-if="sortMode === option.key" :size="14" />
                </button>
              </div>
            </n-popover>
            <button class="batch-mode-btn" title="批量生成作品" @click="emit('batchCreate')">
              <Wand2 :size="14" />
              批量生成
            </button>
            <button class="batch-mode-btn" title="批量管理" @click="enterSelectMode">
              <CheckSquare :size="14" />
              批量管理
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

      <div class="project-grid">
        <HomepageProjectCard
          v-for="(project, index) in orderedProjects"
          :key="project.id"
          :project="project"
          :menu-options="menuOptions"
          :animation-delay="`${index * 35}ms`"
          :select-mode="selectMode"
          :selected="selectedIds.has(project.id)"
          :manual-sort="sortMode === 'manual'"
          :is-first="index === 0"
          :is-last="index === orderedProjects.length - 1"
          @open="emit('open', $event)"
          @menu-select="(action, projectId) => emit('menuSelect', action, projectId)"
          @toggle-select="toggleSelect"
          @move-up="(id) => moveProject(id, 'up')"
          @move-down="(id) => moveProject(id, 'down')"
        />
      </div>
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

.sort-mode-btn {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}

.sort-mode-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
}

.sort-icon {
  display: block;
}

.sort-popover {
  display: flex;
  width: 180px;
  flex-direction: column;
  padding: 4px;
}

.sort-popover-title {
  margin: 0;
  padding: 6px 10px 8px;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 680;
  letter-spacing: 0.02em;
}

.sort-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 520;
  text-align: left;
  cursor: pointer;
  padding: 7px 10px;
  transition: background 0.15s, color 0.15s;
}

.sort-option:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}

.sort-option.is-active {
  color: var(--arc-primary);
  font-weight: 640;
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

@media (max-width: 820px) {
  .project-grid {
    grid-template-columns: 1fr;
  }
}
</style>
