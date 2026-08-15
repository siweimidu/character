<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Check, PanelLeftClose, Pencil, Trash2, X } from 'lucide-vue-next'
import type { AssistantSession } from '@shared/assistant-runtime'

const props = defineProps<{
  sessions: AssistantSession[]
  activeSessionId: string | null
  /** 由外部页面提供新建会话入口时，隐藏本组件自带的头部与新建按钮，避免重复。 */
  hideNewButton?: boolean
}>()

const emit = defineEmits<{
  (e: 'switch', sessionId: string): void
  (e: 'create'): void
  (e: 'delete', sessionId: string): void
  (e: 'deleteBatch', sessionIds: string[]): void
  (e: 'rename', sessionId: string, title: string): void
  (e: 'collapse'): void
}>()

/** 待确认删除的会话 id */
const pendingDeleteId = ref<string | null>(null)

/** 多选模式开关 */
const selectionMode = ref(false)
/** 已选中的会话 id 集合 */
const selectedIds = ref<Set<string>>(new Set())
/** 是否正在批量删除确认 */
const pendingBatchDelete = ref(false)

/** 是否所有会话均被选中 */
const allSelected = computed(
  () => props.sessions.length > 0 && selectedIds.value.size === props.sessions.length
)

function toggleSelectionMode(): void {
  selectionMode.value = !selectionMode.value
  if (!selectionMode.value) {
    selectedIds.value = new Set()
    pendingBatchDelete.value = false
  }
}

function toggleSelect(sessionId: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(sessionId)) next.delete(sessionId)
  else next.add(sessionId)
  selectedIds.value = next
}

function toggleSelectAll(): void {
  selectedIds.value = allSelected.value
    ? new Set()
    : new Set(props.sessions.map((s) => s.id))
}

function confirmBatchDelete(): void {
  emit('deleteBatch', [...selectedIds.value])
  selectionMode.value = false
  selectedIds.value = new Set()
  pendingBatchDelete.value = false
}

/** 正在重命名的会话 id */
const renamingId = ref<string | null>(null)
/** 重命名输入框内容 */
const renameDraft = ref('')
/** 重命名输入框 DOM 引用 */
const renameInput = ref<HTMLInputElement | null>(null)

function startRename(session: AssistantSession): void {
  renamingId.value = session.id
  renameDraft.value = session.title
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function cancelRename(): void {
  renamingId.value = null
  renameDraft.value = ''
}

function confirmRename(): void {
  const id = renamingId.value
  const title = renameDraft.value.trim()
  if (id && title) {
    emit('rename', id, title)
  }
  cancelRename()
}

type GroupKey = 'today' | 'yesterday' | 'week' | 'earlier'
const GROUP_LABEL: Record<GroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  week: '本周',
  earlier: '更早'
}

function groupOf(iso: string): GroupKey {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86400_000)
  const startOfWeek = new Date(startOfToday.getTime() - 7 * 86400_000)
  if (d >= startOfToday) return 'today'
  if (d >= startOfYesterday) return 'yesterday'
  if (d >= startOfWeek) return 'week'
  return 'earlier'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

const grouped = computed(() => {
  const buckets: Record<GroupKey, AssistantSession[]> = {
    today: [], yesterday: [], week: [], earlier: []
  }
  for (const s of props.sessions) {
    buckets[groupOf(s.updatedAt)].push(s)
  }
  const order: GroupKey[] = ['today', 'yesterday', 'week', 'earlier']
  return order
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k], items: buckets[k] }))
})
</script>

