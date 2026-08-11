<script setup lang="ts">
import { Trash2, X } from 'lucide-vue-next'

defineProps<{
  /** 已勾选数量 */
  selectedCount: number
  /** 可勾选总数 */
  totalCount: number
  /** 实体类型名称（用于提示，如“角色”“世界观词条”） */
  itemLabel: string
  /** 是否处于全选状态 */
  allSelected: boolean
}>()

const emit = defineEmits<{
  (e: 'toggleAll'): void
  (e: 'deleteSelected'): void
  (e: 'clear'): void
}>()
</script>

<template>
  <div class="batch-delete-bar" :class="{ 'has-selection': selectedCount > 0 }">
    <label class="batch-toggle">
      <input
        type="checkbox"
        :checked="allSelected"
        :indeterminate="selectedCount > 0 && !allSelected"
        @change="emit('toggleAll')"
      />
      <span v-if="selectedCount > 0">已选 {{ selectedCount }}</span>
      <span v-else>全选 {{ itemLabel }}</span>
    </label>
    <div class="batch-actions">
      <button
        class="batch-btn batch-btn--danger"
        type="button"
        :disabled="selectedCount === 0"
        @click="emit('deleteSelected')"
      >
        <Trash2 :size="14" />
        批量删除
      </button>
      <button
        v-if="selectedCount > 0"
        class="batch-btn"
        type="button"
        @click="emit('clear')"
      >
        <X :size="14" />
        取消
      </button>
    </div>
  </div>
</template>

<style scoped>
.batch-delete-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px dashed var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-weak);
  transition: border-color 0.2s, background 0.2s;
}
.batch-delete-bar.has-selection {
  border-style: solid;
  border-color: color-mix(in srgb, var(--arc-danger) 35%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-danger) 6%, var(--arc-bg-surface));
}
.batch-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  user-select: none;
}
.batch-toggle input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--arc-danger);
  cursor: pointer;
}
.batch-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.batch-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 7px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.batch-btn:hover:not(:disabled) {
  border-color: var(--arc-primary);
  color: var(--arc-text-primary);
}
.batch-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.batch-btn--danger {
  color: var(--arc-danger);
  border-color: color-mix(in srgb, var(--arc-danger) 40%, var(--arc-border));
}
.batch-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--arc-danger) 10%, var(--arc-bg-surface));
  border-color: var(--arc-danger);
}
</style>
