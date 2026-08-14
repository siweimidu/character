<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, Search, Sparkles, Trash2, Upload, Wand2 } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NCollapse,
  NCollapseItem,
  NDescriptions,
  NDescriptionsItem,
  NDropdown,
  NEmpty,
  NInput,
  NList,
  NListItem,
  NModal,
  NRadio,
  NRadioGroup,
  NScrollbar,
  NStatistic,
  NTag,
  useDialog,
  useMessage,
  type DropdownOption
} from 'naive-ui'
import {
  buildKnowledgeCenterState,
  buildReferenceAssetLibraries,
  compareReferenceAssetDocuments,
  type KnowledgeDocumentView,
  type ReferenceAssetLibrary
} from '@/features/knowledge/knowledgeCenter'
import { useAppStore } from '@/stores/app'
import { useBatchImport } from '@/composables/useBatchImport'
import { toIpcPayload } from '@/utils/ipcPayload'
import BatchImportModal from './BatchImportModal.vue'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const { openModal } = useBatchImport()

const keyword = ref('')
const selectedDocument = ref<KnowledgeDocumentView | null>(null)

const allState = computed(() => buildKnowledgeCenterState(appStore.knowledgeDocuments))
const referenceAssets = computed(() =>
  buildReferenceAssetLibraries(appStore.referenceWorks, allState.value.documents)
)
const detailVisible = computed({
  get: () => Boolean(selectedDocument.value),
  set: (value: boolean) => {
    if (!value) {
      selectedDocument.value = null
    }
  }
})

const healthTone = computed(() => (referenceAssets.value.length > 0 ? 'stable' : 'attention'))

const librarySummaryCards = computed(() => [
  {
    key: 'assets',
    label: '参考资产',
    value: referenceAssets.value.length.toLocaleString(),
    hint: '已归档的参考作品与拆书簇'
  },
  {
    key: 'summaries',
    label: '总纲文档',
    value: referenceAssets.value.reduce((count, asset) => count + asset.summaryCount, 0).toLocaleString(),
    hint: '整书风格总纲与骨架'
  },
  {
    key: 'chunks',
    label: '分块文档',
    value: referenceAssets.value.reduce((count, asset) => count + asset.chunkCount, 0).toLocaleString(),
    hint: '局部拆书结论与桥段分析'
  },
  {
    key: 'duplicate',
    label: '风格规则',
    value: referenceAssets.value.reduce((count, asset) => count + asset.styleRules.length, 0).toLocaleString(),
    hint: '累计沉淀的可复用写法'
  }
])

function openDocument(documentView: KnowledgeDocumentView): void {
  selectedDocument.value = documentView
}

function openReferenceAsset(asset: ReferenceAssetLibrary): void {
  if (asset.primaryDocument) {
    openDocument(asset.primaryDocument)
  }
}

function removeReferenceAsset(asset: ReferenceAssetLibrary): void {
  dialog.warning({
    title: '删除参考资产',
    content: `确认删除《${asset.title}》的拆书资产吗？这会一并删除关联的知识文档和参考作品档案，无法撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      appStore.removeKnowledgeDocuments(asset.relatedDocumentIds)
      appStore.removeReferenceWork(asset.id)
      if (selectedDocument.value && asset.relatedDocumentIds.includes(selectedDocument.value.document.id)) {
        selectedDocument.value = null
      }
      message.success(`已删除《${asset.title}》的拆书资产`)
    }
  })
}

function removeKnowledgeDocument(documentView: KnowledgeDocumentView): void {
  dialog.warning({
    title: '删除知识文档',
    content: `确认删除「${documentView.document.title}」吗？此操作无法撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      appStore.removeKnowledgeDocuments([documentView.document.id])
      selectedDocument.value = null
      message.success(`已删除「${documentView.document.title}」`)
    }
  })
}

const deepAnalyzingAssetId = ref<string | null>(null)
const fingerprintExtractingAssetId = ref<string | null>(null)

const SOURCE_TEXT_CHAR_CAP = 30_000

function buildDeepAnalyzeSourceText(asset: ReferenceAssetLibrary): string {
  const chunks = appStore.knowledgeDocuments
    .filter((doc) => doc.sourceType === 'reference-chunk' && asset.relatedDocumentIds.includes(doc.id))
    .map((doc) => ({
      label: String(doc.metadata?.chunkLabel ?? doc.title).trim() || doc.title,
      order: Number(doc.metadata?.chunkOrder ?? Number.MAX_SAFE_INTEGER),
      text: String(doc.metadata?.rawText ?? doc.content ?? '')
    }))
    .sort((a, b) => a.order - b.order)

  if (!chunks.length) {
    return asset.primaryDocument?.document.content ?? ''
  }

  let acc = ''
  for (const chunk of chunks) {
    const piece = `\n\n【${chunk.label}】\n${chunk.text}`
    if (acc.length + piece.length > SOURCE_TEXT_CHAR_CAP) {
      acc += `\n\n[...剩余 ${chunks.length - chunks.indexOf(chunk)} 段已超出本次分析上限，本次只对前段拆解。]`
      break
    }
    acc += piece
  }
  return acc.trim()
}