<template>
  <div class="session-list">
    <div v-if="!props.hideNewButton" class="head">
      <div class="brand">
        <span class="dot" />
        <span>智能体</span>
      </div>
      <div class="head-actions">
        <button
          v-if="!selectionMode && props.sessions.length > 0"
          class="multi-btn"
          title="多选批量删除"
          @click="toggleSelectionMode"
        >
          多选
        </button>
        <button class="collapse-side" title="收起对话记录" @click="emit('collapse')">
          <PanelLeftClose :size="16" />
        </button>
      </div>
    </div>
    <button v-if="!props.hideNewButton" class="new-btn" @click="emit('create')">
      <span class="plus">+</span>
      <span>新建对话</span>
    </button>

    <!-- 批量操作条：多选模式时展示 -->
    <div v-if="selectionMode" class="batch-bar">
      <button class="batch-select-all" type="button" @click="toggleSelectAll">
        <span class="batch-check" :class="{ checked: allSelected }">
          <Check v-if="allSelected" :size="12" />
        </span>
        {{ allSelected ? '取消全选' : '全选' }}
      </button>
      <div class="batch-actions">
        <button
          class="batch-del"
          type="button"
          :disabled="selectedIds.size === 0"
          @click="pendingBatchDelete = true"
        >
          <Trash2 :size="13" />批量删除{{ selectedIds.size ? `（${selectedIds.size}）` : '' }}
        </button>
        <button class="batch-exit" type="button" title="退出多选" @click="toggleSelectionMode">
          <X :size="14" />
        </button>
      </div>
    </div>

    <div class="list">
      <div v-if="props.sessions.length === 0" class="empty">
        <div class="empty-title">还没有会话</div>
        <div class="empty-hint">点击上方"新建对话"开始一段。</div>
      </div>

      <template v-for="(group, gi) in grouped" :key="group.key">
        <div class="group-label-row">
          <div class="group-label">{{ group.label }}</div>
          <!-- 外部页面（GlobalAgentPage）隐藏新建按钮时，将多选删除入口放在与"今天"同一行的右上角 -->
          <button
            v-if="gi === 0 && props.hideNewButton && !selectionMode && props.sessions.length > 0"
            class="multi-btn group-multi"
            title="多选批量删除"
            @click="toggleSelectionMode"
          >
            多选删除
          </button>
        </div>
        <div
          v-for="s in group.items"
          :key="s.id"
          class="item"
          :class="{ active: s.id === props.activeSessionId, selected: selectionMode && selectedIds.has(s.id) }"
          @click="selectionMode ? toggleSelect(s.id) : emit('switch', s.id)"
        >
          <div v-if="selectionMode" class="sel-check" :class="{ checked: selectedIds.has(s.id) }" @click.stop="toggleSelect(s.id)">
            <Check v-if="selectedIds.has(s.id)" :size="12" />
          </div>
          <div v-if="renamingId === s.id" class="rename-box" @click.stop>
            <input
              ref="renameInput"
              v-model="renameDraft"
              class="rename-input"
              :placeholder="s.title"
              @keydown.enter.prevent="confirmRename"
              @keydown.esc.prevent="cancelRename"
              @blur="cancelRename"
            />
          </div>
          <div v-else class="title-row">
            <span class="title">{{ s.title }}</span>
            <button
              v-if="!selectionMode"
              class="rename-btn"
              title="重命名会话"
              aria-label="重命名会话"
              @click.stop="startRename(s)"
            >
              <Pencil :size="12" />
            </button>
          </div>
          <div class="meta">
            <span>{{ formatTime(s.updatedAt) }}</span>
            <button
              v-if="!selectionMode"
              class="del"
              title="删除会话"
              aria-label="删除会话"
              @click.stop="pendingDeleteId = s.id"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <!-- 删除确认弹层 -->
          <div v-if="pendingDeleteId === s.id" class="delete-confirm" @click.stop>
            <div class="delete-confirm-text">确认删除该对话？</div>
            <div class="delete-confirm-actions">
              <button class="dc-cancel" type="button" @click.stop="pendingDeleteId = null">取消</button>
              <button class="dc-ok" type="button" @click.stop="emit('delete', s.id); pendingDeleteId = null">删除</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 批量删除确认弹层 -->
    <div v-if="pendingBatchDelete" class="batch-confirm" @click.stop>
      <div class="batch-confirm-text">确认删除选中的 {{ selectedIds.size }} 个对话？</div>
      <div class="batch-confirm-actions">
        <button class="dc-cancel" type="button" @click="pendingBatchDelete = false">取消</button>
        <button class="dc-ok" type="button" @click="confirmBatchDelete">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-list {
  /* 定义危险色变量，确保本组件在任意父级（含 GlobalAgentPage）下均可用，避免悬浮/删除按钮透明 */
  --v2-danger: #b91c1c;
  --v2-danger-soft: rgba(185, 28, 28, 0.06);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--arc-bg-surface);
  border-right: 1px solid var(--arc-border);
}
.head {
  padding: 18px 14px 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.multi-btn {
  border: 1px solid var(--arc-border-strong);
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 999px;
  transition: all 0.15s ease;
}
.multi-btn:hover {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  border-color: var(--arc-primary);
}
.batch-bar {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin: 0 12px 10px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  flex-shrink: 0;
}
.batch-select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  padding: 2px 4px;
  border-radius: 6px;
}
.batch-select-all:hover {
  color: var(--arc-primary);
}
.batch-check {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid var(--arc-border-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: transparent;
  transition: all 0.15s ease;
}
.batch-check.checked {
  background: var(--arc-primary);
  border-color: var(--arc-primary);
}
.batch-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.batch-del {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: var(--v2-danger-soft, color-mix(in srgb, var(--arc-danger) 12%, transparent));
  color: var(--v2-danger, var(--arc-danger));
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  padding: 5px 9px;
  border-radius: 7px;
  transition: all 0.15s ease;
}
.batch-del:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.batch-del:not(:disabled):hover {
  background: var(--v2-danger);
  color: #fff;
}
.batch-exit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
}
.batch-exit:hover {
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
}
.batch-confirm {
  margin: 8px 12px 12px;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  box-shadow: var(--arc-shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.batch-confirm-text {
  font-size: 12px;
  color: var(--arc-text-primary);
  font-weight: 500;
}
.batch-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.batch-confirm-actions button {
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.collapse-side {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease;
}
.collapse-side:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 600;
  font-size: 13.5px;
  letter-spacing: -0.02em;
  color: var(--arc-text-primary);
}
.brand .dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--arc-primary);
  box-shadow: 0 0 0 3px var(--arc-primary-soft);
}
.new-btn {
  margin: 4px 14px 14px;
  padding: 10px 12px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: var(--arc-primary-foreground, #fff);
  border: none;
  font-size: 12.5px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: transform 0.16s ease, background 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}
.new-btn:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--arc-primary) 90%, var(--arc-text-primary));
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 22%, transparent);
}
.new-btn:active { transform: translateY(0); }
.new-btn .plus { font-size: 14px; line-height: 1; }
.list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding-right: 2px;
}
.group-label {
  padding: 12px 6px 2px;
  font-size: 11px;
  color: var(--arc-text-hint);
  letter-spacing: 0.06em;
  font-weight: 600;
  font-family: inherit;
}
.group-multi {
  flex-shrink: 0;
  margin-top: 6px;
}
.empty {
  padding: 24px 12px;
  text-align: center;
}
.empty-title {
  font-size: 12.5px;
  color: var(--arc-text-secondary);
  font-weight: 500;
  margin-bottom: 4px;
}
.empty-hint {
  font-size: 11px;
  color: var(--arc-text-hint);
}
.item {
  position: relative;
  padding: 11px 13px;
  border-radius: 14px;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.16s ease;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.item:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 42%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  transform: translateY(-1px);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-text-primary) 6%, transparent);
}
.item.active {
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 48%, var(--arc-border));
  box-shadow: 0 2px 10px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}
