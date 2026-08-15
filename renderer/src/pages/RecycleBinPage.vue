<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  BookMarked,
  ChevronLeft,
  FileCheck2,
  FileText,
  Globe2,
  Lightbulb,
  Network,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  X
} from 'lucide-vue-next'
import { NButton, NEmpty, NInputNumber, NPopconfirm, NSelect, NTag, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { RecycleBinCategory } from '@/types/app'

const appStore = useAppStore()
const message = useMessage()

/** 类别展示信息 */
const CATEGORY_META: Record<RecycleBinCategory, { label: string; color: string }> = {
  worldview: { label: '世界观词条', color: '#06b6d4' },
  character: { label: '人物卡片', color: '#ec4899' },
  organization: { label: '组织势力', color: '#6b7280' },
  relationship: { label: '人物关系', color: '#8b5cf6' },
  membership: { label: '成员归属', color: '#f59e0b' },
  inspiration: { label: '灵感', color: '#f59e0b' },
  prompt: { label: '提示词', color: '#f97316' },
  'prompt-category': { label: '提示词分类', color: '#ea580c' },
  outline: { label: '剧情大纲节点', color: '#10b981' },
  'outline-volume': { label: '大纲分卷', color: '#10b981' },
  'plot-thread': { label: '伏笔', color: '#6366f1' },
  'inspiration-type': { label: '灵感生成类型', color: '#f97316' },
  chapter: { label: '章节', color: '#3b82f6' },
  'knowledge-document': { label: '项目知识库', color: '#14b8a6' },
  'story-state': { label: '世界状态库', color: '#0ea5e9' },
  'assistant-session': { label: '智能体对话', color: '#0d7d5a' },
  'chapter-version': { label: '章节历史版本', color: '#0891b2' },
  'character-version': { label: '角色版本快照', color: '#d946ef' },
  'project': { label: '项目', color: '#f43f5e' },
  'ai-profile': { label: 'AI 接口配置', color: '#8b5cf6' },
  'reference-work': { label: '参考作品', color: '#06b6d4' },
  'skill': { label: '项目 Skills', color: '#a855f7' }
}

/** 是否处于全局视图（用于展示“所有项目”提示） */
const isGlobalScope = computed(() => appStore.recycleBinScope === 'global')

/** 仅在全局回收站展示的类别（AI 接口配置、项目 Skills 等全局数据） */
const GLOBAL_ONLY_CATEGORIES = new Set<RecycleBinCategory>(['ai-profile', 'reference-work', 'skill'])

/** 当前范围下可见的类别（全局类别仅在全局回收站展示，项目/汇总视图不显示） */
const visibleCategories = computed(() =>
  Object.entries(CATEGORY_META).filter(
    ([key]) => isGlobalScope.value || !GLOBAL_ONLY_CATEGORIES.has(key as RecycleBinCategory)
  )
)

const CATEGORY_ICON: Record<RecycleBinCategory, unknown> = {
  worldview: Globe2,
  character: Users,
  organization: Network,
  relationship: Network,
  membership: Network,
  inspiration: Lightbulb,
  prompt: FileText,
  'prompt-category': FileText,
  outline: FileText,
  'outline-volume': FileText,
  'plot-thread': BookMarked,
  'inspiration-type': Lightbulb,
  chapter: FileText,
  'knowledge-document': FileCheck2,
  'story-state': FileCheck2,
  'assistant-session': FileText,
  'chapter-version': FileText,
  'character-version': Users,
  'project': BookMarked,
  'ai-profile': Settings2,
  'reference-work': FileCheck2,
  'skill': Sparkles
}

/** 当前选中的类别筛选；'all' 表示全部 */
const activeCategory = ref<'all' | RecycleBinCategory>('all')

// 离开全局回收站视图时，若选中了仅全局展示的类别，则重置为“全部”
watch(
  () => appStore.recycleBinScope,
  (scope) => {
    if (scope !== 'global' && GLOBAL_ONLY_CATEGORIES.has(activeCategory.value as RecycleBinCategory)) {
      activeCategory.value = 'all'
    }
  }
)

/** 保留天数编辑状态 */
const editingRetention = ref(false)
const retentionDraft = ref<number>(appStore.recycleBinRetentionDays)

/** 当前回收站视图下的条目（随 appStore.recycleBinScope 联动） */
const entries = computed(() => appStore.recycleBinEntries)

/** 项目选择器选项：全局回收站 + 各项目回收站 */
const scopeOptions = computed(() => [
  { label: '全局回收站', value: 'global' },
  ...appStore.projects.map((project) => ({ label: project.title, value: project.id }))
])

/** 当前查看范围（双向绑定到 store） */
const scopeValue = computed({
  get: () => appStore.recycleBinScope,
  set: (value: string) => appStore.setRecycleBinScope(value)
})

/** 按类别筛选后的条目 */
const filteredEntries = computed(() =>
  activeCategory.value === 'all' ? entries.value : entries.value.filter((e) => e.category === activeCategory.value)
)

/** 各类别数量统计 */
const categoryCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const entry of entries.value) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1
  }
  return counts
})

