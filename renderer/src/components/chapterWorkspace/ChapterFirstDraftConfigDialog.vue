<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { CircleHelp, Search, Save, History, Trash2 } from 'lucide-vue-next'
import { NButton, NCheckbox, NCheckboxGroup, NInputNumber, NInput, NModal, NSelect, NSwitch, NTag, NTooltip, NPopover } from 'naive-ui'
import { buildChapterReferencePreview, buildOutlineItemContext } from '@/features/ai/chapterAssistantContext'
import { getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import { parseChapterWordTarget } from '@/features/chapters/wordTarget'
import type { NovelWorkflowStageId, ProjectSkillItem } from '@/types/app'
import {
  createDefaultFirstDraftSteps,
  FIRST_DRAFT_STEP_DEFINITIONS,
  type FirstDraftConfig,
  type FirstDraftFailurePolicy,
  type FirstDraftSkillMode,
  type FirstDraftStepConfig,
  type FirstDraftStepId
} from './useChapterFirstDraft'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'confirm', config: FirstDraftConfig): void
  (e: 'cancel'): void
  /** 按目标字数控制当前章节正文（超出则精简、不足则扩充） */
  (e: 'apply-target-words', targetWordCount: number): void
}>()

const appStore = useAppStore()

const chapter = computed(() => appStore.selectedChapter)
const project = computed(() => appStore.currentProject)

const targetWordCount = ref(3000)
const selectedRefIds = ref<string[]>([])
const userPrompt = ref('')

// ── 全局补充指令：预设保存 / 历史（最多200条）/ 搜索 ──
const GLOBAL_PROMPT_STORAGE_KEY = 'characterarc:global-supplement-prompts'
const GLOBAL_PROMPT_HISTORY_LIMIT = 200
const savedGlobalPrompts = ref<Array<{ id: string; text: string; at: string }>>(
  loadSavedGlobalPrompts()
)
const globalPromptSearch = ref('')
const globalPromptSearchMode = ref<'keyword' | 'fuzzy' | 'exact'>('keyword')
const showGlobalPromptHistory = ref(false)

function loadSavedGlobalPrompts(): Array<{ id: string; text: string; at: string }> {
  try {
    const raw = localStorage.getItem(GLOBAL_PROMPT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.text === 'string' && item.text.trim())
      .slice(0, GLOBAL_PROMPT_HISTORY_LIMIT)
  } catch {
    return []
  }
}