async function handleAiDeepAnalyze(asset: ReferenceAssetLibrary): Promise<void> {
  if (deepAnalyzingAssetId.value) {
    message.info('上一次深度拆书还在进行中，请稍候。')
    return
  }

  const sourceText = buildDeepAnalyzeSourceText(asset)
  if (!sourceText.trim()) {
    message.error('找不到该参考作品的原文片段，无法进行深度拆书。')
    return
  }

  deepAnalyzingAssetId.value = asset.id
  const loading = message.loading(`AI 正在深度拆解《${asset.title}》，可能需要 1-3 分钟…`, { duration: 0 })
  try {
    const response = await window.characterArc.generateAi(JSON.parse(JSON.stringify({
      task: 'reference-deep-analyze',
      settings: appStore.appSettings,
      context: {
        referenceTitle: asset.title,
        referenceFileName: asset.fileName,
        referenceGenre: asset.topKeywords.slice(0, 3).join('、'),
        sourceText
      }
    })))

    if (!response.success) {
      throw new Error(response.error ?? 'AI 深度拆书失败')
    }
    message.success(`已完成《${asset.title}》深度拆书，新增的知识文档稍后会出现在列表中。`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 深度拆书失败')
  } finally {
    loading.destroy()
    deepAnalyzingAssetId.value = null
  }
}

async function handleStyleFingerprintExtract(asset: ReferenceAssetLibrary): Promise<void> {
  if (fingerprintExtractingAssetId.value) {
    message.info('上一次风格指纹提取还在进行中，请稍候。')
    return
  }

  const novelResult = await window.characterArc.readReferenceNovelText(asset.id)
  if (!novelResult.success || !novelResult.content) {
    message.error(novelResult.error ?? '未找到该参考作品的原文存档，请重新导入参考小说。')
    return
  }

  const sourceText = novelResult.content.length > 80000 ? novelResult.content.slice(0, 80000) : novelResult.content

  fingerprintExtractingAssetId.value = asset.id
  const loading = message.loading(`AI 正在从原文提取《${asset.title}》的风格指纹（${Math.round(sourceText.length / 10000)}万字样本），可能需要 2-4 分钟…`, { duration: 0 })
  try {
    const response = await window.characterArc.generateAi(JSON.parse(JSON.stringify({
      task: 'style-fingerprint-extract',
      settings: appStore.appSettings,
      context: {
        referenceTitle: asset.title,
        referenceFileName: asset.fileName,
        referenceGenre: asset.topKeywords.slice(0, 3).join('、'),
        sourceText
      }
    })))

    if (!response.success) {
      throw new Error(response.error ?? 'AI 风格指纹提取失败')
    }
    message.success(`已完成《${asset.title}》风格指纹提取，新增的知识文档稍后会出现在列表中。`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 风格指纹提取失败')
  } finally {
    loading.destroy()
    fingerprintExtractingAssetId.value = null
  }
}

const groupedAssets = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) {
    return referenceAssets.value
  }

  return referenceAssets.value.filter((asset) => {
    const relatedDocuments = allState.value.documents.filter((item) => asset.relatedDocumentIds.includes(item.document.id))
    const haystack = [
      asset.title,
      asset.source,
      asset.fileName,
      asset.summary,
      asset.topKeywords.join(' '),
      asset.styleRules.join(' '),
      ...relatedDocuments.flatMap((item) => [
        item.document.title,
        item.document.summary,
        item.document.content,
        item.document.keywords.join(' ')
      ])
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(query)
  })
})

function resolveAssetDocuments(asset: ReferenceAssetLibrary): KnowledgeDocumentView[] {
  return allState.value.documents
    .filter((item) => asset.relatedDocumentIds.includes(item.document.id))
    .sort((left, right) => compareReferenceAssetDocuments(left.document, right.document))
}

const exportLoading = ref(false)

function buildExportAssets(): Array<{
  title: string
  source: string
  fileName: string
  notes: string
  summary: string
  topKeywords: string[]
  styleRules: string[]
  documents: Array<{
    title: string
    sourceType: string
    sourceLabel: string
    content: string
    summary: string
    keywords: string[]
  }>
}> {
  return referenceAssets.value.map((asset) => ({
    title: asset.title,
    source: asset.source,
    fileName: asset.fileName,
    notes: asset.notes,
    summary: asset.summary,
    topKeywords: asset.topKeywords,
    styleRules: asset.styleRules,
    documents: resolveAssetDocuments(asset).map((item) => ({
      title: item.document.title,
      sourceType: item.document.sourceType,
      sourceLabel: item.document.sourceLabel,
      content: item.document.content,
      summary: item.document.summary,
      keywords: item.document.keywords
    }))
  }))
}