/** 展示类别标签 */
function categoryLabel(category: RecycleBinCategory): string {
  return CATEGORY_META[category]?.label ?? category
}

function categoryColor(category: RecycleBinCategory): string {
  return CATEGORY_META[category]?.color ?? '#6b7280'
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff)
  const unit = diff < 0 ? '前' : '后'
  // 按“完整保留天数”向上取整：每个文件从删除时刻起走完完整保留天数才自动删除，
  // 因此刚删除（如保留 5 天）时显示“5 天后”，避免因取整误差提前显示成“4 天后”。
  const days = Math.ceil(abs / (24 * 60 * 60 * 1000))
  if (days > 0) return `${days} 天${unit}`
  const hours = Math.floor((abs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  if (hours > 0) return `${hours} 小时${unit}`
  const minutes = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000))
  return `${Math.max(minutes, 1)} 分钟${unit}`
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 恢复某条记录 */
async function restoreEntry(entryId: string): Promise<void> {
  const ok = await appStore.restoreRecycleEntry(entryId)
  if (ok) {
    message.success('已恢复到原模块')
  } else {
    message.error('恢复失败，请重试')
  }
}

/** 彻底删除某条记录 */
function removeEntry(entryId: string): void {
  appStore.permanentlyDeleteRecycleEntry(entryId)
  message.success('已彻底删除')
}

/** 清空回收站 */
function emptyBin(): void {
  appStore.emptyRecycleBin()
  message.success('回收站已清空')
}

/** 保存保留天数 */
function saveRetention(): void {
  const days = retentionDraft.value
  if (!Number.isFinite(days) || days < 1) {
    message.warning('保留天数需为大于 0 的整数')
    return
  }
  appStore.setRecycleBinRetentionDays(days)
  editingRetention.value = false
  message.success(`已更新保留天数为 ${days} 天`)
}

function backToProjectCenter(): void {
  // 返回项目中心：始终回到项目主页，而非返回进入回收站前的页面
  appStore.backToProjects()
}
</script>

