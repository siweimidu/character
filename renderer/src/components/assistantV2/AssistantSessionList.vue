<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { PanelLeftClose, Pencil, Trash2 } from 'lucide-vue-next'
import type { AssistantSession } from '@shared/assistant-runtime'

const props = defineProps<{
  sessions: AssistantSession[]
  activeSessionId: string | null
}>()

const emit = defineEmits<{
  (e: 'switch', sessionId: string): void
  (e: 'create'): void
  (e: 'delete', sessionId: string): void
  (e: 'rename', sessionId: string, title: string): void
  (e: 'collapse'): void
}>()

/** 待确认删除的会话 id */
const pendingDeleteId = ref<string | null>(null)

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
    <div class="head">
      <div class="brand">
        <span class="dot" />
        <span>智能体</span>
        <span class="ver">v2</span>
      </div>
      <button class="collapse-side" title="收起对话记录" @click="emit('collapse')">
        <PanelLeftClose :size="16" />
      </button>
    </div>

    <button class="new-btn" @click="emit('create')">
      <span class="plus">+</span>
      <span>新建对话</span>
    </button>

    <div class="list">
      <div v-if="props.sessions.length === 0" class="empty">
        <div class="empty-title">还没有会话</div>
        <div class="empty-hint">点击上方"新建对话"开始一段。</div>
      </div>

      <template v-for="group in grouped" :key="group.key">
        <div class="group-label">{{ group.label }}</div>
        <div
          v-for="s in group.items"
          :key="s.id"
          class="item"
          :class="{ active: s.id === props.activeSessionId }"
          @click="emit('switch', s.id)"
        >
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
  </div>
</template>

<style scoped>
.session-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--arc-bg-surface);
  border-right: 1px solid var(--arc-border);
}
.head {
  padding: 16px 12px 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
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
.brand .ver {
  font-family: var(--v2-mono);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
  font-weight: 500;
  letter-spacing: 0;
}
.new-btn {
  margin: 4px 12px 14px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--arc-text-primary);
  color: var(--arc-bg-body);
  border: none;
  font-size: 12.5px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: transform 0.16s ease;
  font-family: inherit;
}
.new-btn:hover { transform: translateY(-1px); }
.new-btn:active { transform: translateY(0); }
.new-btn .plus { font-size: 14px; line-height: 1; }
.list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.group-label {
  padding: 12px 10px 4px;
  font-size: 10.5px;
  color: var(--arc-text-hint);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: var(--v2-mono);
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
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.item:hover { background: var(--arc-bg-weak); }
.item.active { background: var(--arc-primary-soft); }
.item.active .title { color: var(--arc-primary); }
.title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.title {
  font-size: 12.5px;
  font-weight: 500;
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
  font-size: 10.5px;
  color: var(--arc-text-hint);
  font-family: var(--v2-mono);
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