function persistSavedGlobalPrompts(): void {
  try {
    const payload = savedGlobalPrompts.value.slice(0, GLOBAL_PROMPT_HISTORY_LIMIT)
    localStorage.setItem(GLOBAL_PROMPT_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* localStorage 不可用时静默忽略 */
  }
}

function saveCurrentGlobalPrompt(): void {
  const text = userPrompt.value.trim()
  if (!text) return
  savedGlobalPrompts.value = [
    { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, at: new Date().toISOString() },
    ...savedGlobalPrompts.value.filter((item) => item.text !== text)
  ].slice(0, GLOBAL_PROMPT_HISTORY_LIMIT)
  persistSavedGlobalPrompts()
  showGlobalPromptHistory.value = true
}

function applyGlobalPrompt(item: { text: string }): void {
  userPrompt.value = item.text
}

function deleteGlobalPrompt(id: string): void {
  savedGlobalPrompts.value = savedGlobalPrompts.value.filter((item) => item.id !== id)
  persistSavedGlobalPrompts()
}

function clearGlobalPromptHistory(): void {
  savedGlobalPrompts.value = []
  persistSavedGlobalPrompts()
}

const filteredGlobalPrompts = computed(() => {
  const query = globalPromptSearch.value.trim().toLowerCase()
  if (!query) return savedGlobalPrompts.value
  switch (globalPromptSearchMode.value) {
    case 'exact':
      return savedGlobalPrompts.value.filter((item) => item.text.trim().toLowerCase() === query)
    case 'fuzzy': {
      const chars = Array.from(query)
      return savedGlobalPrompts.value.filter((item) => {
        const haystack = item.text.toLowerCase()
        let pos = -1
        for (const ch of chars) {
          pos = haystack.indexOf(ch, pos + 1)
          if (pos < 0) return false
        }
        return true
      })
    }
    case 'keyword':
    default:
      return savedGlobalPrompts.value.filter((item) =>
        Array.from(query).every((ch) => item.text.toLowerCase().includes(ch))
      )
  }
})
const expandedStepId = ref<FirstDraftStepId | null>('draft')
const discoveredProjectSkills = ref<ProjectSkillItem[]>([])
const hasScannedProjectSkills = ref(false)
const isLoadingProjectSkills = ref(false)
const projectSkillsLoadError = ref('')
const steps = reactive<Record<FirstDraftStepId, FirstDraftStepConfig>>(createDefaultFirstDraftSteps())

const referenceWorks = computed(() => appStore.referenceWorks)
const projectSkills = computed(() => {
  const savedSkills = project.value?.projectSkills ?? []
  if (!hasScannedProjectSkills.value) return savedSkills

  const savedSkillById = new Map(savedSkills.map((skill) => [skill.id, skill]))
  return discoveredProjectSkills.value.map((skill) => {
    const savedSkill = savedSkillById.get(skill.id)
    return {
      ...skill,
      enabled: skill.compatibility === 'external-only'
        ? false
        : (savedSkill?.enabled ?? skill.enabled),
      stageIds: savedSkill?.stageIds ?? skill.stageIds
    }
  })
})
const selectableProjectSkills = computed(() =>
  projectSkills.value.filter((skill) =>
    skill.category !== 'tool'
    && skill.category !== 'cover'
    && skill.compatibility !== 'external-only'
  )
)

const skillCategoryLabels = {
  market: '通用',
  analysis: '分析',
  writing: '写作',
  polish: '润色',
  cover: '封面',
  tool: '工具'
} as const

const skillCategoryUsage: Record<NonNullable<ProjectSkillItem['category']>, string> = {
  market: '用于扫榜、市场趋势、题材卖点和读者期待分析。',
  analysis: '用于拆解参考作品、章节结构、节奏和叙事手法。',
  writing: '用于正文起草，影响情节推进、角色表达和场景写法。',
  polish: '用于润色、改写、去 AI 味和统一文风。',
  cover: '用于封面方向、视觉关键词和图片提示词。',
  tool: '用于调用外部工具或补充专门处理能力。'
}
const defaultSkillUsage = '用于补充当前步骤的专门提示词和写作约束。'

const workflowStageLabels: Record<NovelWorkflowStageId, string> = {
  reference: '拆书',
  premise: '立意',
  setting: '设定',
  outline: '大纲',
  draft: '初稿'
}

function getSkillCategoryLabel(skill: ProjectSkillItem): string {
  return skill.category ? skillCategoryLabels[skill.category] : '通用'
}

function getSkillSourceLabel(skill: ProjectSkillItem): string {
  return skill.scope === 'project' ? '导入' : '内置'
}

function getSkillUsageText(skill: ProjectSkillItem): string {
  const description = skill.description?.trim()
  const fallback = skill.category ? skillCategoryUsage[skill.category] : defaultSkillUsage
  const stages = skill.stageIds
    .map((stageId) => workflowStageLabels[stageId])
    .filter(Boolean)
    .join('、')
  const stageText = stages ? `适用：${stages}。` : ''
  return [description || fallback, stageText].filter(Boolean).join(' ')
}

const skillById = computed(() => new Map(projectSkills.value.map((skill) => [skill.id, skill])))

const skillModeOptions: Array<{ label: string; value: FirstDraftSkillMode }> = [
  { label: '自动选择', value: 'auto' },
  { label: '手动指定', value: 'manual' }
]

const activeStep = computed(() =>
  FIRST_DRAFT_STEP_DEFINITIONS.find((step) => step.id === expandedStepId.value) ?? FIRST_DRAFT_STEP_DEFINITIONS[1]
)

const currentOutlineItem = computed(() => {
  const currentChapter = chapter.value
  if (!currentChapter) return null
  const volumeOutlineItems = appStore.outlineItems.filter((item) => item.volumeId === currentChapter.volumeId)
  return currentChapter.outlineItemId
    ? volumeOutlineItems.find((item) => item.id === currentChapter.outlineItemId) ?? null
    : volumeOutlineItems.find((item) => item.title.trim() === currentChapter.title.trim()) ?? null
})

const contextPreview = computed(() => {
  const currentChapter = chapter.value
  if (!currentChapter) {
    return buildChapterReferencePreview({
      chapterContent: '',
      currentOutlineItem: null,
      relatedChapters: [],
      userPrompt: userPrompt.value,
      worldviewEntries: [],
      characters: [],
      organizations: [],
      characterRelationships: [],
      organizationMemberships: []
    })
  }
  const currentChapterIndex = appStore.chapters.findIndex((item) => item.id === currentChapter.id)
  const precedingChapters = currentChapterIndex >= 0 ? appStore.chapters.slice(0, currentChapterIndex) : []
  const relatedChapters = precedingChapters
    .slice(-4)
    .map((item) => ({
      title: item.title,
      summary: item.summary,
      preview: getChapterPreviewText(item.content ?? '').slice(0, 800)
    }))
  return buildChapterReferencePreview({
    chapter: currentChapter,
    chapterContent: getPlainTextFromEditorContent(currentChapter.content ?? ''),
    currentOutlineItem: buildOutlineItemContext(currentOutlineItem.value, {
      characters: appStore.characters,
      organizations: appStore.organizations,
      worldviewEntries: appStore.worldviewEntries
    }),
    relatedChapters,
    userPrompt: userPrompt.value,
    worldviewEntries: appStore.worldviewEntries,
    characters: appStore.characters,
    organizations: appStore.organizations,
    characterRelationships: appStore.characterRelationships,
    organizationMemberships: appStore.organizationMemberships
  })
})

const contextStats = computed(() => [
  { label: '角色', value: contextPreview.value.counts.characters },
  { label: '组织', value: contextPreview.value.counts.organizations },
  { label: '设定', value: contextPreview.value.counts.worldviewEntries },
  { label: '关系', value: contextPreview.value.counts.characterRelationships },
  { label: '归属', value: contextPreview.value.counts.organizationMemberships }
])

const previewRelationships = computed(() => contextPreview.value.characterRelationships.slice(0, 4))
const previewMemberships = computed(() => contextPreview.value.organizationMemberships.slice(0, 4))
const hasContextPreviewData = computed(() =>
  contextPreview.value.characters.length > 0
  || contextPreview.value.organizations.length > 0
  || contextPreview.value.worldviewEntries.length > 0
  || Boolean(contextPreview.value.currentOutlineItem)
)

function getSkillModeText(stepId: FirstDraftStepId): string {
  const step = steps[stepId]
  if (step.skillMode === 'auto') return '自动选择技巧'
  if (step.skillIds.length === 0) return '手动：不使用技巧'
  return `手动：${step.skillIds.length} 个技巧`
}

function getSkillModeHint(stepId: FirstDraftStepId): string {
  return steps[stepId].skillMode === 'auto'
    ? '默认由系统按当前步骤和上下文自动匹配提示词技巧。'
    : '只使用你勾选的提示词技巧；不选择则本步骤不使用提示词技巧。'
}

function getSelectedSkills(stepId: FirstDraftStepId): ProjectSkillItem[] {
  const selected: ProjectSkillItem[] = []
  for (const skillId of steps[stepId].skillIds) {
    const skill = skillById.value.get(skillId)
    if (skill && isSelectableSkill(skill)) selected.push(skill)
  }
  return selected
}

function isSkillSelected(stepId: FirstDraftStepId, skillId: string): boolean {
  return steps[stepId].skillIds.includes(skillId)
}

function isSelectableSkill(skill: ProjectSkillItem): boolean {
  return selectableProjectSkills.value.some((item) => item.id === skill.id)
}

function toggleStepSkill(stepId: FirstDraftStepId, skillId: string): void {
  const skill = skillById.value.get(skillId)
  if (!skill || !isSelectableSkill(skill)) return
  const current = steps[stepId].skillIds
  steps[stepId].skillIds = current.includes(skillId)
    ? current.filter((id) => id !== skillId)
    : [...current, skillId]
}

const failureOptions: Array<{ label: string; value: FirstDraftFailurePolicy }> = [
  { label: '跳过并继续', value: 'skip' },
  { label: '停止流程', value: 'stop' }
]

let projectSkillsScanRequestId = 0

async function scanAvailableProjectSkills(): Promise<void> {
  const projectId = project.value?.id
  const requestId = ++projectSkillsScanRequestId
  discoveredProjectSkills.value = []
  hasScannedProjectSkills.value = false
  projectSkillsLoadError.value = ''

  if (!projectId) {
    isLoadingProjectSkills.value = false
    return
  }

  isLoadingProjectSkills.value = true
  try {
    const result = await window.characterArc.scanProjectSkills(projectId)
    if (requestId !== projectSkillsScanRequestId || !props.show || project.value?.id !== projectId) return
    if (!result.success) {
      throw new Error(result.error ?? 'skills 加载失败')
    }
    discoveredProjectSkills.value = result.skills ?? []
    hasScannedProjectSkills.value = true
  } catch (error) {
    if (requestId !== projectSkillsScanRequestId || !props.show || project.value?.id !== projectId) return
    projectSkillsLoadError.value = error instanceof Error ? error.message : 'skills 加载失败'
  } finally {
    if (requestId === projectSkillsScanRequestId) {
      isLoadingProjectSkills.value = false
    }
  }
}

watch(() => props.show, (visible) => {
  if (!visible) {
    projectSkillsScanRequestId += 1
    isLoadingProjectSkills.value = false
    return
  }
  targetWordCount.value = parseChapterWordTarget(chapter.value?.wordTarget) || 3000
  selectedRefIds.value = [...(project.value?.selectedReferenceWorkIds ?? [])]
  userPrompt.value = ''
  expandedStepId.value = 'draft'
  Object.assign(steps, createDefaultFirstDraftSteps())
  void scanAvailableProjectSkills()
})

function toggleStep(stepId: FirstDraftStepId, value: boolean): void {
  const meta = FIRST_DRAFT_STEP_DEFINITIONS.find((item) => item.id === stepId)
  steps[stepId].enabled = meta?.required ? true : value
}

function toggleExpanded(stepId: FirstDraftStepId): void {
  expandedStepId.value = stepId
}

function handleConfirm(): void {
  const selectableSkillIds = new Set(selectableProjectSkills.value.map((skill) => skill.id))
  emit('confirm', {
    targetWordCount: targetWordCount.value,
    selectedReferenceWorkIds: selectedRefIds.value,
    userPrompt: userPrompt.value.trim(),
    steps: FIRST_DRAFT_STEP_DEFINITIONS.reduce((acc, item) => {
      acc[item.id] = {
        ...steps[item.id],
        id: item.id,
        enabled: item.required ? true : steps[item.id].enabled,
        skillMode: steps[item.id].skillMode,
        skillIds: steps[item.id].skillIds.filter((skillId) => selectableSkillIds.has(skillId)),
        userPrompt: steps[item.id].userPrompt.trim()
      }
      return acc
    }, {} as Record<FirstDraftStepId, FirstDraftStepConfig>)
  })
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="生成初稿配置"
    :style="{ width: 'min(920px, 94vw)' }"
    :mask-closable="true"
    :closable="true"
    :bordered="false"
    @close="$emit('cancel')"
    @mask-click="$emit('cancel')"
  >
    <div class="config-form arc-scrollbar">
      <div class="overview-grid">
        <section class="config-section compact-panel">
          <div>
            <label class="section-label">目标字数</label>
            <p class="section-hint">正文生成会按这个目标控制篇幅。可一键按目标调整当前章节：超出则精简、不足则扩充。</p>
          </div>
          <n-input-number
            v-model:value="targetWordCount"
            :min="500"
            :max="10000"
            :step="500"
            size="small"
          />
          <n-button
            class="apply-target-btn"
            size="small"
            secondary
            type="primary"
            @click="emit('apply-target-words', targetWordCount)"
          >
            <template #icon><Save :size="13" /></template>
            按目标字数调整当前章节
          </n-button>
        </section>

        <section class="config-section prompt-panel">
          <div class="section-title-row">
            <div>
              <label class="section-label">全局补充指令（可选）</label>
              <p class="section-hint">可保存为预设，历史最多保留 200 条，支持搜索复用。</p>
            </div>
            <div class="prompt-toolbar">
              <n-button size="tiny" secondary @click="saveCurrentGlobalPrompt">
                <template #icon><Save :size="14" /></template>
                保存预设
              </n-button>
              <n-button size="tiny" secondary @click="showGlobalPromptHistory = !showGlobalPromptHistory">
                <template #icon><History :size="14" /></template>
                {{ showGlobalPromptHistory ? '收起历史' : '历史' }}
              </n-button>
            </div>
          </div>
          <n-input
            v-model:value="userPrompt"
            type="textarea"
            placeholder="如：这章节奏要快、多写对白、强调角色内心冲突..."
            :rows="3"
            size="small"
          />

          <div v-if="showGlobalPromptHistory" class="global-prompt-history">
            <div class="history-search-row">
              <n-input
                v-model:value="globalPromptSearch"
                size="tiny"
                placeholder="搜索已保存的全局指令..."
                clearable
              >
                <template #prefix><Search :size="13" /></template>
              </n-input>
              <div class="search-mode-switch">
                <button
                  v-for="mode in [{ value: 'keyword', label: '关键字' }, { value: 'fuzzy', label: '模糊' }, { value: 'exact', label: '完整匹配' }] as const"
                  :key="mode.value"
                  type="button"
                  class="search-mode-btn"
                  :class="{ active: globalPromptSearchMode === mode.value }"
                  @click="globalPromptSearchMode = mode.value"
                >
                  {{ mode.label }}
                </button>
              </div>
            </div>
            <div class="history-list arc-scrollbar">
              <div v-if="filteredGlobalPrompts.length === 0" class="history-empty">
                {{ savedGlobalPrompts.length === 0 ? '暂无保存的全局指令' : '未搜索到匹配的指令' }}
              </div>
              <div v-for="item in filteredGlobalPrompts" :key="item.id" class="history-item">
                <button type="button" class="history-item-apply" @click="applyGlobalPrompt(item)">
                  <span class="history-item-text">{{ item.text }}</span>
                  <span class="history-item-time">{{ new Date(item.at).toLocaleString() }}</span>
                </button>
                <button
                  type="button"
                  class="history-item-delete"
                  title="删除该条预设"
                  @click="deleteGlobalPrompt(item.id)"
                >
                  <Trash2 :size="13" />
                </button>
              </div>
            </div>
            <div class="history-footer">
              <span class="history-count">已保存 {{ savedGlobalPrompts.length }} / {{ GLOBAL_PROMPT_HISTORY_LIMIT }} 条</span>
              <n-button v-if="savedGlobalPrompts.length > 0" size="tiny" quaternary type="error" @click="clearGlobalPromptHistory">清空全部</n-button>
            </div>
          </div>
        </section>
      </div>

      <section class="config-section context-preview-panel">
        <div class="section-title-row">
          <div>
            <label class="section-label">本章上下文预览</label>
            <p class="section-hint">生成初稿会优先带入这些角色、组织、设定和关系；来源包含当前章节、大纲绑定和相邻章节。</p>
          </div>
          <div class="context-stat-row">
            <span v-for="item in contextStats" :key="item.label" class="context-stat">
              {{ item.label }} {{ item.value }}
            </span>
          </div>
        </div>

        <div v-if="hasContextPreviewData" class="context-preview-grid">
          <section class="context-preview-block outline-block">
            <span class="preview-label">当前绑定大纲</span>
            <strong>{{ contextPreview.currentOutlineItem?.title || '未绑定大纲' }}</strong>
            <p>{{ contextPreview.currentOutlineItem?.summary || '没有绑定大纲时，会按章节标题、摘要和正文自动匹配上下文。' }}</p>
            <div v-if="contextPreview.currentOutlineItem?.relatedCharacterNames?.length || contextPreview.currentOutlineItem?.relatedOrganizationNames?.length || contextPreview.currentOutlineItem?.relatedWorldviewTitles?.length" class="outline-linked-tags">
              <n-tag
                v-for="name in contextPreview.currentOutlineItem?.relatedCharacterNames ?? []"
                :key="`character-${name}`"
                size="small"
                round
                type="info"
              >
                {{ name }}
              </n-tag>
              <n-tag
                v-for="name in contextPreview.currentOutlineItem?.relatedOrganizationNames ?? []"
                :key="`organization-${name}`"
                size="small"
                round
                type="warning"
              >
                {{ name }}
              </n-tag>
              <n-tag
                v-for="title in contextPreview.currentOutlineItem?.relatedWorldviewTitles ?? []"
                :key="`worldview-${title}`"
                size="small"
                round
                type="success"
              >
                {{ title }}
              </n-tag>
            </div>
          </section>

          <section class="context-preview-block">
            <span class="preview-label">相关角色</span>
            <div v-if="contextPreview.characters.length" class="preview-chip-list">
              <n-tag v-for="item in contextPreview.characters" :key="item.id" size="small" round>
                {{ item.name }}{{ item.role ? ` · ${item.role}` : '' }}
              </n-tag>
            </div>
            <p v-else class="preview-empty">暂无匹配角色</p>
          </section>

          <section class="context-preview-block">
            <span class="preview-label">相关组织</span>
            <div v-if="contextPreview.organizations.length" class="preview-chip-list">
              <n-tag v-for="item in contextPreview.organizations" :key="item.id" size="small" round>
                {{ item.name }}{{ item.type ? ` · ${item.type}` : '' }}
              </n-tag>
            </div>
            <p v-else class="preview-empty">暂无匹配组织</p>
          </section>

          <section class="context-preview-block">
            <span class="preview-label">相关设定</span>
            <div v-if="contextPreview.worldviewEntries.length" class="preview-chip-list">
              <n-tag v-for="item in contextPreview.worldviewEntries" :key="item.id" size="small" round>
                {{ item.title }}{{ item.type ? ` · ${item.type}` : '' }}
              </n-tag>
            </div>
            <p v-else class="preview-empty">暂无匹配设定</p>
          </section>

          <section class="context-preview-block relation-block">
            <span class="preview-label">关系与归属</span>
            <div v-if="previewRelationships.length || previewMemberships.length" class="relation-preview-list">
              <span v-for="item in previewRelationships" :key="`rel-${item.id}`">{{ item.label }}</span>
              <span v-for="item in previewMemberships" :key="`mem-${item.id}`">{{ item.label }}</span>
            </div>
            <p v-else class="preview-empty">暂无匹配关系</p>
          </section>
        </div>

        <div v-else class="context-preview-empty">
          当前项目还没有可用于本章预览的角色、组织或设定。
        </div>
      </section>

      <section v-if="referenceWorks.length > 0" class="config-section reference-panel">
        <div class="section-title-row">
          <div>
            <label class="section-label">参考作品（拆书库）</label>
            <p class="section-hint">勾选的作品风格将注入初稿步骤，不勾选则不参考。</p>
          </div>
          <span class="selection-count">{{ selectedRefIds.length }} / {{ referenceWorks.length }}</span>
        </div>
        <n-checkbox-group v-model:value="selectedRefIds">
          <div class="checkbox-list">
            <n-checkbox v-for="work in referenceWorks" :key="work.id" :value="work.id" :label="work.title" />
          </div>
        </n-checkbox-group>
      </section>

      <section class="config-section workflow-section">
        <div class="section-title-row">
          <div>
            <label class="section-label">生成步骤</label>
            <p class="section-hint">每一步都可以配置提示词技巧和补充提示词；初稿步骤为必选。</p>
          </div>
        </div>

        <div class="workflow-layout">
          <div class="step-list">
            <article
              v-for="step in FIRST_DRAFT_STEP_DEFINITIONS"
              :key="step.id"
              class="step-item"
              :class="{ active: expandedStepId === step.id, disabled: !steps[step.id].enabled }"
            >
              <button type="button" class="step-main" @click="toggleExpanded(step.id)">
                <span class="step-index">{{ FIRST_DRAFT_STEP_DEFINITIONS.findIndex((item) => item.id === step.id) + 1 }}</span>
                <span class="step-copy">
                  <span class="step-label">{{ step.label }}</span>
                  <span class="step-desc">{{ step.description }}</span>
                  <span class="step-skill-status">{{ getSkillModeText(step.id) }}</span>
                </span>
              </button>
              <n-switch
                :value="steps[step.id].enabled"
                :disabled="step.required"
                size="small"
                @update:value="(value) => toggleStep(step.id, value)"
              />
            </article>
          </div>

          <section v-if="activeStep" class="step-detail">
            <div class="step-detail-head">
              <div>
                <span class="step-detail-kicker">当前步骤</span>
                <h3>{{ activeStep.label }}</h3>
                <p>{{ activeStep.description }}</p>
              </div>
              <span class="step-detail-status">{{ getSkillModeText(activeStep.id) }}</span>
            </div>

            <div class="step-config">
              <section class="field-block">
                <div class="field-block-head">
                  <label class="field-label">提示词技巧</label>
                  <n-tooltip trigger="hover">
                    <template #trigger>
                      <button type="button" class="field-help" aria-label="提示词技巧说明">
                        <CircleHelp :size="14" />
                      </button>
                    </template>
                    {{ getSkillModeHint(activeStep.id) }}
                  </n-tooltip>
                </div>
                <n-select
                  v-model:value="steps[activeStep.id].skillMode"
                  size="small"
                  :options="skillModeOptions"
                />
              </section>

              <template v-if="steps[activeStep.id].skillMode === 'manual'">
                <section class="field-block">
                  <div class="field-block-head">
                    <label class="field-label">指定skills</label>
                    <div class="field-head-actions">
                      <n-tooltip trigger="hover">
                        <template #trigger>
                          <button type="button" class="field-help" aria-label="指定skills说明">
                            <CircleHelp :size="14" />
                          </button>
                        </template>
                        工具类 skills 已隐藏；不选则本步骤不使用 skills。
                      </n-tooltip>
                      <span class="field-count">{{ getSelectedSkills(activeStep.id).length }} 个</span>
                    </div>
                  </div>
                  <div v-if="isLoadingProjectSkills" class="skill-picker-empty">
                    正在加载可用 skills...
                  </div>
                  <div v-else-if="selectableProjectSkills.length > 0" class="skill-picker-list arc-scrollbar">
                    <button
                      v-for="skill in selectableProjectSkills"
                      :key="skill.id"
                      type="button"
                      class="skill-picker-card"
                      :class="{ selected: isSkillSelected(activeStep.id, skill.id), muted: !skill.enabled }"
                      @click="toggleStepSkill(activeStep.id, skill.id)"
                    >
                      <span class="skill-picker-head">
                        <strong>{{ skill.name }}</strong>
                        <span>{{ getSkillCategoryLabel(skill) }} · {{ getSkillSourceLabel(skill) }}{{ skill.enabled ? '' : ' · 未启用' }}</span>
                      </span>
                      <span class="skill-picker-desc">{{ getSkillUsageText(skill) }}</span>
                      <span class="skill-picker-mark">{{ isSkillSelected(activeStep.id, skill.id) ? '已选' : '选择' }}</span>
                    </button>
                  </div>
                  <div v-else class="skill-picker-empty" :class="{ error: projectSkillsLoadError }">
                    {{ projectSkillsLoadError || '当前项目还没有适合初稿流程手动指定的 skills。' }}
                  </div>
                </section>
              </template>

              <section class="field-block">
                <div class="field-block-head">
                  <label class="field-label">补充提示词</label>
                  <n-tooltip trigger="hover">
                    <template #trigger>
                      <button type="button" class="field-help" aria-label="补充提示词说明">
                        <CircleHelp :size="14" />
                      </button>
                    </template>
                    只影响当前步骤。
                  </n-tooltip>
                </div>
                <n-input
                  v-model:value="steps[activeStep.id].userPrompt"
                  type="textarea"
                  :rows="3"
                  size="small"
                  placeholder="例如：修复时优先保留对白、去 AI 味时不要口语化过度..."
                />
              </section>

              <section class="field-block compact-field-block">
                <div class="field-block-head">
                  <label class="field-label">失败时</label>
                  <n-tooltip trigger="hover">
                    <template #trigger>
                      <button type="button" class="field-help" aria-label="失败策略说明">
                        <CircleHelp :size="14" />
                      </button>
                    </template>
                    {{ activeStep.required ? '必选步骤失败时会停止流程。' : '控制当前步骤失败后的流程行为。' }}
                  </n-tooltip>
                </div>
                <n-select
                  v-model:value="steps[activeStep.id].failurePolicy"
                  size="small"
                  :options="failureOptions"
                  :disabled="activeStep.required"
                />
              </section>
            </div>
          </section>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <n-button size="small" @click="$emit('cancel')">取消</n-button>
        <n-button type="primary" size="small" @click="handleConfirm">开始生成</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.apply-target-btn {
  align-self: flex-start;
  margin-top: 2px;
}
.config-form {
  display: flex;
  max-height: min(76vh, 760px);
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 2px 6px 2px 0;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.overview-grid {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 12px;
}

.compact-panel,
.prompt-panel,
.reference-panel,
.context-preview-panel,
.workflow-section {
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.2));
  border-radius: 8px;
  background: var(--arc-bg-surface, #fff);
  padding: 12px;
}

.compact-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: space-between;
  gap: 14px;
}

.prompt-toolbar {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.global-prompt-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.18));
  border-radius: 8px;
  background: var(--arc-bg-body, rgba(248, 248, 248, 0.72));
  padding: 8px;
}