<template>
  <section class="recycle-page">
    <header class="recycle-header">
      <div class="recycle-header-actions">
        <n-button quaternary @click="backToProjectCenter">
          <template #icon><ChevronLeft :size="16" /></template>
          返回项目中心
        </n-button>
        <n-popconfirm
          v-if="entries.length"
          @positive-click="emptyBin"
          positive-text="清空"
          negative-text="取消"
        >
          <template #trigger>
            <n-button size="small" tertiary type="error">
              <template #icon><Trash2 :size="14" /></template>
              清空回收站
            </n-button>
          </template>
          确定要永久删除{{ isGlobalScope ? '全局回收站中全部内容' : '当前回收站中的全部内容' }}吗？此操作不可撤销。
        </n-popconfirm>
      </div>
    </header>

    <main class="recycle-main arc-scrollbar">
      <!-- 范围选择：全局回收站 / 各项目回收站 -->
      <div class="recycle-scope-bar">
        <n-select
          v-model:value="scopeValue"
          :options="scopeOptions"
          size="small"
          placeholder="选择回收站范围"
          style="width: 220px"
        />
        <span v-if="isGlobalScope" class="recycle-scope-hint">
          显示所有项目删除的内容，以及 AI 接口配置、参考作品等全局数据。
        </span>
        <span v-else class="recycle-scope-hint">
          显示当前项目删除的内容。AI 接口配置、参考作品等全局数据仅在全局回收站中展示。
        </span>
      </div>

      <div class="recycle-heading">
        <div class="recycle-heading-copy">
          <span class="recycle-heading-kicker"><Trash2 :size="14" /> 回收站</span>
          <strong>{{ appStore.recycleBinScopeLabel }}</strong>
          <p>恢复后可回到原模块；到期将自动永久删除。所有模块删除的内容都会自动进入回收站。</p>
        </div>
        <div class="recycle-retention">
          <template v-if="!editingRetention">
            <span class="retention-label">保留天数</span>
            <span class="retention-value">{{ appStore.recycleBinRetentionDays }} 天</span>
            <n-button size="tiny" quaternary @click="editingRetention = true; retentionDraft = appStore.recycleBinRetentionDays">
              <template #icon><Settings2 :size="14" /></template>
              修改
            </n-button>
          </template>
          <template v-else>
            <n-input-number
              v-model:value="retentionDraft"
              :min="1"
              size="small"
              style="width: 90px"
            />
            <n-button size="tiny" type="primary" @click="saveRetention">保存</n-button>
            <n-button size="tiny" quaternary @click="editingRetention = false"><X :size="14" /></n-button>
          </template>
        </div>
      </div>

      <!-- 类别筛选 -->
      <div class="recycle-categories">
        <button
          type="button"
          class="recycle-cat-chip"
          :class="{ active: activeCategory === 'all' }"
          @click="activeCategory = 'all'"
        >
          全部
          <span class="chip-count">{{ entries.length }}</span>
        </button>
        <button
          v-for="([key, meta]) in visibleCategories"
          :key="key"
          type="button"
          class="recycle-cat-chip"
          :class="{ active: activeCategory === key }"
          :style="{ '--cat-color': meta.color }"
          @click="activeCategory = activeCategory === key ? 'all' : (key as RecycleBinCategory)"
        >
          {{ meta.label }}
          <span v-if="categoryCounts[key]" class="chip-count">{{ categoryCounts[key] }}</span>
        </button>
      </div>

      <!-- 条目卡片列表（网格布局，参考灵感模块风格） -->
      <div v-if="filteredEntries.length" class="recycle-grid">
        <article
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="recycle-card"
        >
          <div class="card-top">
            <span
              class="recycle-card-icon"
              :style="{ color: categoryColor(entry.category), background: `color-mix(in srgb, ${categoryColor(entry.category)} 12%, transparent)` }"
            >
              <component :is="CATEGORY_ICON[entry.category]" :size="17" />
            </span>
            <n-tag size="small" :bordered="false" :color="{ color: `color-mix(in srgb, ${categoryColor(entry.category)} 14%, transparent)`, textColor: categoryColor(entry.category) }">
              {{ categoryLabel(entry.category) }}
            </n-tag>
          </div>

          <h4 class="recycle-card-title" :title="entry.title">{{ entry.title }}</h4>
          <p v-if="entry.summary" class="recycle-card-summary" :title="entry.summary">{{ entry.summary }}</p>
          <p v-else class="recycle-card-summary recycle-card-summary-muted">暂无摘要</p>

          <div class="recycle-card-meta">
            <span>删除于 {{ formatDateTime(entry.deletedAt) }}</span>
            <span
              class="expire-text"
              :class="{ 'meta-expiring': new Date(entry.expiresAt).getTime() <= Date.now() + 24 * 3600 * 1000 }"
              :title="`将于 ${formatDateTime(entry.expiresAt)} 自动删除`"
            >
              将于 {{ formatRelative(entry.expiresAt) }}自动删除
            </span>
          </div>

          <div class="card-actions">
            <n-button size="small" type="primary" quaternary @click="restoreEntry(entry.id)">
              <template #icon><RotateCcw :size="14" /></template>
              恢复
            </n-button>
            <n-popconfirm
              @positive-click="removeEntry(entry.id)"
              positive-text="彻底删除"
              negative-text="取消"
            >
              <template #trigger>
                <n-button size="small" tertiary type="error">
                  <template #icon><Trash2 :size="14" /></template>
                  彻底删除
                </n-button>
              </template>
              确定要彻底删除这条内容吗？此操作不可撤销。
            </n-popconfirm>
          </div>
        </article>
      </div>

      <n-empty
        v-else
        class="recycle-empty"
        description="回收站是空的"
      >
        <template #icon>
          <div class="empty-icon"><Trash2 :size="28" /></div>
        </template>
      </n-empty>
    </main>
  </section>
