<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { History, Plus, Search, X } from 'lucide-vue-next'
import { NButton, NInput, NInputGroup, NModal } from 'naive-ui'
import { usePromptStore, type SavedPrompt } from '@/composables/usePromptStore'

/**
 * 智能体常用提示词库：管理对话框（弹窗）。
 * 不再渲染常驻按钮，改由斜杠 / 命令唤出，供所有"含智能体"的地方复用。
 * 支持：选用（onUse 回填）、新建、编辑、删除。
 */
const props = withDefaults(defineProps<{
  projectId: string | null | undefined
  /** 受控打开：true 时弹出管理对话框。 */
  open?: boolean
  /** 触发"使用某条提示词"的回调，由调用方把内容回填到输入框。 */
  onUse?: (prompt: string) => void
}>(), {
  open: false,
  onUse: () => {}
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

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

// 外部受控打开：open 变为 true 时同步弹出管理对话框
watch(
  () => props.open,
  (v) => {
    if (v) {
      managerOpen.value = true
      search.value = ''
    }
  }
)
function closeManager(): void {
  managerOpen.value = false
  emit('update:open', false)
}

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
  emit('update:open', false)
  props.onUse(prompt)
}
</script>

<template>
  <div class="prompt-library">
    <!-- 管理对话框（由斜杠 / 命令唤出） -->
    <NModal
      :show="managerOpen"
      preset="card"
      title="提示词库"
      style="width: 520px"
      @close="closeManager"
      @update:show="(v) => { if (!v) closeManager() }"
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
      <template #action>
        <NButton @click="editOpen = false">取消</NButton>
        <NButton type="primary" @click="save">{{ editingId ? '保存修改' : '保存提示词' }}</NButton>
      </template>
      <div class="prompt-dialog">
        <label class="prompt-field">
          <span>名称（可选）</span>
          <NInput v-model:value="draftLabel" placeholder="给提示词起个名字，便于识别" maxlength="40" />
        </label>
        <label class="prompt-field">
          <span>提示词内容</span>
          <NInput v-model:value="draftText" type="textarea" :rows="5" placeholder="输入你想保存的常用提示词内容…" />
        </label>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
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
</style>