async function handleExportKnowledge(format: 'txt' | 'md' | 'json' | 'docx'): Promise<void> {
  if (!referenceAssets.value.length) {
    message.warning('拆书知识库中还没有可导出的内容')
    return
  }

  const assets = buildExportAssets()
  const projectTitle = appStore.selectedProjectId
    ? (appStore.projects.find((project) => project.id === appStore.selectedProjectId)?.title ?? '')
    : ''

  exportLoading.value = true
  try {
    const result = await window.characterArc.exportKnowledge(toIpcPayload({ format, projectTitle, assets }))
    if (!result.success) {
      if (!result.canceled) message.error(result.error ?? '导出失败')
      return
    }
    message.success(`已导出 ${assets.length} 部拆书资产`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败')
  } finally {
    exportLoading.value = false
  }
}

// ── 导出拆书资产（txt / md / json） ──
const exportingAssetId = ref<string | null>(null)

const exportMenuOptions: DropdownOption[] = [
  { key: 'md', label: '导出为 Markdown' },
  { key: 'txt', label: '导出为 TXT' },
  { key: 'json', label: '导出为 JSON' },
  { key: 'docx', label: '导出为 Word (.docx)' }
]

function handleExportLibrarySelect(key: string | number): void {
  void handleExportKnowledge(key as 'txt' | 'md' | 'json' | 'docx')
}

async function handleExportAsset(asset: ReferenceAssetLibrary, format: 'txt' | 'md' | 'json' | 'docx'): Promise<void> {
  if (exportingAssetId.value) {
    return
  }

  const documents = resolveAssetDocuments(asset).map((item) => ({
    title: item.document.title,
    sourceType: item.document.sourceType,
    sourceTypeLabel: item.sourceTypeLabel,
    sourceLabel: item.sourceLabelText,
    summary: item.document.summary,
    content: item.document.content,
    keywords: item.document.keywords ?? [],
    updatedAtLabel: item.updatedAtLabel
  }))

  if (!documents.length) {
    message.warning('该参考作品还没有可导出的拆书文档')
    return
  }

  exportingAssetId.value = asset.id
  try {
    const result = await window.characterArc.exportReferenceAsset(toIpcPayload({
      format,
      asset: {
        title: asset.title,
        source: asset.source,
        fileName: asset.fileName,
        notes: asset.notes,
        summary: asset.summary,
        topKeywords: asset.topKeywords,
        styleRules: asset.styleRules,
        documentCount: asset.documentCount,
        summaryCount: asset.summaryCount,
        chunkCount: asset.chunkCount,
        chapterCount: asset.chapterCount,
        characterCount: asset.characterCount,
        updatedAtLabel: asset.updatedAtLabel
      },
      documents
    }))

    if (!result.success) {
      if (!result.canceled) {
        message.error(result.error ?? '导出失败')
      }
      return
    }
    message.success(`已导出《${asset.title}》拆书资产`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败')
  } finally {
    exportingAssetId.value = null
  }
}

function handleExportAssetSelect(asset: ReferenceAssetLibrary, key: string | number): void {
  void handleExportAsset(asset, key as 'txt' | 'md' | 'json' | 'docx')
}

// ── AI 按拆书风格生成作品 ──
const AI_NOVEL_TASK_KEY = 'ai-novel-from-reference'
const AI_NOVEL_MAX_SELECT = 10
const aiNovelLoading = computed(() => appStore.isAiTaskRunning(AI_NOVEL_TASK_KEY))

interface AiNovelCandidate {
  sourceTitle: string
  title: string
  concept: string
  genre: string
  hook: string
  protagonist: string
  goldFinger: string
  first3Hooks: string[]
  outline: string
}

// 可选目标题材列表
const AI_NOVEL_GENRES = [
  '都市',
  '玄幻',
  '悬疑',
  '科幻',
  '仙侠',
  '历史',
  '奇幻',
  '武侠',
  '游戏',
  '现实',
  '直播',
  '体育'
] as const

// 选择参考书弹窗
const aiNovelPickerVisible = ref(false)
const aiNovelMode = ref<'fuse' | 'separate'>('fuse')
const aiNovelSelectedGenres = ref<string[]>([])
const aiNovelSelectedIds = ref<string[]>([])

// 结果弹窗
const aiNovelResultsVisible = ref(false)
const aiNovelCandidates = ref<AiNovelCandidate[]>([])
const aiNovelSelectedSeedIds = ref<string[]>([])

const aiNovelSelectedSeedCount = computed(() => aiNovelSelectedSeedIds.value.length)
const aiNovelHasSelectedSeed = computed(() => aiNovelSelectedSeedIds.value.length > 0)

function openAiNovelPicker(): void {
  aiNovelMode.value = 'fuse'
  aiNovelSelectedGenres.value = []
  aiNovelSelectedIds.value = []
  aiNovelPickerVisible.value = true
}

// 目标题材按钮：是否全部选中
function isAiNovelAllGenresSelected(): boolean {
  return aiNovelSelectedGenres.value.length === AI_NOVEL_GENRES.length
}

// 目标题材按钮：全选 / 取消全选
function toggleAiNovelAllGenres(): void {
  aiNovelSelectedGenres.value = isAiNovelAllGenresSelected()
    ? []
    : [...AI_NOVEL_GENRES]
}

// 目标题材按钮：切换单个题材选中状态
function toggleAiNovelGenre(genre: string): void {
  const index = aiNovelSelectedGenres.value.indexOf(genre)
  if (index >= 0) {
    aiNovelSelectedGenres.value = aiNovelSelectedGenres.value.filter((item) => item !== genre)
  } else {
    aiNovelSelectedGenres.value = [...aiNovelSelectedGenres.value, genre]
  }
}

function isAiNovelGenreSelected(genre: string): boolean {
  return aiNovelSelectedGenres.value.includes(genre)
}

function toggleAiNovelAll(): void {
  const allSelected = referenceAssets.value.length > 0
    && referenceAssets.value.every((asset) => aiNovelSelectedIds.value.includes(asset.id))
  aiNovelSelectedIds.value = allSelected ? [] : referenceAssets.value.map((asset) => asset.id).slice(0, AI_NOVEL_MAX_SELECT)
}

function isAiNovelAllSelected(): boolean {
  return referenceAssets.value.length > 0
    && referenceAssets.value.every((asset) => aiNovelSelectedIds.value.includes(asset.id))
}

function buildAiNovelReferenceContext(assets: ReferenceAssetLibrary[]): Array<Record<string, unknown>> {
  return assets.map((asset) => {
    const docs = resolveAssetDocuments(asset)
    // 拼接拆书总纲 + 分块的内容要点，控制输入规模
    const docText = docs
      .map((item) => {
        const head = `【${item.document.title}】`
        const summary = (item.document.summary || '').trim()
        const content = (item.document.content || '').trim()
        const body = (content || summary).replace(/\s+/g, ' ').slice(0, 1200)
        return `${head} ${body}`
      })
      .join('\n')
      .slice(0, 6000)

    return {
      title: asset.title,
      source: asset.source,
      genre: asset.topKeywords.slice(0, 3).join('、') || asset.source,
      summary: asset.summary,
      styleRules: asset.styleRules,
      topKeywords: asset.topKeywords,
      documentText: docText
    }
  })
}

async function handleAiNovelGenerate(): Promise<void> {
  const pickedAssets = referenceAssets.value.filter((asset) => aiNovelSelectedIds.value.includes(asset.id))
  if (!pickedAssets.length) {
    message.warning('请先勾选至少一本已拆解的书')
    return
  }
  if (pickedAssets.length > AI_NOVEL_MAX_SELECT) {
    message.warning(`最多选择 ${AI_NOVEL_MAX_SELECT} 本参考书`)
    return
  }

  aiNovelPickerVisible.value = false
  const mode = aiNovelMode.value
  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: AI_NOVEL_TASK_KEY,
        kind: 'inspiration',
        label: '按拆书风格生成作品',
        description: mode === 'fuse'
          ? '正在融合所选书籍的风格生成一部新作品'
          : `正在为 ${pickedAssets.length} 本参考书各生成一部新作品`,
        panel: 'knowledge'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'ai-novel-from-reference',
          settings: appStore.appSettings,
          context: {
            mode,
            targetGenre: aiNovelSelectedGenres.value.join('、'),
            references: buildAiNovelReferenceContext(pickedAssets)
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 生成作品失败')
    }
    const entries = Array.isArray((result.result as Record<string, unknown>)?.entries)
      ? ((result.result as Record<string, unknown>).entries as Array<Record<string, unknown>>)
      : []
    if (entries.length === 0) {
      message.warning('AI 未返回有效的作品方案，请重试')
      return
    }
    aiNovelCandidates.value = entries.map((e) => ({
      sourceTitle: String(e.sourceTitle ?? ''),
      title: String(e.title ?? '未命名作品'),
      concept: String(e.concept ?? ''),
      genre: String(e.genre ?? ''),
      hook: String(e.hook ?? ''),
      protagonist: String(e.protagonist ?? ''),
      goldFinger: String(e.goldFinger ?? ''),
      first3Hooks: Array.isArray(e.first3Hooks) ? (e.first3Hooks as string[]).map(String) : [],
      outline: String(e.outline ?? '')
    }))
    aiNovelSelectedSeedIds.value = aiNovelCandidates.value.map((_, index) => String(index))
    aiNovelResultsVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成作品失败，请检查模型配置')
  }
}

function handleAiNovelCreateWorks(): void {
  const selectedSet = new Set(aiNovelSelectedSeedIds.value)
  const picked = aiNovelCandidates.value
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ index }) => selectedSet.has(String(index)))
  if (picked.length === 0) {
    message.warning('请先勾选要创建的新作品')
    return
  }

  for (const { candidate } of picked) {
    appStore.createProjectWorkspace({
      project: {
        title: candidate.title,
        genre: candidate.genre || '都市',
        novelLength: 'long',
        premise: [candidate.concept, candidate.hook, candidate.outline].filter(Boolean).join('\n')
      }
    })
  }
  aiNovelResultsVisible.value = false
  message.success(`已创建 ${picked.length} 个新作品项目`)
  appStore.backToProjects()
}

