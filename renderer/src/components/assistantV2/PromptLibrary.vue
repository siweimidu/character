<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Pencil, Plus, Search, X } from 'lucide-vue-next'
import { NButton, NInput, NInputGroup, NModal, NSelect } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { PromptEntry } from '@/types/app'

/**
 * 智能体常用提示词库：管理对话框（弹窗）。
 * 不再渲染常驻按钮，改由斜杠 / 命令唤出，供所有"含智能体"的地方复用。
 * 支持：选用（onUse 回填）、新建、编辑、删除。
 *
 * 数据源：与创作模块「提示词库」（PromptLibraryPanel）共用同一套 workspace 数据
 * （appStore.promptEntries / promptCategories），从而保证两个入口的内容完全同步：
 * 智能体对话框里新建/编辑/删除的提示词，会同步反映到创作模块；反之亦然。
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

const appStore = useAppStore()

// ── 管理对话框状态 ──
const managerOpen = ref(false)
const editOpen = ref(false)
const search = ref('')
const draftLabel = ref('')
const draftText = ref('')
const draftCategoryId = ref('')
const editingId = ref<string | null>(null)

/** 与创作模块提示词库对齐的可插值变量提示。 */
const TEMPLATE_VARIABLES_HINT = '{{content}} · {{chapter}} · {{role}}'

/** 分类选项：默认归类到第一个分类 */
const categoryOptions = computed(() =>
  appStore.promptCategories.map((c) => ({ label: c.name, value: c.id }))
)

const filteredPrompts = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = appStore.promptEntries
  if (!q) return list
  return list.filter(
    (p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
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
  draftCategoryId.value = appStore.promptCategories[0]?.id ?? ''
  editOpen.value = true
}

function openEdit(item: PromptEntry): void {
  editingId.value = item.id
  draftLabel.value = item.title
  draftText.value = item.content
  draftCategoryId.value = item.categoryId
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
    appStore.updatePromptEntry(editingId.value, {
      title: finalLabel,
      content: text,
      categoryId: draftCategoryId.value
    })
  } else {
    appStore.createPromptEntry({
      title: finalLabel,
      content: text,
      categoryId: draftCategoryId.value
    })
  }
  editOpen.value = false
}

function remove(item: PromptEntry): void {
  if (!window.confirm(`确定删除提示词「${item.title}」吗？`)) return
  appStore.deletePromptEntry(item.id)
}

function usePrompt(entry: PromptEntry): void {
  // 记录一次使用次数（与创作模块保持一致）
  appStore.incrementPromptUsage(entry.id)
  managerOpen.value = false
  emit('update:open', false)
  props.onUse(entry.content)
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
            <button type="button" class="prompt-item-main" title="点击使用" @click="usePrompt(item)">
              <strong>{{ item.title }}</strong>
              <span>{{ item.content }}</span>
            </button>
            <div class="prompt-item-actions">
              <button type="button" title="编辑" @click="openEdit(item)">
                <Pencil :size="14" />
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
          <span>所属分类</span>
          <NSelect
            v-model:value="draftCategoryId"
            :options="categoryOptions"
            placeholder="选择分类（默认归入第一个分类）"
            :disabled="categoryOptions.length === 0"
          />
        </label>
        <label class="prompt-field">
          <span class="prompt-field-head">
            提示词内容
            <span class="variable-hint">支持变量：{{ TEMPLATE_VARIABLES_HINT }}</span>
          </span>
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
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.prompt-manager-item:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 2%, var(--arc-bg-surface));
  box-shadow: var(--arc-shadow-sm);
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
  font-weight: 700;
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
  color: var(--arc-primary);
}

.prompt-item-actions button.danger:hover {
  background: color-mix(in srgb, var(--arc-danger) 10%, var(--arc-bg-surface));
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

.prompt-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.variable-hint {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 400;
}
</style>
