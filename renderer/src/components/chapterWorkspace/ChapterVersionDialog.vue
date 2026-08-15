<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { GitCompare, RotateCcw, Trash2 } from 'lucide-vue-next'
import { NButton, NCheckbox, NModal, useDialog, useMessage } from 'naive-ui'
import { getChapterCharacterCount, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { formatChapterWordTargetLabel } from '@/features/chapters/wordTarget'
import { useAppStore } from '@/stores/app'
import type { ChapterDraft, ChapterVersion } from '@/types/app'

const props = defineProps<{
  show: boolean
  chapter: ChapterDraft | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const selectedVersionId = ref('')
// 批量删除选择状态
const selectedVersionIds = ref<Set<string>>(new Set())
const batchSelectMode = ref(false)

const versions = computed<ChapterVersion[]>(() =>
  props.chapter ? appStore.getChapterVersions(props.chapter.id) : []
)

const selectedVersion = computed(() =>
  versions.value.find((version) => version.id === selectedVersionId.value) ?? versions.value[0] ?? null
)

type CompareRow = {
  id: string
  before: string
  after: string
  state: 'same' | 'removed' | 'added'
}

function splitParagraphs(content: string): string[] {
  return getPlainTextFromEditorContent(content)
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function buildCompareRows(beforeContent: string, afterContent: string): CompareRow[] {
  const before = splitParagraphs(beforeContent)
  const after = splitParagraphs(afterContent)
  const lcs = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const rows: CompareRow[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      rows.push({ id: `same-${i}-${j}`, before: before[i], after: after[j], state: 'same' })
      i += 1
      j += 1
    } else if (i < before.length && (j >= after.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      rows.push({ id: `removed-${i}-${j}`, before: before[i], after: '', state: 'removed' })
      i += 1
    } else {
      rows.push({ id: `added-${i}-${j}`, before: '', after: after[j], state: 'added' })
      j += 1
    }
  }
  return rows
}

const compareRows = computed(() => {
  if (!selectedVersion.value || !props.chapter) return []
  return buildCompareRows(selectedVersion.value.content, props.chapter.content)
})

const compareStats = computed(() => ({
  added: compareRows.value.filter((row) => row.state === 'added').length,
  removed: compareRows.value.filter((row) => row.state === 'removed').length
}))

const STATUS_LABELS: Record<ChapterDraft['status'], string> = {
  draft: '草稿中',
  review: '待检查',
  polish: '待润色',
  final: '已定稿'
}

function formatTime(createdAt: string): string {
  const value = new Date(createdAt)
  if (Number.isNaN(value.getTime())) return '未知时间'
  return value.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function statusChipClass(status: ChapterDraft['status']): string {
  switch (status) {
    case 'final': return 'success'
    case 'polish': return 'accent'
    case 'review': return 'warning'
    default: return 'neutral'
  }
}

async function saveVersion(): Promise<void> {
  const result = await appStore.saveCurrentChapterVersion()
  if (!result.success) {
    message.error(result.error ?? '保存版本失败')
    return
  }
  message.success('已生成当前章节的历史版本快照')
}

function restore(version: ChapterVersion): void {
  dialog.warning({
    title: '恢复历史版本',
    content: `确定恢复 ${formatTime(version.createdAt)} 的章节快照吗？当前草稿内容将被该版本覆盖。`,
    positiveText: '确认恢复',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: async () => {
      const result = await appStore.restoreChapterVersion(version.id)
      if (!result.success) {
        message.error(result.error ?? '历史版本恢复失败')
        return
      }
      emit('update:show', false)
      message.success('历史版本已恢复到当前章节')
    }
  })
}

function toggleSelection(versionId: string): void {
  const next = new Set(selectedVersionIds.value)
  if (next.has(versionId)) {
    next.delete(versionId)
  } else {
    next.add(versionId)
  }
  selectedVersionIds.value = next
}

function toggleSelectAll(): void {
  if (selectedVersionIds.value.size === versions.value.length) {
    selectedVersionIds.value = new Set()
  } else {
    selectedVersionIds.value = new Set(versions.value.map((v) => v.id))
  }
}

function toggleBatchMode(): void {
  batchSelectMode.value = !batchSelectMode.value
  selectedVersionIds.value = new Set()
}

/** 批量删除选中的历史版本，删除后进入回收站 */
function batchDelete(): void {
  const ids = [...selectedVersionIds.value]
  if (ids.length === 0) {
    message.warning('请先勾选要删除的历史版本')
    return
  }
  dialog.warning({
    title: '批量删除历史版本',
    content: `确定删除选中的 ${ids.length} 个历史版本吗？删除后可在回收站中找到。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      const result = appStore.deleteChapterVersions(ids)
      if (!result.success) {
        message.error(result.error ?? '批量删除失败')
        return
      }
      selectedVersionIds.value = new Set()
      batchSelectMode.value = false
      // 如果当前选中的版本被删除了，重置选中项
      if (!versions.value.some((v) => v.id === selectedVersionId.value)) {
        selectedVersionId.value = versions.value[0]?.id ?? ''
      }
      message.success(`已删除 ${ids.length} 个历史版本，可在回收站中找到`)
    }
  })
}

watch(
  [() => props.show, versions],
  ([show, list]) => {
    if (!show) {
      selectedVersionIds.value = new Set()
      batchSelectMode.value = false
      return
    }
    if (!list.some((version) => version.id === selectedVersionId.value)) {
      selectedVersionId.value = list[0]?.id ?? ''
    }
  },
  { immediate: true }
)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="章节历史版本"
    :style="{ width: 'min(1080px, 94vw)' }"
    :bordered="false"
    @update:show="(v) => emit('update:show', v)"
  >
    <template #header-extra>
      <n-button size="small" type="primary" secondary @click="saveVersion">保存当前版本</n-button>
      <n-button
        v-if="!batchSelectMode"
        size="small"
        type="error"
        secondary
        :disabled="!versions.length"
        @click="toggleBatchMode"
      >
        <template #icon><Trash2 :size="13" /></template>
        批量删除
      </n-button>
      <template v-else>
        <n-button size="small" secondary @click="toggleBatchMode">取消</n-button>
        <n-button
          size="small"
          type="error"
          secondary
          :disabled="selectedVersionIds.size === 0"
          @click="batchDelete"
        >
          <template #icon><Trash2 :size="13" /></template>
          删除所选 ({{ selectedVersionIds.size }})
        </n-button>
      </template>
    </template>

    <div v-if="versions.length" class="version-workspace">
      <aside class="version-list arc-scrollbar">
        <div v-if="batchSelectMode" class="version-select-bar">
          <n-checkbox
            :checked="selectedVersionIds.size === versions.length"
            @update:checked="toggleSelectAll"
          >
            全选
          </n-checkbox>
          <span class="select-count">已选 {{ selectedVersionIds.size }}</span>
        </div>
        <button
          v-for="version in versions"
          :key="version.id"
          type="button"
          class="version-item"
          :class="{ active: !batchSelectMode && selectedVersion?.id === version.id, selected: selectedVersionIds.has(version.id) }"
          @click="batchSelectMode ? toggleSelection(version.id) : (selectedVersionId = version.id)"
        >
          <div class="version-item-head">
            <span v-if="batchSelectMode" class="version-check">
              <n-checkbox
                :checked="selectedVersionIds.has(version.id)"
                @update:checked="() => toggleSelection(version.id)"
                @click.stop
              />
            </span>
            <strong>{{ formatTime(version.createdAt) }}</strong>
            <span>{{ getChapterCharacterCount(version.content).toLocaleString() }} 字</span>
          </div>
          <span class="version-title">{{ version.title }}</span>
          <div class="meta">
            <span class="chip" :class="statusChipClass(version.status)">
              {{ STATUS_LABELS[version.status] ?? '草稿中' }}
            </span>
            <span class="chip neutral">{{ formatChapterWordTargetLabel(version.wordTarget) }}</span>
          </div>
        </button>
      </aside>

      <section v-if="selectedVersion" class="compare-pane">
        <header class="compare-head">
          <div class="compare-title">
            <GitCompare :size="16" />
            <div>
              <strong>版本差异</strong>
              <span>历史快照对照当前稿</span>
            </div>
          </div>
          <div class="compare-actions">
            <span class="diff-stat removed">-{{ compareStats.removed }}</span>
            <span class="diff-stat added">+{{ compareStats.added }}</span>
            <n-button size="small" secondary @click="restore(selectedVersion)">
              <template #icon><RotateCcw :size="14" /></template>
              恢复此版本
            </n-button>
          </div>
        </header>

        <div class="compare-labels">
          <span>{{ formatTime(selectedVersion.createdAt) }} · 历史版本</span>
          <span>当前编辑稿</span>
        </div>

        <div class="compare-scroll arc-scrollbar">
          <div v-if="compareRows.length" class="compare-rows">
            <div v-for="row in compareRows" :key="row.id" class="compare-row" :class="row.state">
              <p :class="{ empty: !row.before }">{{ row.before || ' ' }}</p>
              <p :class="{ empty: !row.after }">{{ row.after || ' ' }}</p>
            </div>
          </div>
          <div v-else class="compare-empty">当前稿与该历史版本没有正文差异。</div>
        </div>
      </section>
    </div>
    <div v-else class="empty">
      当前章节还没有历史版本，点击右上角「保存当前版本」后会在这里看到快照。
    </div>
  </n-modal>
</template>

<style scoped>
.version-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow-y: auto;
  padding-right: 8px;
  border-right: 1px solid var(--arc-border);
}

.version-workspace {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  height: min(68vh, 720px);
  min-height: 420px;
}

:deep(.n-card-header__extra) {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-select-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  margin-bottom: 4px;
  background: var(--arc-bg-surface-hover);
  border-radius: 6px;
  font-size: 12px;
  color: var(--arc-text-secondary);
}

.select-count {
  font-size: 11px;
  color: var(--arc-text-hint);
}

.version-item {
  width: 100%;
  border: 0;
  border-left: 2px solid transparent;
  background: transparent;
  padding: 11px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  text-align: left;
  cursor: pointer;
  color: var(--arc-text-primary);
}

.version-item.selected {
  border-left-color: var(--arc-danger);
  background: color-mix(in srgb, var(--arc-danger) 8%, var(--arc-bg-surface));
}

.version-item:hover {
  background: var(--arc-bg-surface-hover);
}

.version-item.active {
  border-left-color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.version-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.version-item-head strong {
  font-size: 12px;
  color: var(--arc-text-primary);
  flex: 1;
}

.version-item-head span:not(.version-check) {
  font-size: 10px;
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

.version-check {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.version-title {
  font-size: 12px;
  color: var(--arc-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-secondary);
}

.chip.success { background: color-mix(in srgb, var(--arc-success) 14%, var(--arc-bg-surface)); color: var(--arc-success); }
.chip.warning { background: color-mix(in srgb, var(--arc-warning) 14%, var(--arc-bg-surface)); color: var(--arc-warning); }
.chip.accent { background: var(--arc-primary-soft); color: var(--arc-primary); }

.compare-pane {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}

.compare-head {
  min-height: 48px;
  padding: 0 0 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.compare-title,
.compare-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compare-title {
  color: var(--arc-primary);
}

.compare-title div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.compare-title strong {
  font-size: 13px;
  color: var(--arc-text-primary);
}

.compare-title span {
  font-size: 11px;
  color: var(--arc-text-hint);
}

.diff-stat {
  min-width: 28px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
}

.diff-stat.added { color: var(--arc-success); }
.diff-stat.removed { color: var(--arc-danger); }

.compare-labels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-left: 14px;
  border: 1px solid var(--arc-border);
  border-bottom: 0;
  background: var(--arc-bg-weak);
}

.compare-labels span {
  padding: 7px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}

.compare-labels span + span {
  border-left: 1px solid var(--arc-border);
}

.compare-scroll {
  margin-left: 14px;
  overflow: auto;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}

.compare-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--arc-border);
}

.compare-row:last-child { border-bottom: 0; }

.compare-row p {
  margin: 0;
  min-width: 0;
  padding: 9px 12px;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.compare-row p + p { border-left: 1px solid var(--arc-border); }
.compare-row.removed p:first-child { background: color-mix(in srgb, var(--arc-danger) 8%, var(--arc-bg-surface)); }
.compare-row.added p:last-child { background: color-mix(in srgb, var(--arc-success) 9%, var(--arc-bg-surface)); }
.compare-row p.empty { background: var(--arc-bg-weak); }

.compare-empty {
  display: grid;
  place-items: center;
  min-height: 100%;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.empty {
  padding: 40px 0;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 13px;
}

@media (max-width: 780px) {
  .version-workspace {
    grid-template-columns: 1fr;
    grid-template-rows: 150px minmax(0, 1fr);
  }

  .version-list {
    border-right: 0;
    border-bottom: 1px solid var(--arc-border);
    padding: 0 0 8px;
  }

  .compare-head,
  .compare-labels,
  .compare-scroll {
    margin-left: 0;
  }
}
</style>