function formatAiNovelCandidate(candidate: AiNovelCandidate): string {
  return `【书名】${candidate.title}\n【来源】${candidate.sourceTitle || '多书融合'}\n【核心卖点】${candidate.concept}\n【题材】${candidate.genre}\n【钩子】${candidate.hook}\n【主角】${candidate.protagonist}\n【金手指】${candidate.goldFinger}\n【前3章钩子】\n${candidate.first3Hooks.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}\n【主线】${candidate.outline}`
}

async function copyAiNovelCandidate(candidate: AiNovelCandidate): Promise<void> {
  try {
    await navigator.clipboard.writeText(formatAiNovelCandidate(candidate))
    message.success('作品方案已复制')
  } catch {
    message.error('复制失败')
  }
}
</script>

<template>
  <section class="knowledge-screen">
    <!-- Header -->
    <div class="knowledge-header">
      <div class="knowledge-header-left">
        <strong>拆书知识库</strong>
        <n-tag :type="healthTone === 'stable' ? 'success' : 'warning'" size="small" round :bordered="false">
          {{ healthTone === 'stable' ? '已归档' : '等待第一部参考作品' }}
        </n-tag>
      </div>
      <div class="knowledge-header-actions">
        <n-button secondary class="knowledge-header-btn" @click="openModal">
          <template #icon><Upload :size="16" /></template>
          导入小说并拆书
        </n-button>
        <n-button
          type="primary"
          secondary
          class="knowledge-header-btn"
          :disabled="!referenceAssets.length"
          @click="openAiNovelPicker"
        >
          <template #icon><Wand2 :size="16" /></template>
          AI 生成作品
        </n-button>
        <n-dropdown :options="exportMenuOptions" placement="bottom-end" @select="handleExportLibrarySelect">
          <n-button secondary class="knowledge-header-btn" :loading="exportLoading">
            <template #icon><Download :size="16" /></template>
            导出拆书知识库
          </n-button>
        </n-dropdown>
      </div>
    </div>

    <!-- Stats -->
    <div class="knowledge-stats-row">
      <n-card v-for="card in librarySummaryCards" :key="card.key" size="small">
        <n-statistic :label="card.label" :value="card.value" />
      </n-card>
    </div>

    <!-- Search -->
    <div class="knowledge-toolbar">
      <n-input
        v-model:value="keyword"
        clearable
        class="knowledge-toolbar-search"
        placeholder="搜索参考作品、总纲、分块或风格规则"
      >
        <template #prefix>
          <Search :size="14" />
        </template>
      </n-input>
      <n-tag size="small" round :bordered="false" type="info">
        {{ groupedAssets.length }} / {{ referenceAssets.length }} 部
      </n-tag>
    </div>

    <!-- Asset Library -->
    <n-empty v-if="!groupedAssets.length" description="还没有沉淀参考资产，先导入参考小说并拆书。" />

    <div v-else class="knowledge-asset-stack">
      <n-card v-for="asset in groupedAssets" :key="asset.id" size="small">
        <template #header>
          <div class="asset-header">
            <strong>{{ asset.title }}</strong>
            <span>{{ asset.source }}<template v-if="asset.fileName"> &middot; {{ asset.fileName }}</template></span>
          </div>
        </template>

        <template #header-extra>
          <n-tag size="small" :bordered="false" type="info">{{ asset.documentCount }} 篇</n-tag>
        </template>

        <p class="asset-summary">{{ asset.summary }}</p>

        <div class="asset-metrics">
          <n-tag v-if="asset.summaryCount" size="tiny" :bordered="false">总纲 {{ asset.summaryCount }}</n-tag>
          <n-tag v-if="asset.chunkCount" size="tiny" :bordered="false">分块 {{ asset.chunkCount }}</n-tag>
          <n-tag v-if="asset.chapterCount > 0" size="tiny" :bordered="false">{{ asset.chapterCount }} 章</n-tag>
          <n-tag v-if="asset.characterCount > 0" size="tiny" :bordered="false">{{ asset.characterCount.toLocaleString() }} 字</n-tag>
          <span class="asset-date">{{ asset.updatedAtLabel }}</span>
        </div>

        <div v-if="asset.styleRules.length" class="asset-tags">
          <n-tag v-for="rule in asset.styleRules.slice(0, 4)" :key="`${asset.id}-${rule}`" size="small" round type="primary" :bordered="false">
            {{ rule }}
          </n-tag>
        </div>
        <div v-else-if="asset.topKeywords.length" class="asset-tags">
          <n-tag v-for="tag in asset.topKeywords.slice(0, 6)" :key="`${asset.id}-${tag}`" size="small" round type="primary" :bordered="false">
            {{ tag }}
          </n-tag>
        </div>

        <div class="asset-actions">
          <n-button tertiary type="primary" size="small" @click="openReferenceAsset(asset)">查看主文档</n-button>
          <n-dropdown
            :options="exportMenuOptions"
            placement="bottom-end"
            trigger="click"
            @select="handleExportAssetSelect(asset, $event)"
          >
            <n-button tertiary size="small" :loading="exportingAssetId === asset.id" :disabled="Boolean(exportingAssetId) && exportingAssetId !== asset.id">
              <template #icon><Download :size="14" /></template>
              导出
            </n-button>
          </n-dropdown>
          <n-button
            type="primary"
            size="small"
            :loading="deepAnalyzingAssetId === asset.id"
            :disabled="Boolean(deepAnalyzingAssetId) && deepAnalyzingAssetId !== asset.id"
            @click="handleAiDeepAnalyze(asset)"
          >
            <template #icon><Sparkles :size="14" /></template>
            AI 深度拆书
          </n-button>
          <n-button
            type="warning"
            size="small"
            :loading="fingerprintExtractingAssetId === asset.id"
            :disabled="Boolean(fingerprintExtractingAssetId) && fingerprintExtractingAssetId !== asset.id"
            @click="handleStyleFingerprintExtract(asset)"
          >
            <template #icon><Sparkles :size="14" /></template>
            风格指纹提取
          </n-button>
          <n-button tertiary type="error" size="small" @click="removeReferenceAsset(asset)">删除</n-button>
        </div>

        <n-collapse class="asset-docs-collapse">
          <n-collapse-item :title="`文档列表 (${resolveAssetDocuments(asset).length} 篇)`" name="docs">
            <n-list hoverable clickable size="small">
              <n-list-item
                v-for="item in resolveAssetDocuments(asset)"
                :key="item.document.id"
                @click="openDocument(item)"
              >
                <div class="doc-item">
                  <div class="doc-item-top">
                    <strong>{{ item.document.title }}</strong>
                    <div class="doc-item-top-right">
                      <n-tag size="tiny" :bordered="false" type="info">{{ item.sourceTypeLabel }}</n-tag>
                      <n-button
                        tertiary
                        type="error"
                        size="tiny"
                        class="doc-item-delete"
                        title="删除该文档"
                        @click.stop="removeKnowledgeDocument(item)"
                      >
                        <template #icon><Trash2 :size="12" /></template>
                      </n-button>
                    </div>
                  </div>
                  <p>{{ item.preview || '暂无摘要' }}</p>
                  <span>{{ item.updatedAtLabel }}</span>
                </div>
              </n-list-item>
            </n-list>
          </n-collapse-item>
        </n-collapse>
      </n-card>
    </div>


    <!-- Batch Import Modal -->
    <BatchImportModal />

    <!-- Detail Modal -->
    <n-modal v-model:show="detailVisible">
      <n-card style="width: min(920px, 92vw)" :bordered="false" role="dialog" aria-modal="true">
        <template #header>
          <div class="detail-header">
            <strong>{{ selectedDocument?.document.title ?? '知识详情' }}</strong>
            <span>{{ selectedDocument?.sourceLabelText ?? '' }}</span>
          </div>
        </template>
        <template #header-extra>
          <div v-if="selectedDocument" class="detail-header-actions">
            <n-tag type="info" :bordered="false">{{ selectedDocument.sourceTypeLabel }}</n-tag>
            <n-button tertiary type="error" size="small" @click="removeKnowledgeDocument(selectedDocument)">删除文档</n-button>
          </div>
        </template>

        <div v-if="selectedDocument" class="detail-body">
          <n-descriptions :column="3" label-placement="left" size="small" bordered>
            <n-descriptions-item label="范围">{{ selectedDocument.sourceScopeLabel }}</n-descriptions-item>
            <n-descriptions-item label="更新时间">{{ selectedDocument.updatedAtLabel }}</n-descriptions-item>
            <n-descriptions-item label="关键词数">{{ selectedDocument.document.keywords.length }} 个</n-descriptions-item>
          </n-descriptions>

          <n-alert v-if="selectedDocument.document.summary" type="info" :show-icon="false">
            {{ selectedDocument.document.summary }}
          </n-alert>

          <div v-if="selectedDocument.document.keywords.length" class="detail-keywords">
            <n-tag v-for="kw in selectedDocument.document.keywords" :key="kw" size="small" round type="primary" :bordered="false">
              {{ kw }}
            </n-tag>
          </div>

          <n-scrollbar style="max-height: 36vh">
            <pre class="detail-content">{{ selectedDocument.document.content || '暂无正文内容。' }}</pre>
          </n-scrollbar>
        </div>
      </n-card>
    </n-modal>

    <!-- AI 生成作品：选择参考书与模式 -->
    <n-modal v-model:show="aiNovelPickerVisible">
      <n-card style="width: min(720px, 92vw)" :bordered="false" role="dialog" aria-modal="true">
        <template #header>
          <div class="detail-header">
            <strong>AI 按拆书风格生成作品</strong>
            <span>勾选已拆解的书作为风格参考，最多 {{ AI_NOVEL_MAX_SELECT }} 本</span>
          </div>
        </template>

        <div class="ai-novel-body">
          <div class="ai-novel-mode-row">
            <span class="ai-novel-field-label">生成模式</span>
            <n-radio-group v-model:value="aiNovelMode" size="small">
              <n-radio value="fuse">融合生成（多书风格合成一本书）</n-radio>
              <n-radio value="separate">分开生成（每本书各生成一本）</n-radio>
            </n-radio-group>
          </div>

          <div class="ai-novel-mode-row">
            <span class="ai-novel-field-label">目标题材</span>
            <n-button text size="small" @click="toggleAiNovelAllGenres">
              {{ isAiNovelAllGenresSelected() ? '取消全选' : '全选' }}
            </n-button>
          </div>
          <div class="ai-novel-genre-tags">
            <n-tag
              v-for="genre in AI_NOVEL_GENRES"
              :key="genre"
              :bordered="false"
              round
              size="small"
              class="ai-novel-genre-tag"
              :type="isAiNovelGenreSelected(genre) ? 'primary' : 'default'"
              :checkable="true"
              :checked="isAiNovelGenreSelected(genre)"
              @update:checked="toggleAiNovelGenre(genre)"
            >
              {{ genre }}
            </n-tag>
          </div>

          <div class="ai-novel-select-head">
            <strong>选择参考书（{{ aiNovelSelectedIds.length }}/{{ AI_NOVEL_MAX_SELECT }}）</strong>
            <n-button text size="small" @click="toggleAiNovelAll">
              {{ isAiNovelAllSelected() ? '取消全选' : '全选' }}
            </n-button>
          </div>

          <n-scrollbar style="max-height: 46vh">
            <n-checkbox-group
              v-model:value="aiNovelSelectedIds"
              :max="AI_NOVEL_MAX_SELECT"
              class="ai-novel-ref-list"
            >
              <n-checkbox
                v-for="asset in referenceAssets"
                :key="asset.id"
                :value="asset.id"
                class="ai-novel-ref-item"
              >
                <span class="ai-novel-ref-title">{{ asset.title }}</span>
                <span class="ai-novel-ref-meta">
                  {{ asset.source }}
                  <template v-if="asset.styleRules.length">· {{ asset.styleRules.slice(0, 3).join('、') }}</template>
                </span>
              </n-checkbox>
            </n-checkbox-group>
          </n-scrollbar>
        </div>

        <template #footer>
          <div class="ai-novel-footer">
            <n-button @click="aiNovelPickerVisible = false">取消</n-button>
            <n-button
              type="primary"
              :loading="aiNovelLoading"
              :disabled="!aiNovelSelectedIds.length"
              @click="handleAiNovelGenerate"
            >
              <template #icon><Wand2 :size="16" /></template>
              开始生成
            </n-button>
          </div>
        </template>
      </n-card>
    </n-modal>

    <!-- AI 生成作品：结果确认 -->
    <n-modal v-model:show="aiNovelResultsVisible">
      <n-card style="width: min(860px, 92vw)" :bordered="false" role="dialog" aria-modal="true">
        <template #header>
          <div class="detail-header">
            <strong>AI 生成的新作品方案</strong>
            <span>勾选要创建为项目的作品，将自动建为新项目</span>
          </div>
        </template>

        <n-scrollbar style="max-height: 52vh">
          <n-checkbox-group
            v-model:value="aiNovelSelectedSeedIds"
            class="ai-novel-result-group"
          >
            <n-checkbox
              v-for="(candidate, index) in aiNovelCandidates"
              :key="index"
              :value="String(index)"
              class="ai-novel-result-card"
            >
              <div class="ai-novel-result-head">
                <strong>{{ candidate.title }}</strong>
                <n-tag size="tiny" :bordered="false" type="info">{{ candidate.genre || '未分类' }}</n-tag>
                <n-tag v-if="candidate.sourceTitle" size="tiny" :bordered="false" type="warning">
                  源自《{{ candidate.sourceTitle }}》
                </n-tag>
              </div>
              <p class="ai-novel-result-concept">{{ candidate.concept }}</p>
              <p class="ai-novel-result-line"><b>钩子：</b>{{ candidate.hook }}</p>
              <p class="ai-novel-result-line"><b>主角：</b>{{ candidate.protagonist }}</p>
              <p class="ai-novel-result-line"><b>金手指：</b>{{ candidate.goldFinger }}</p>
              <div v-if="candidate.first3Hooks.length" class="ai-novel-result-hooks">
                <span class="ai-novel-result-hook" v-for="(hook, hi) in candidate.first3Hooks" :key="hi">
                  第{{ hi + 1 }}章：{{ hook }}
                </span>
              </div>
              <p class="ai-novel-result-outline"><b>主线：</b>{{ candidate.outline }}</p>
              <div class="ai-novel-result-actions">
                <n-button text size="tiny" @click.stop="copyAiNovelCandidate(candidate)">复制方案</n-button>
              </div>
            </n-checkbox>
          </n-checkbox-group>
        </n-scrollbar>

        <template #footer>
          <div class="ai-novel-footer">
            <n-button @click="aiNovelResultsVisible = false">关闭</n-button>
            <n-button
              type="primary"
              :disabled="!aiNovelHasSelectedSeed"
              @click="handleAiNovelCreateWorks"
            >
              创建选中作品（{{ aiNovelSelectedSeedCount }}）
            </n-button>
          </div>
        </template>
      </n-card>
    </n-modal>
  </section>
