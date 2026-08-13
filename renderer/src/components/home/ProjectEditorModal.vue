<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { BookOpen, ImagePlus, X } from 'lucide-vue-next'
import { NButton, NForm, NFormItem, NInput, NModal, NTag, useMessage } from 'naive-ui'
import { resolveCoverStyle } from '@/features/cover/display'
import { NOVEL_LENGTH_OPTIONS } from '@/features/wizard/projectGenres'
import type { NovelLength, ProjectSummary } from '@/types/app'

const props = defineProps<{
  show: boolean
  project: ProjectSummary | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'submit', payload: {
    id: string
    title: string
    genre: string
    premise: string
    novelLength: NovelLength
    cover: string
    targetPlatform: string
  }): void
  (e: 'pick-cover'): void
}>()

const message = useMessage()
const PLATFORM_SUGGESTIONS = ['番茄小说', '起点中文网', '晋江文学城', '知乎盐言', '七猫小说', '刺猬猫']

const form = reactive({
  title: '',
  genre: '',
  premise: '',
  novelLength: 'long' as NovelLength,
  cover: '',
  targetPlatform: ''
})

const coverPreviewStyle = computed(() => resolveCoverStyle(form.cover))

function syncFormFromProject(project: ProjectSummary | null): void {
  form.title = project?.title ?? ''
  form.genre = project?.genre ?? ''
  form.premise = project?.premise ?? ''
  form.novelLength = project?.novelLength === 'short' ? 'short' : 'long'
  form.cover = project?.cover ?? ''
  form.targetPlatform = project?.targetPlatform ?? ''
}

watch(
  () => [props.project?.id, props.show] as const,
  ([projectId, show], previousValue) => {
    if (!show) {
      return
    }

    const [previousProjectId, previousShow] = previousValue ?? []
    if (projectId !== previousProjectId || show !== previousShow) {
      syncFormFromProject(props.project)
    }
  },
  { immediate: true }
)

watch(
  () => props.project?.cover,
  (cover) => {
    if (cover !== undefined) {
      form.cover = cover
    }
  }
)

function closeModal(): void {
  emit('update:show', false)
}

function submitForm(): void {
  if (!props.project?.id) {
    return
  }

  if (!form.title.trim() || !form.genre.trim()) {
    message.warning('请完整填写项目标题和题材分类')
    return
  }

  emit('submit', {
    id: props.project.id,
    title: form.title,
    genre: form.genre,
    premise: form.premise,
    novelLength: form.novelLength,
    cover: form.cover,
    targetPlatform: form.targetPlatform
  })
}

function clearCover(): void {
  form.cover = ''
}

</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="arc-editor-modal project-editor-modal"
    title="编辑项目信息"
    :bordered="false"
    @close="closeModal"
  >
    <div class="project-editor-body">
      <n-form label-placement="top">
        <n-form-item label="项目封面">
          <div class="cover-editor">
            <div class="cover-preview" :style="coverPreviewStyle">
              <BookOpen :size="30" />
            </div>
            <div class="cover-actions">
              <div class="cover-actions-row">
                <n-button round strong @click="emit('pick-cover')">
                  <template #icon>
                    <ImagePlus :size="16" />
                  </template>
                  选择本地图片
                </n-button>
                <n-button round strong secondary :disabled="!form.cover" @click="clearCover">
                  <template #icon>
                    <X :size="16" />
                  </template>
                  清除封面
                </n-button>
              </div>
            </div>
          </div>
        </n-form-item>

        <div class="form-grid">
          <n-form-item label="项目标题">
            <n-input v-model:value="form.title" placeholder="例如：赛博飞升指南" />
          </n-form-item>
          <n-form-item label="题材分类">
            <n-input v-model:value="form.genre" placeholder="例如：科幻 / 赛博朋克" />
          </n-form-item>
        </div>

        <n-form-item label="目标平台">
          <div class="platform-editor">
            <n-input
              v-model:value="form.targetPlatform"
              placeholder="例如：番茄小说 / 起点中文网 / 晋江文学城"
            />
            <div class="platform-suggestions">
              <n-tag
                v-for="platform in PLATFORM_SUGGESTIONS"
                :key="platform"
                round
                :bordered="false"
                :type="form.targetPlatform === platform ? 'info' : 'default'"
                class="platform-suggestion"
                @click="form.targetPlatform = platform"
              >
                {{ platform }}
              </n-tag>
            </div>
          </div>
        </n-form-item>

        <n-form-item label="作品简介">
          <n-input
            v-model:value="form.premise"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            placeholder="例如：一位普通少年意外觉醒代码超能力，在赛博都市中一路逆袭……"
            maxlength="2000"
            show-count
          />
        </n-form-item>

        <n-form-item label="作品长度">
          <div class="length-grid">
            <button
              v-for="option in NOVEL_LENGTH_OPTIONS"
              :key="option.value"
              type="button"
              class="length-card"
              :class="{ active: form.novelLength === option.value }"
              @click="form.novelLength = option.value"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.description }}</span>
            </button>
          </div>
        </n-form-item>
      </n-form>
    </div>

    <template #footer>
      <div class="arc-modal-actions">
        <n-button round strong @click="closeModal">取消</n-button>
        <n-button type="primary" round strong @click="submitForm">保存修改</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.project-editor-modal :deep(.n-card) {
  border-radius: 10px;
  width: min(760px, 92vw);
}

.project-editor-body {
  max-height: min(72vh, 760px);
  overflow-y: auto;
  padding-right: 4px;
}

.cover-editor {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
}

.cover-preview {
  display: inline-flex;
  width: 120px;
  height: 120px;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  color: white;
  flex-shrink: 0;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.1);
}

.cover-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cover-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.platform-editor {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 10px;
}

.platform-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.platform-suggestion {
  cursor: pointer;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.length-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.length-card {
  display: flex;
  min-height: 88px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  border: 2px solid transparent;
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 16px;
  text-align: left;
  transition: all 0.24s ease;
}

.length-card:hover {
  background: var(--arc-bg-surface-hover);
}

.length-card.active {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-bg-mix));
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.length-card strong {
  font-size: 16px;
}

.length-card span {
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 720px) {
  .cover-editor,
  .form-grid,
  .length-grid {
    grid-template-columns: 1fr;
  }
}
</style>
