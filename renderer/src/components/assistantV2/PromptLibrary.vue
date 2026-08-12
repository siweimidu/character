<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { Bookmark, History, Plus, Search, X } from 'lucide-vue-next'
import { NButton, NInput, NInputGroup, NModal } from 'naive-ui'
import { usePromptStore, type SavedPrompt } from '@/composables/usePromptStore'

/**
 * 智能体常用提示词库：紧凑按钮 + 管理对话框。
 * 供工作台智能体 / 章节智能体等所有"含智能体"的地方复用，
 * 避免每个面板各写一大块提示词表单占用空间。
 */
const props = withDefaults(defineProps<{
  projectId: string | null | undefined
  /** 触发"使用某条提示词"的回调，由调用方把内容回填到输入框。 */
  onUse?: (prompt: string) => void
}>(), {
  onUse: () => {}
})

const projectIdRef = toRef(props, 'projectId')
const promptStore = usePromptStore(projectIdRef)

// ── 管理对话框状态 ──
const managerOpen = ref(false)
const editOpen = ref(false)
const search = ref('')
const draftLabel = ref('')
const draftText = ref('')
const editingId = ref<string | null>(null)

const filteredPrompts = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return promptStore.prompts.value
  return promptStore.prompts.value.filter(
    (p) => p.label.toLowerCase().includes(q) || p.prompt.toLowerCase().includes(q)
  )
})

function openNew(): void {
  editingId.value = null
  draftLabel.value = ''
  draftText.value = ''
  editOpen.value = true
}

function openEdit(item: SavedPrompt): void {
  editingId.value = item.id
  draftLabel.value = item.label
  draftText.value = item.prompt
  editOpen.value = true
}

function save(): void {
  const label = draftLabel.value.trim()
  const text = draftText.value.trim()
  if (!text) {
    window.alert('提示词内容不能为空')
    return
  }
  const finalLabel = label || text.slice(0, 16)
  if (editingId.value) {
    promptStore.updatePrompt(editingId.value, finalLabel, text)
  } else {
    promptStore.addPrompt(finalLabel, text)
  }
  editOpen.value = false
}

function remove(item: SavedPrompt): void {
  if (!window.confirm(`确定删除提示词「${item.label}」吗？`)) return
  promptStore.deletePrompt(item.id)
}

function usePrompt(prompt: string): void {
  managerOpen.value = false
  props.onUse(prompt)
}
</script>

<template>
  <div class="prompt-library">
    <button
      type="button"
      class="prompt-lib-btn"
      title="打开提示词库"
      @click="managerOpen = true"
    >
      <Bookmark :size="14" />
      <span>提示词库</span>
      <span v-if="promptStore.prompts.value.length > 0" class="prompt-count">
        {{ promptStore.prompts.value.length }}
      </span>
    </button>

    <!-- 管理对话框 -->
    <NModal
      :show="managerOpen"
      preset="card"
      title="提示词库"
      style="width: 520px"
      @close="managerOpen = false"
      @update:show="(v) => { if (!v) managerOpen = false }"
    >
      <div class="prompt-manager">
        <div class="prompt-manager-head">
          <NInputGroup>
            <NInput v-model:value="search" placeholder="搜索提示词…" clearable>
              <template #prefix><Search :size="13" /></template>
            </NInput>
          </NInputGroup>
          <NButton type="primary" @click="openNew">
            <template #icon><Plus :size="14" /></template>
            新建
          </NButton>
        </div>
        <div class="prompt-manager-list">
          <div v-if="filteredPrompts.length === 0" class="prompt-manager-empty">
            暂无提示词，点击右上角「新建」添加一条常用提示词。
          </div>
          <div v-for="item in filteredPrompts" :key="item.id" class="prompt-manager-item">
            <button type="button" class="prompt-item-main" title="点击使用" @click="usePrompt(item.prompt)">
              <strong>{{ item.label }}</strong>
              <span>{{ item.prompt }}</span>
            </button>
            <div class="prompt-item-actions">
              <button type="button" title="编辑" @click="openEdit(item)">
                <History :size="14" />
              </button>
              <button type="button" class="danger" title="删除" @click="remove(item)">
                <X :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </NModal>

    <!-- 新建/编辑对话框 -->
    <NModal
      :show="editOpen"
      preset="dialog"
      :title="editingId ? '编辑提示词' : '新建提示词'"
      style="width: 460px"
      @close="editOpen = false"
      @update:show="(v) => { if (!v) editOpen = false }"
    >
      <div class="prompt-dialog">
        <label class="prompt-field">
          <span>名称（可选）</span>
          <NInput v-model:value="draftLabel" placeholder="给提示词起个名字，便于识别" maxlength="40" />
        </label>
        <label class="prompt-field">
          <span>提示词内容</span>
          <NInput v-model:value="draftText" type="textarea" :rows="5" placeholder="输入你想保存的常用提示词内容…" />
        </label>
        <div class="prompt-dialog-actions">
          <NButton @click="editOpen = false">取消</NButton>
          <NButton type="primary" @click="save">{{ editingId ? '保存修改' : '保存提示词' }}</NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.prompt-lib-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.prompt-lib-btn:hover {
  color: var(--arc-primary);
  border-color: color-mix(in srgb, var(--arc-primary) 45%, var(--arc-border));
  background: var(--arc-bg-surface-hover);
}

.prompt-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--arc-primary) 14%, transparent);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
}

.prompt-manager-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.prompt-manager-head .n-input-group {
  flex: 1;
}

.prompt-manager-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow-y: auto;
}

.prompt-manager-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--arc-text-muted);
  font-size: 13px;
}

.prompt-manager-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
}

.prompt-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--arc-text-primary);
}

.prompt-item-main:hover strong {
  color: var(--arc-primary);
}

.prompt-item-main strong {
  font-size: 13px;
}

.prompt-item-main span {
  font-size: 12px;
  color: var(--arc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.prompt-item-actions button {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.prompt-item-actions button:hover {
  background: var(--arc-glass-06);
  color: var(--arc-text-primary);
}

.prompt-item-actions button.danger:hover {
  color: #e5484d;
}

.prompt-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prompt-field > span {
  font-size: 12px;
  color: var(--arc-text-secondary);
}

.prompt-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
