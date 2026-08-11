<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookMarked, Brain, Plus, Trash2, X } from 'lucide-vue-next'
import { NButton, NModal, NSelect, NInput, useMessage } from 'naive-ui'
import type { AgentMemory, AgentMemoryKind } from '@shared/assistant-runtime'

const message = useMessage()
const emit = defineEmits<{ (e: 'close'): void }>()

const props = defineProps<{
  visible: boolean
  projectId: string
}>()

const memories = ref<AgentMemory[]>([])
const loading = ref(false)
const isAdding = ref(false)
const selectedIds = ref<string[]>([])

// 新增表单
const newKind = ref<AgentMemoryKind>('preference')
const newContent = ref('')
const saving = ref(false)

const KIND_OPTIONS = [
  { label: '偏好', value: 'preference' },
  { label: '教训', value: 'lesson' },
  { label: '事实', value: 'fact' },
  { label: '方法', value: 'method' }
]

const KIND_LABEL: Record<string, string> = {
  preference: '偏好',
  lesson: '教训',
  fact: '事实',
  method: '方法'
}

async function loadMemories(): Promise<void> {
  if (!props.projectId) return
  loading.value = true
  try {
    memories.value = await window.characterArc.assistant.memoryList({ projectId: props.projectId, limit: 100 })
  } catch (e) {
    message.error(`加载创作记忆失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loading.value = false
  }
}

async function addMemory(): Promise<void> {
  const content = newContent.value.trim()
  if (!content) {
    message.warning('请输入记忆内容')
    return
  }
  saving.value = true
  try {
    await window.characterArc.assistant.memoryCreate({
      projectId: props.projectId,
      kind: newKind.value,
      content,
      source: 'user',
      importance: 3
    })
    message.success('已添加创作记忆，后续对话会自动召回')
    newContent.value = ''
    isAdding.value = false
    await loadMemories()
  } catch (e) {
    message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    saving.value = false
  }
}

async function deleteMemory(memory: AgentMemory): Promise<void> {
  try {
    await window.characterArc.assistant.memoryDelete({ id: memory.id, projectId: props.projectId })
    memories.value = memories.value.filter((m) => m.id !== memory.id)
    selectedIds.value = selectedIds.value.filter((id) => id !== memory.id)
    message.success('已删除该创作记忆')
  } catch (e) {
    message.error(`删除失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

function toggleSelect(id: string): void {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((sid) => sid !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

const allSelected = computed(() => memories.value.length > 0 && selectedIds.value.length === memories.value.length)

function toggleSelectAll(): void {
  selectedIds.value = allSelected.value ? [] : memories.value.map((m) => m.id)
}

async function batchDelete(): Promise<void> {
  const ids = selectedIds.value
  if (ids.length === 0) return
  if (!confirm(`确定删除选中的 ${ids.length} 条创作记忆吗？此操作不可恢复。`)) return
  try {
    for (const id of ids) {
      await window.characterArc.assistant.memoryDelete({ id, projectId: props.projectId })
    }
    memories.value = memories.value.filter((m) => !ids.includes(m.id))
    selectedIds.value = []
    message.success(`已删除 ${ids.length} 条创作记忆`)
  } catch (e) {
    message.error(`批量删除失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      loadMemories()
    }
  }
)
</script>

<template>
  <NModal
    :show="visible"
    :on-update:show="(v: boolean) => { if (!v) emit('close') }"
    preset="card"
    style="width: 560px"
    :bordered="false"
    title="创作记忆（学习闭环）"
  >
    <div class="memory-dialog">
      <p class="desc">
        <Brain :size="14" />
        智能体会跨会话记住这里的内容，并在后续对话中自动召回遵守。用户拒绝智能体的修改时，系统也会自动沉淀为"教训"记忆。
      </p>

      <!-- 新增入口 -->
      <div v-if="!isAdding" class="add-entry">
        <NButton size="small" type="primary" ghost @click="isAdding = true">
          <template #icon><Plus :size="14" /></template>
          添加创作记忆
        </NButton>
      </div>

      <div v-else class="add-form">
        <div class="form-row">
          <NSelect v-model:value="newKind" :options="KIND_OPTIONS" size="small" style="width: 120px" />
          <NButton size="small" text @click="isAdding = false"><X :size="14" /></NButton>
        </div>
        <NInput
          v-model:value="newContent"
          type="textarea"
          :rows="3"
          placeholder="例如：主角要冷峻克制，避免煽情；这一类型的章节适合短句快节奏……"
        />
        <div class="form-actions">
          <NButton size="small" type="primary" :loading="saving" @click="addMemory">保存</NButton>
        </div>
      </div>

      <!-- 记忆列表 -->
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="memories.length === 0" class="empty">
        <BookMarked :size="18" />
        还没有创作记忆。添加偏好后，智能体会越用越懂你的创作习惯。
      </div>
      <template v-else>
        <div class="batch-bar">
          <label class="select-all">
            <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
            <span>全选</span>
          </label>
          <NButton
            size="tiny"
            type="error"
            ghost
            :disabled="selectedIds.length === 0"
            @click="batchDelete"
          >
            <template #icon><Trash2 :size="13" /></template>
            批量删除{{ selectedIds.length > 0 ? `（${selectedIds.length}）` : '' }}
          </NButton>
        </div>
        <ul class="memory-list">
          <li v-for="m in memories" :key="m.id" class="memory-item" :class="{ selected: selectedIds.includes(m.id) }">
            <div class="memory-head">
              <input
                type="checkbox"
                class="memory-check"
                :checked="selectedIds.includes(m.id)"
                @change="toggleSelect(m.id)"
              />
              <span class="kind-badge" :class="m.kind">{{ KIND_LABEL[m.kind] ?? m.kind }}</span>
              <span class="importance">重要度 {{ m.importance }}/5</span>
              <span class="source">{{ m.source === 'agent' ? '智能体沉淀' : m.source === 'system' ? '系统' : '用户' }}</span>
              <NButton size="tiny" text type="error" @click="deleteMemory(m)">
                <Trash2 :size="14" />
              </NButton>
            </div>
            <p class="memory-content">{{ m.content }}</p>
          </li>
        </ul>
      </template>
    </div>
  </NModal>
</template>

<style scoped>
.desc {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--arc-muted, #888);
  margin-bottom: 12px;
}
.add-entry {
  margin-bottom: 12px;
}
.add-form {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px dashed var(--arc-border, #ddd);
  border-radius: 8px;
}
.form-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.loading,
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px 0;
  color: var(--arc-muted, #888);
  font-size: 13px;
}
.memory-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
}
.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding: 6px 10px;
  border: 1px solid var(--arc-border, #eee);
  border-radius: 8px;
  background: var(--arc-bg-weak, rgba(127,127,127,0.05));
}
.select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--arc-text-secondary, #666);
}
.memory-check {
  accent-color: var(--arc-primary, #0ea5e9);
  cursor: pointer;
}
.memory-item.selected {
  border-color: var(--arc-primary, #0ea5e9);
  background: color-mix(in srgb, var(--arc-primary, #0ea5e9) 8%, transparent);
}
.memory-item {
  border: 1px solid var(--arc-border, #eee);
  border-radius: 8px;
  padding: 8px 10px;
}
.memory-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.kind-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.15);
}
.kind-badge.preference { background: rgba(56, 189, 248, 0.18); color: #0284c7; }
.kind-badge.lesson { background: rgba(239, 68, 68, 0.18); color: #dc2626; }
.kind-badge.fact { background: rgba(34, 197, 94, 0.18); color: #16a34a; }
.kind-badge.method { background: rgba(168, 85, 247, 0.18); color: #9333ea; }
.importance,
.source {
  font-size: 11px;
  color: var(--arc-muted, #999);
}
.memory-content {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