.history-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-search-row .n-input {
  flex: 1;
  min-width: 0;
}

.search-mode-switch {
  display: inline-flex;
  flex: 0 0 auto;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 999px;
  overflow: hidden;
}

.search-mode-btn {
  border: 0;
  background: transparent;
  color: var(--arc-text-hint, #999);
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 6px 10px;
  transition: background 0.16s ease, color 0.16s ease;
}

.search-mode-btn.active {
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 12%, transparent);
  color: var(--arc-primary, #4f6edb);
  font-weight: 600;
}

.history-list {
  display: flex;
  max-height: 190px;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 2px;
}

.history-item {
  display: flex;
  align-items: stretch;
  gap: 6px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.16));
  border-radius: 6px;
  background: var(--arc-bg-surface, #fff);
}

.history-item-apply {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 7px 9px;
  text-align: left;
}

.history-item-apply:hover .history-item-text {
  color: var(--arc-primary, #4f6edb);
}

.history-item-text {
  overflow: hidden;
  color: var(--arc-text-primary, #222);
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-time {
  color: var(--arc-text-hint, #999);
  font-size: 11px;
}

.history-item-delete {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  border: 0;
  background: transparent;
  color: var(--arc-text-hint, #999);
  cursor: pointer;
  transition: color 0.16s ease;
}

.history-item-delete:hover {
  color: var(--arc-danger, #d03050);
}

.history-empty {
  color: var(--arc-text-hint, #999);
  font-size: 12px;
  padding: 14px;
  text-align: center;
}

.history-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.history-count {
  color: var(--arc-text-hint, #999);
  font-size: 11px;
}

.section-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-label {
  color: var(--arc-text-primary, #333);
  font-size: 13px;
  font-weight: 600;
}

.section-hint {
  margin: 2px 0 0;
  color: var(--arc-text-hint, #999);
  font-size: 12px;
  line-height: 1.5;
}

.selection-count {
  flex: 0 0 auto;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 999px;
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
}

.context-preview-panel {
  gap: 12px;
}

.context-stat-row {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.context-stat {
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 999px;
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
}

.context-preview-grid {
  display: grid;
  grid-template-columns: minmax(220px, 1.1fr) repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.context-preview-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.16));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-bg-body, #f8f8f8) 58%, var(--arc-bg-surface, #fff));
  padding: 10px;
}

.outline-block,
.relation-block {
  grid-row: span 2;
}

.preview-label {
  color: var(--arc-text-hint, #999);
  font-size: 11px;
  font-weight: 700;
}

.context-preview-block strong {
  overflow: hidden;
  color: var(--arc-text-primary, #222);
  font-size: 13px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-preview-block p {
  margin: 0;
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  line-height: 1.55;
}

.outline-linked-tags,
.preview-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.relation-preview-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.relation-preview-list span {
  overflow: hidden;
  border-radius: 6px;
  background: var(--arc-bg-surface, #fff);
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  line-height: 1.45;
  padding: 6px 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-empty,
.context-preview-empty {
  color: var(--arc-text-hint, #999);
  font-size: 12px;
}

.context-preview-empty {
  border: 1px dashed var(--arc-border, rgba(120, 120, 120, 0.28));
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}

.checkbox-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  max-height: 86px;
  overflow-y: auto;
  padding-right: 4px;
}

.workflow-layout {
  display: grid;
  grid-template-columns: minmax(240px, 0.82fr) minmax(0, 1.18fr);
  gap: 12px;
  align-items: start;
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.25));
  border-radius: 8px;
  background: var(--arc-bg-body, rgba(248, 248, 248, 0.72));
  padding: 9px 10px;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.step-item.active {
  border-color: color-mix(in srgb, var(--arc-primary, #6a8cff) 45%, var(--arc-border, rgba(120, 120, 120, 0.25)));
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 7%, var(--arc-bg-surface, #fff));
  box-shadow: inset 3px 0 0 var(--arc-primary, #6a8cff);
}

.step-item.disabled {
  opacity: 0.62;
}

.step-main {
  display: flex;
  align-items: flex-start;
  min-width: 0;
  gap: 10px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.step-index {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--arc-bg-surface, #fff);
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  font-weight: 700;
}

.step-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.step-label {
  color: var(--arc-text-primary, #222);
  font-size: 13px;
  font-weight: 600;
}

.step-desc {
  overflow: hidden;
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-skill-status {
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 999px;
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-detail {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.25));
  border-radius: 8px;
  background: var(--arc-bg-body, rgba(248, 248, 248, 0.72));
  padding: 12px;
}

.step-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--arc-border, rgba(120, 120, 120, 0.18));
}

.step-detail-kicker {
  color: var(--arc-text-hint, #999);
  font-size: 11px;
  font-weight: 700;
}

.step-detail-head h3 {
  margin: 2px 0 4px;
  color: var(--arc-text-primary, #222);
  font-size: 16px;
  line-height: 1.25;
}

.step-detail-head p {
  margin: 0;
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  line-height: 1.5;
}

.step-detail-status {
  flex: 0 0 auto;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 10%, transparent);
  color: var(--arc-primary, #4f6edb);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 6px 9px;
}

.step-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.18));
  border-radius: 8px;
  background: var(--arc-bg-surface, #fff);
  padding: 10px;
}

.field-block-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
}

.compact-field-block {
  max-width: none;
}

.field-label {
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  font-weight: 600;
}

.field-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.field-count {
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 999px;
  color: var(--arc-text-hint, #999);
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
}

.field-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 0;
  background: transparent;
  color: var(--arc-text-hint, #999);
  cursor: help;
  padding: 0;
  transition: color 0.16s ease, transform 0.16s ease;
}

.field-help svg {
  display: block;
}

.field-help:hover,
.field-help:focus-visible {
  color: var(--arc-primary, #4f6edb);
  transform: translateY(-1px);
  outline: none;
}

.skill-picker-list {
  display: grid;
  max-height: 210px;
  grid-template-columns: 1fr;
  gap: 8px;
  overflow-y: auto;
  padding-right: 3px;
}

.skill-picker-card {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.22));
  border-radius: 8px;
  background: var(--arc-bg-surface, #fff);
  color: inherit;
  cursor: pointer;
  padding: 9px 58px 9px 10px;
  text-align: left;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.skill-picker-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary, #6a8cff) 34%, var(--arc-border, rgba(120, 120, 120, 0.22)));
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 4%, var(--arc-bg-surface, #fff));
}

.skill-picker-card.selected {
  border-color: color-mix(in srgb, var(--arc-primary, #6a8cff) 58%, var(--arc-border, rgba(120, 120, 120, 0.22)));
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 8%, var(--arc-bg-surface, #fff));
  box-shadow: inset 3px 0 0 var(--arc-primary, #6a8cff);
}

.skill-picker-card.muted {
  opacity: 0.72;
}

.skill-picker-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.skill-picker-head strong {
  min-width: 0;
  overflow: hidden;
  color: var(--arc-text-primary, #222);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-picker-head span {
  flex: 0 0 auto;
  color: var(--arc-text-hint, #999);
  font-size: 11px;
}

.skill-picker-desc {
  color: var(--arc-text-secondary, #666);
  font-size: 12px;
  line-height: 1.5;
}

.skill-picker-mark {
  position: absolute;
  top: 9px;
  right: 10px;
  border: 1px solid var(--arc-border, rgba(120, 120, 120, 0.2));
  border-radius: 999px;
  color: var(--arc-text-secondary, #666);
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
}

.skill-picker-card.selected .skill-picker-mark {
  border-color: color-mix(in srgb, var(--arc-primary, #6a8cff) 36%, transparent);
  background: color-mix(in srgb, var(--arc-primary, #6a8cff) 12%, transparent);
  color: var(--arc-primary, #4f6edb);
  font-weight: 650;
}

.skill-picker-empty {
  border: 1px dashed var(--arc-border, rgba(120, 120, 120, 0.28));
  border-radius: 8px;
  color: var(--arc-text-hint, #999);
  font-size: 12px;
  padding: 14px;
  text-align: center;
}

.skill-picker-empty.error {
  color: var(--arc-danger, #d03050);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 640px) {
  .overview-grid,
  .context-preview-grid,
  .workflow-layout {
    grid-template-columns: 1fr;
  }

  .config-form {
    max-height: min(78vh, 720px);
  }

  .field-label {
    align-self: flex-start;
  }

  .field-block-head {
    align-items: center;
  }

  .compact-field-block {
    max-width: none;
  }

  .step-detail {
    position: static;
  }
}
</style>