</template>

<style scoped>
.knowledge-screen {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

.knowledge-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.knowledge-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.knowledge-header-left strong {
  font-size: 16px;
  font-weight: 700;
  color: var(--arc-text-primary);
}

.knowledge-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.knowledge-header-btn {
  min-width: 168px;
  justify-content: center;
}

.knowledge-stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}

.knowledge-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.knowledge-toolbar-search {
  min-width: min(100%, 280px);
  flex: 1;
}

.knowledge-asset-stack {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12px;
}

.knowledge-asset-stack :deep(.n-card),
.knowledge-asset-stack :deep(.n-card__content),
.knowledge-asset-stack :deep(.n-card-header),
.knowledge-asset-stack :deep(.n-card-header__main),
.knowledge-asset-stack :deep(.n-card-header__extra) {
  min-width: 0;
}

.asset-header {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.asset-header strong {
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-header span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-summary {
  margin: 0 0 8px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.asset-metrics {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.asset-date {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.asset-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.asset-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.asset-docs-collapse {
  min-width: 0;
  border-top: 1px solid var(--arc-border);
  padding-top: 6px;
}

.asset-docs-collapse :deep(.n-collapse-item__header-main),
.asset-docs-collapse :deep(.n-collapse-item__content-inner),
.asset-docs-collapse :deep(.n-list),
.asset-docs-collapse :deep(.n-list-item),
.asset-docs-collapse :deep(.n-list-item__main) {
  min-width: 0;
}

.doc-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.doc-item-top {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.doc-item-top strong {
  flex: 1;
  min-width: 0;
  color: var(--arc-text-primary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-item-top-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.doc-item-delete {
  padding: 2px 4px;
}

.doc-item p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.doc-item span {
  color: var(--arc-text-hint);
  font-size: 11px;
  min-width: 0;
}

.knowledge-section-head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.knowledge-section-head strong {
  font-size: 15px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.skill-desc {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.detail-header {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.detail-header strong {
  color: var(--arc-text-primary);
  font-size: 16px;
  overflow-wrap: anywhere;
}

.detail-header span {
  color: var(--arc-text-secondary);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-content {
  margin: 0;
  padding: 14px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-novel-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ai-novel-mode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.ai-novel-field-label {
  color: var(--arc-text-secondary);
  font-size: 13px;
  flex-shrink: 0;
}

.ai-novel-genre-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-novel-genre-tag {
  cursor: pointer;
  transition: all 0.2s ease;
}

.ai-novel-select-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--arc-border);
}

.ai-novel-select-head strong {
  color: var(--arc-text-primary);
  font-size: 13px;
}

.ai-novel-ref-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}

.ai-novel-ref-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--arc-radius-md);
  transition: background 0.2s ease;
}

.ai-novel-ref-item:hover {
  background: color-mix(in srgb, var(--arc-primary) 6%, transparent);
}

.ai-novel-ref-item :deep(.n-checkbox__label) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ai-novel-ref-title {
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-novel-ref-meta {
  color: var(--arc-text-hint);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-novel-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.ai-novel-result-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0;
}

.ai-novel-result-card {
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-weak);
}

.ai-novel-result-card :deep(.n-checkbox__label) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  width: 100%;
}

.ai-novel-result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ai-novel-result-head strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

.ai-novel-result-concept {
  margin: 0;
  color: var(--arc-primary);
  font-size: 13px;
  font-weight: 600;
}

.ai-novel-result-line {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ai-novel-result-hooks {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-novel-result-hook {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.ai-novel-result-outline {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ai-novel-result-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .skill-grid {
    grid-template-columns: 1fr;
  }

  .doc-item-top {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
