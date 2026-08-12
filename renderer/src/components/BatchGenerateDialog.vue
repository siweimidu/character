<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Minus, Sparkles, X } from 'lucide-vue-next'
import { NButton, NForm, NFormItem, NInput, NInputNumber, NModal, NProgress, NSelect } from 'naive-ui'

const props = withDefaults(defineProps<{
  show: boolean
  title: string
  description?: string
  itemLabel: string
  loading?: boolean
  progress?: number
  maxCount?: number
  typeOptions?: Array<{ label: string; value: string }>
  defaultTypes?: string[]
  allowCustomTypes?: boolean
}>(), {
  description: '',
  loading: false,
  progress: 0,
  maxCount: 100,
  typeOptions: () => [],
  defaultTypes: () => [],
  allowCustomTypes: false
})

const emit = defineEmits<{
  close: []
  background: []
  submit: [payload: { count: number; prompt: string; types: string[] }]
}>()

const count = ref(10)
const prompt = ref('')
const types = ref<string[]>([])
const hasTypes = computed(() => props.typeOptions.length > 0)

watch(() => props.show, (show) => {
  if (!show || props.loading) return
  count.value = Math.min(10, props.maxCount)
  prompt.value = ''
  types.value = [...props.defaultTypes]
})

function submit(): void {
  const normalizedTypes = [...new Set(types.value.map((type) => type.trim()).filter(Boolean))]
  if (props.loading || count.value < 1 || (hasTypes.value && normalizedTypes.length === 0)) return
  emit('submit', { count: count.value, prompt: prompt.value.trim(), types: normalizedTypes })
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="batch-generate-modal"
    :bordered="false"
    :mask-closable="!loading"
    :closable="false"
    @close="emit('close')"
  >
    <template #header>
      <div class="batch-modal-header">
        <span class="batch-modal-title">{{ title }}</span>
        <div class="batch-modal-actions">
          <button
            v-if="loading"
            class="batch-header-btn"
            type="button"
            title="后台执行（关闭弹窗，任务继续在后台运行）"
            @click="emit('background')"
          >
            <Minus :size="15" />
          </button>
          <button
            class="batch-header-btn"
            type="button"
            :title="loading ? '后台执行（任务继续在后台运行）' : '关闭'"
            @click="loading ? emit('background') : emit('close')"
          >
            <X :size="15" />
          </button>
        </div>
      </div>
    </template>
    <p v-if="description" class="batch-description">{{ description }}</p>
    <n-form label-placement="top">
      <n-form-item v-if="hasTypes" :label="allowCustomTypes ? '生成类型（可自定义）' : '生成类型'">
        <n-select
          v-model:value="types"
          multiple
          filterable
          :tag="allowCustomTypes"
          :options="typeOptions"
          :placeholder="allowCustomTypes ? '选择或输入类型，按回车添加' : '至少选择一种类型'"
        />
      </n-form-item>
      <n-form-item :label="`${itemLabel}数量`">
        <n-input-number v-model:value="count" :min="1" :max="maxCount" :precision="0" style="width: 100%" />
      </n-form-item>
      <n-form-item label="补充要求（可选）">
        <n-input
          v-model:value="prompt"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 6 }"
          placeholder="例如：偏群像、避免同质化、优先补充反派阵营"
        />
      </n-form-item>
    </n-form>
    <div v-if="loading" class="batch-progress">
      <n-progress type="line" :percentage="progress" :show-indicator="false" />
      <span>已完成 {{ progress }}%</span>
    </div>
    <template #footer>
      <div class="batch-footer">
        <n-button :disabled="loading" @click="emit('close')">取消</n-button>
        <n-button type="primary" :loading="loading" @click="submit">
          <template #icon><Sparkles :size="16" /></template>
          开始生成
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.batch-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding-right: 4px;
}

.batch-modal-title {
  font-size: 16px;
  font-weight: 650;
  color: var(--arc-text-primary);
  line-height: 1.4;
}

.batch-modal-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.batch-header-btn {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.batch-header-btn:hover {
  background: var(--arc-glass-06);
  color: var(--arc-text-primary);
}

.batch-description {
  margin: 0 0 18px;
  color: var(--arc-text-muted);
  line-height: 1.7;
}

.batch-progress {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  color: var(--arc-text-muted);
  font-size: 12px;
}

.batch-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

<style>
.batch-generate-modal {
  width: min(520px, calc(100vw - 32px));
}
</style>
