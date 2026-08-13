<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInputNumber, NModal, NSelect, NSpin, useMessage } from 'naive-ui'
import { BookPlus, LoaderCircle, Sparkles } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import { createProjectBatchSeedPayloads, type BatchSeedProject } from '@/features/wizard/projectSeed'
import { NOVEL_LENGTH_OPTIONS, PROJECT_GENRE_OPTIONS } from '@/features/wizard/projectGenres'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

const appStore = useAppStore()
const message = useMessage()

const count = ref(3)
const selectedGenreKey = ref<string | null>(null)
const selectedLength = ref<'long' | 'short' | null>(null)

const isGenerating = ref(false)
const isCreating = ref(false)
const generatedProjects = ref<BatchSeedProject[]>([])

const genreOptions = computed(() =>
  PROJECT_GENRE_OPTIONS.filter((option) => !option.isCustom).map((option) => ({
    label: option.label,
    value: option.key
  }))
)

const lengthOptions = computed(() =>
  NOVEL_LENGTH_OPTIONS.map((option) => ({
    label: option.label,
    value: option.value
  }))
)

const canGenerate = computed(() => {
  const n = Number(count.value)
  return n >= 1 && n <= 10 && !isGenerating.value && !isCreating.value
})

const canCreate = computed(() => generatedProjects.value.length > 0 && !isCreating.value && !isGenerating.value)

function handleCountEnter(): void {
  // 数量为空时按回车自动填入 1，避免停留在灰色的 Please Input 占位状态
  if (!count.value || count.value < 1) count.value = 1
}

function reset(): void {
  isGenerating.value = false
  isCreating.value = false
  generatedProjects.value = []
}

function handleClose(): void {
  if (isGenerating.value || isCreating.value) {
    return
  }
  reset()
  emit('update:show', false)
}