.item.active .title { color: var(--arc-primary); }
.item.selected {
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 48%, var(--arc-border));
}
.item.selected .title { color: var(--arc-primary); }
.sel-check {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid var(--arc-border-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: transparent;
  margin-bottom: 2px;
  transition: all 0.15s ease;
}
.sel-check.checked {
  background: var(--arc-primary);
  border-color: var(--arc-primary);
}
.title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.title {
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.35;
  min-width: 0;
}
.rename-btn {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 3px;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s ease;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.item:hover .rename-btn,
.item.active .rename-btn {
  opacity: 1;
}
.rename-btn:hover {
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.rename-box {
  display: flex;
  min-width: 0;
}
.rename-input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--arc-primary);
  border-radius: 6px;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font-size: 12px;
  font-family: inherit;
  padding: 3px 6px;
  outline: none;
  box-shadow: 0 0 0 3px var(--arc-primary-soft);
  box-sizing: border-box;
}
.meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--arc-text-hint);
  font-family: inherit;
  letter-spacing: 0.01em;
}
.del {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s ease;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.item:hover .del { opacity: 1; }
.del:hover { color: var(--v2-danger); background: var(--v2-danger-soft); }
.delete-confirm {
  position: absolute;
  right: 8px;
  left: 8px;
  bottom: 8px;
  z-index: 10;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  box-shadow: var(--arc-shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.delete-confirm-text {
  font-size: 12px;
  color: var(--arc-text-primary);
  font-weight: 500;
}
.delete-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.delete-confirm-actions button {
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.dc-cancel {
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
}
.dc-cancel:hover {
  background: var(--arc-border);
}
.dc-ok {
  background: var(--v2-danger);
  color: #fff;
}
.dc-ok:hover {
  opacity: 0.9;
}
</style>