</template>

<style scoped>
.recycle-page {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  flex-direction: column;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--arc-primary) 8%, transparent) 0%, transparent 30%),
    var(--arc-bg-body);
  color: var(--arc-text-primary);
}

.recycle-header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding:
    calc(var(--arc-titlebar-height) + 16px)
    max(20px, calc(var(--arc-window-controls-width) + 18px))
    10px
    20px;
}

.recycle-header-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.recycle-scope-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
}

.recycle-scope-hint {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.recycle-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 4px clamp(16px, 2vw, 26px) clamp(20px, 3vw, 34px);
}

/* 回收站右侧滑动条：透明、隐藏，但在右侧边缘仍可上下滑动 */
.recycle-main::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.recycle-main::-webkit-scrollbar-track {
  background: transparent;
}
.recycle-main::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 999px;
}
.recycle-main::-webkit-scrollbar-thumb:hover {
  background: rgba(128, 128, 128, 0.28);
}

.recycle-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.recycle-heading-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recycle-heading-kicker {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  padding: 6px 10px;
  text-transform: uppercase;
}

.recycle-heading-copy strong {
  color: var(--arc-text-primary);
  font-size: 26px;
  font-weight: 760;
  letter-spacing: -0.04em;
}

.recycle-heading-copy p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  max-width: 620px;
}

.recycle-retention {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  padding: 8px 12px;
}

.retention-label {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.retention-value {
  color: var(--arc-primary);
  font-size: 14px;
  font-weight: 700;
}

.recycle-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.recycle-cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 5px 12px;
  transition: all 0.14s ease;
}

.recycle-cat-chip:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
}

.recycle-cat-chip.active {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  font-weight: 600;
}

.chip-count {
  display: inline-flex;
  min-width: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--arc-bg-mix);
  color: inherit;
  font-size: 11px;
  padding: 0 6px;
}

/* 卡片网格布局：参考灵感模块，一行四列 */
.recycle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  gap: 12px;
}

.recycle-card {
  position: relative;
  display: flex;
  min-height: 208px;
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

.recycle-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 2%, var(--arc-bg-surface));
  box-shadow: var(--arc-shadow-sm);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.recycle-card-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 6px;
}

.recycle-card-title {
  margin: 12px 0 7px;
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recycle-card-summary {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.recycle-card-summary-muted {
  color: var(--arc-text-hint);
  font-style: italic;
}

.recycle-card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
  padding-top: 12px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.expire-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-expiring {
  color: #ef4444;
  font-weight: 600;
}

.card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--arc-border);
}

.recycle-empty {
  margin-top: 40px;
}

.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-text-hint);
  padding: 12px;
}

@media (max-width: 860px) {
  .recycle-heading {
    flex-direction: column;
    align-items: flex-start;
  }

  .recycle-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  }
}

@media (max-width: 720px) {
  .recycle-grid {
    grid-template-columns: 1fr;
  }
}
</style>