async function handleGenerate(): Promise<void> {
  const n = Number(count.value)
  if (n < 1) {
    message.warning('作品数量至少为 1 个')
    return
  }
  if (isGenerating.value) return

  const selectedGenre = genreOptions.value.find((option) => option.value === selectedGenreKey.value)?.label ?? ''

  isGenerating.value = true
  generatedProjects.value = []
  try {
    const result = await window.characterArc.generateAi(
      toIpcPayload({
        task: 'project-batch-seed',
        settings: appStore.appSettings,
        context: {
          count: n,
          genre: selectedGenre,
          novelLength: selectedLength.value ?? ''
        }
      })
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 批量生成失败，请检查模型配置')
    }

    const list = Array.isArray(result.result)
      ? (result.result as BatchSeedProject[])
      : Array.isArray((result.result as { entries?: unknown }).entries)
        ? ((result.result as { entries: BatchSeedProject[] }).entries)
        : []

    if (!list.length) {
      throw new Error('AI 未返回有效的作品数据，请重试')
    }

    generatedProjects.value = list
    message.success(`已生成 ${list.length} 个作品`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 批量生成失败，请稍后重试')
  } finally {
    isGenerating.value = false
  }
}

async function handleCreate(): Promise<void> {
  if (isCreating.value || generatedProjects.value.length === 0) return
  isCreating.value = true
  try {
    const payloads = createProjectBatchSeedPayloads(generatedProjects.value)
    if (payloads.length === 0) {
      throw new Error('没有可创建的作品')
    }
    const created = appStore.batchCreateProjects(payloads)
    message.success(`已创建 ${created} 个作品`)
    reset()
    emit('update:show', false)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创建作品失败，请稍后重试')
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    class="arc-editor-modal batch-create-modal"
    title="批量生成作品"
    :bordered="false"
    :closable="!isGenerating && !isCreating"
    @close="handleClose"
  >
    <div class="batch-create-body arc-scrollbar">
      <p class="batch-create-intro">
        先批量生成作品名称，再由 AI 依据题材、目标篇幅与简介，为每个作品生成开局世界观和前 3 章大纲。
      </p>

      <section class="batch-form">
        <div class="form-row">
          <label class="form-label">作品数量</label>
          <n-input-number
            v-model:value="count"
            :min="1"
            :max="10"
            :disabled="isGenerating"
            class="count-input"
            placeholder="1"
            @keydown.enter="handleCountEnter"
          />
          <span class="form-hint">只能生成 1~10 个</span>
        </div>

        <div class="form-row">
          <label class="form-label">题材</label>
          <n-select
            v-model:value="selectedGenreKey"
            :options="genreOptions"
            placeholder="不指定（由 AI 挑选差异化题材）"
            clearable
            :disabled="isGenerating"
            class="genre-select"
          />
        </div>

        <div class="form-row">
          <label class="form-label">目标篇幅</label>
          <n-select
            v-model:value="selectedLength"
            :options="lengthOptions"
            placeholder="不指定（由 AI 按题材选择）"
            clearable
            :disabled="isGenerating"
            class="length-select"
          />
        </div>
      </section>

      <div class="batch-generate-bar">
        <n-button
          type="primary"
          round
          strong
          :disabled="!canGenerate"
          :loading="isGenerating"
          @click="handleGenerate"
        >
          <template #icon>
            <LoaderCircle v-if="isGenerating" :size="16" class="spin" />
            <Sparkles v-else :size="16" />
          </template>
          {{ isGenerating ? '正在批量生成...' : '开始批量生成' }}
        </n-button>
      </div>

      <section v-if="generatedProjects.length > 0" class="batch-result">
        <div class="result-head">
          <h4>生成结果（{{ generatedProjects.length }}）</h4>
          <n-spin v-if="isGenerating" :size="14" />
        </div>

        <div class="result-list">
          <article v-for="(project, index) in generatedProjects" :key="index" class="result-card">
            <div class="result-card-head">
              <strong class="result-index">{{ index + 1 }}</strong>
              <h5 class="result-title">{{ project.title || '未命名作品' }}</h5>
              <div class="result-tags">
                <span class="result-tag">{{ project.genre || '未分类' }}</span>
                <span class="result-tag">{{ project.novelLength === 'short' ? '短篇' : '长篇' }}</span>
              </div>
            </div>
            <p class="result-premise">{{ project.premise || '暂无简介' }}</p>
            <div class="result-meta">
              <span>世界观 {{ project.worldviewEntries?.length ?? 0 }} 条</span>
              <span>前 3 章大纲 {{ project.outlineItems?.length ?? 0 }} 条</span>
            </div>
          </article>
        </div>
      </section>
    </div>

    <template v-if="generatedProjects.length > 0" #footer>
      <div class="arc-modal-actions">
        <n-button round strong @click="handleClose">取消</n-button>
        <n-button
          type="primary"
          round
          strong
          :disabled="!canCreate"
          :loading="isCreating"
          @click="handleCreate"
        >
          <template #icon><BookPlus :size="16" /></template>
          {{ isCreating ? '正在创建作品...' : `创建 ${generatedProjects.length} 个作品` }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.batch-create-modal {
  width: min(680px, calc(100vw - 40px));
}

.batch-create-body {
  max-height: 68vh;
  overflow-y: auto;
}

.batch-create-intro {
  margin: 0 0 16px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.batch-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.form-label {
  width: 76px;
  flex-shrink: 0;
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 680;
}

.count-input,
.genre-select,
.length-select {
  flex: 1;
}

.genre-select,
.length-select {
  min-width: 0;
}

.form-hint {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.batch-generate-bar {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}

.spin {
  animation: batch-spin 1s linear infinite;
}

@keyframes batch-spin {
  to {
    transform: rotate(360deg);
  }
}

.batch-result {
  margin-top: 20px;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.result-head h4 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 700;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-card {
  padding: 14px 16px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
}

.result-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.result-index {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--arc-primary) 14%, transparent);
  color: var(--arc-primary);
  font-size: 12px;
}

.result-title {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 700;
}

.result-tags {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.result-tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 650;
}

.result-premise {
  margin: 10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  line-height: 1.7;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-meta {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--arc-bg-weak);
  color: var(--arc-text-hint);
  font-size: 12px;
}
</style>
