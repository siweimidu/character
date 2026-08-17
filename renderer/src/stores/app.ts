import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { formatAutoSaveIntervalLabel, isLiveAutoSaveInterval } from '@/features/settings/autoSave'
import { createDefaultWorkflowDocuments } from '@/features/novelWorkflow/documents'
import { createDefaultNovelWorkflowStages } from '@/features/novelWorkflow/stages'
import { DEFAULT_CHAPTER_WORD_TARGET, normalizeChapterWordTarget } from '@/features/chapters/wordTarget'
import { formatProjectWordCount } from '@/features/projects/wordCount'
import { createProjectEditedAt } from '@/features/projects/lastEdited'
import {
  buildVolumeGroups,
  createOutlineVolume as createWorkspaceVolume,
  normalizeVolumeWordTarget
} from '@/features/workspace/outlineVolumes'
import {
  moveOutlineItemsAroundTarget,
  moveOutlineItemsToVolumeEnd as reorderOutlineItemsToVolumeEnd,
  type OutlineDropPosition
} from '@/features/workspace/outlineReorder'
import { getThemePreset } from '@/theme/presets'
import { toIpcPayload } from '@/utils/ipcPayload'
import { createEmptyWorkspace, normalizeGlobalAssistantProposal, mergeGlobalAssistantProposals, normalizeOutlineReferenceIds } from '@/features/workspace/projectWorkspace'
import { createWorkspacePersistence } from '@/features/workspace/persistence'
import {
  filterKnowledgeDocumentsForProject,
  isProjectKnowledgeSource,
  normalizeKnowledgeDocumentScope,
  replaceKnowledgeDocumentsBySource
} from '@/features/knowledge/knowledgeCenter'
import {
  buildStarterChapter,
  buildWorkspaceMapFromLegacy,
  defaultProjects,
  loadStoredState,
  normalizeAiRuns,
  normalizeAppSettings,
  normalizeChapterAssistantTemplates,
  normalizeProjectSummary,
  normalizeChapterDraft,
  normalizeChapterVersion,
  normalizeProjectWorkspaceData,
  getChapterSequenceInVolume,
  getOutlineSequenceInVolume,
  getWorkspacePrimaryVolumeId,
  insertIntoVolumeSection,
  toSerializable,
  type LegacyStoredState,
  type StoredState
} from '@/features/workspace/storeHelpers'
import {
  AI_TASK_RETENTION_MS,
  applyExternalAiTaskEvent,
  type AiTaskRun,
  type AiTaskRunInput
} from '@/features/ai/taskRegistry'
import type {
  AssistantEditEvent,
  AssistantToolCall,
  AssistantTurn,
  AppSettings,
  ChapterDraft,
  ChapterInsertionMode,
  ChapterInsertionRequest,
  ChapterSelectionState,
  ChapterVersion,
  ChatMessage,
  CharacterCard,
  CharacterRelationship,
  InspirationEntry,
  ImportConflictMode,
  ImportExportModuleType,
  KnowledgeDocument,
  AiRunRecord,
  GlobalAssistantProposal,
  GlobalAssistantSession,
  NovelLength,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  OutlineImportApplyResult,
  OutlineImportNewVolume,
  OutlineImportPlanEntry,
  OutlineImportVolumeUpdate,
  OutlineVolume,
  PanelName,
  PlotThread,
  PromptCategory,
  PromptEntry,
  PlotThreadStatus,
  ProjectImportPayload,
  ProjectSummary,
  ProjectWorkspaceData,
  ReferenceWorkItem,
  ThemeName,
  WorldviewEntry
} from '@/types/app'

type AssistantFocusPanel = 'world' | 'characters' | 'outline' | 'project-knowledge'

interface AssistantFocusTarget {
  panel: AssistantFocusPanel
  entityId: string
  nonce: number
}

/** 创建项目向导的载荷结构，包含项目基础信息和可选的各类业务数据 */
interface ProjectWorkspacePayload {
  project: {
    title: string
    premise?: string
    genre: string
    novelLength: NovelLength
    wordCount?: string
    cover?: string
    writingStylePresetId?: string
    writingStylePrompt?: string
    chapterAssistantTemplates?: ProjectSummary['chapterAssistantTemplates']
    novelWorkflowStages?: ProjectSummary['novelWorkflowStages']
    projectSkills?: ProjectSummary['projectSkills']
    targetPlatform?: string
    selectedReferenceWorkIds?: ProjectSummary['selectedReferenceWorkIds']
    coverHistory?: ProjectSummary['coverHistory']
  }
  worldviewEntries?: WorldviewEntry[]
  characters?: CharacterCard[]
  organizations?: OrganizationEntry[]
  characterRelationships?: CharacterRelationship[]
  organizationMemberships?: OrganizationMembership[]
  inspirationEntries?: InspirationEntry[]
  promptCategories?: PromptCategory[]
  promptEntries?: PromptEntry[]
  outlineVolumes?: OutlineVolume[]
  outlineItems?: OutlineItem[]
  chapters?: ChapterDraft[]
  chapterVersions?: ChapterVersion[]
  plotThreads?: PlotThread[]
  messages?: ChatMessage[]
}

/** 携带初始数据进入新建作品向导的预填内容（供番茄风向标等入口使用） */
export interface WizardPrefill {
  title: string
  genre?: string
  novelLength?: NovelLength
  premise?: string
  /** 预置的初始化方式：'deep' 深度生成 / 'quick' 快速生成 / 'off' 空白项目 */
  generationMode?: 'deep' | 'quick' | 'off'
}

/** 将日期字符串转换为 ISO 时间戳，无效值时使用当前时间 */
function toIsoTimestamp(value?: string): string {
  const parsed = value ? new Date(value) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return new Date().toISOString()
}

let nextIdCounter = 0
/** 生成基于时间戳+自增序号的唯一 ID，保证同毫秒内也不重复 */
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++nextIdCounter}`
}

/** 把模型合并进已保存模型列表：去空、去重、最多保留 50 条 */
function mergeProfileModel(current: string[] | undefined, model: string): string[] {
  const trimmed = model?.trim()
  if (!trimmed) return current ?? []
  const next = Array.isArray(current) ? [...current] : []
  if (!next.includes(trimmed)) {
    next.push(trimmed)
  }
  return next.slice(0, 50)
}

function normalizeKnowledgeKeywords(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : []
}

/** 重新编排世界观条目的 sortOrder，确保连续递增 */
function reindexWorldviewEntries(entries: WorldviewEntry[]): WorldviewEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index
  }))
}

/** 重新编排大纲节点的 sortOrder */
function reindexOutlineItems(items: OutlineItem[]): OutlineItem[] {
  return items.map((item, index) => ({
    ...item,
    sortOrder: index
  }))
}

/** 重新编排灵感条目的 sortOrder */
function reindexInspirationEntries(entries: InspirationEntry[]): InspirationEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index
  }))
}

/** 重新编排提示词条目的 sortOrder */
function reindexPromptEntries(entries: PromptEntry[]): PromptEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index
  }))
}

/** 规范化提示词分类数据（用于导入） */
function normalizePromptCategoriesData(categories: PromptCategory[]): PromptCategory[] {
  const now = new Date().toISOString()
  return categories.map((cat, index) => ({
    ...cat,
    id: cat.id || uniqueId('prompt-cat'),
    name: cat.name?.trim() || '未命名分类',
    sortOrder: index,
    isBuiltin: Boolean(cat.isBuiltin),
    createdAt: cat.createdAt || now,
    updatedAt: cat.updatedAt || now
  }))
}

/** 规范化提示词条目数据（用于导入） */
function normalizePromptEntriesData(entries: PromptEntry[]): PromptEntry[] {
  const now = new Date().toISOString()
  return entries.map((entry, index) => ({
    ...entry,
    id: entry.id || uniqueId('prompt'),
    categoryId: entry.categoryId || '',
    title: entry.title?.trim() || '未命名提示词',
    content: entry.content || '',
    tags: Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    remark: entry.remark || '',
    isFavorite: Boolean(entry.isFavorite),
    isPinned: Boolean(entry.isPinned),
    usageCount: Number.isFinite(entry.usageCount) ? Math.max(0, Math.floor(entry.usageCount)) : 0,
    isBuiltin: Boolean(entry.isBuiltin),
    sortOrder: index,
    createdAt: entry.createdAt || now,
    updatedAt: entry.updatedAt || now
  }))
}

/** 重新编排组织的 sortOrder */
function reindexOrganizations(entries: OrganizationEntry[]): OrganizationEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index
  }))
}

/** 按分卷顺序重排带 volumeId 的条目，保留同卷内原始顺序 */
function sortByVolumeOrder<T extends { volumeId: string }>(items: T[], volumeIds: string[]): T[] {
  const volumeOrder = new Map(volumeIds.map((volumeId, index) => [volumeId, index]))
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftOrder = volumeOrder.get(left.item.volumeId) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = volumeOrder.get(right.item.volumeId) ?? Number.MAX_SAFE_INTEGER
      return leftOrder === rightOrder ? left.index - right.index : leftOrder - rightOrder
    })
    .map(({ item }) => item)
}


// ══════════════════════════════════════════════════════════════════
// 全局 Pinia Store：管理整个应用的状态
// 包含项目列表、当前工作区、所有业务实体、视图导航、持久化调度
// ══════════════════════════════════════════════════════════════════
export const useAppStore = defineStore('app', () => {
  const stored = loadStoredState()
  /** 是否已完成初始化水合（从 SQLite 加载数据） */
  const hasHydrated = ref(false)
  /** 窗口是否可见（未最小化/未遮挡）。隐藏时用于暂停非必要后台任务，降低 CPU/内存占用。 */
  const windowVisible = ref(true)
  /** 当前视图：项目列表 / 新建向导 / 工作台 / 章节写作 / 独立能力页 */
  const currentView = ref<'projects' | 'wizard' | 'continuation-import' | 'workbench' | 'chapter-studio' | 'deconstruction-library' | 'skills' | 'cover-workbench' | 'fanqie-trends' | 'recycle-bin' | 'global-agent'>('projects')
  /** 视图导航历史栈，用于“返回”按钮回到上一个页面（标题栏最左侧的返回主页按钮除外） */
  const navHistory = ref<Array<'projects' | 'wizard' | 'continuation-import' | 'workbench' | 'chapter-studio' | 'deconstruction-library' | 'skills' | 'cover-workbench' | 'fanqie-trends' | 'recycle-bin' | 'global-agent'>>([])
  /** 从番茄风向标等入口携带初始数据进入新建向导时的预填内容 */
  const wizardPrefill = ref<WizardPrefill | null>(null)
  /** 工作台中当前激活的面板 */
  const activePanel = ref<PanelName>('outline')
  /** 上一次在工作台中查看的面板（非 chapters），用于从章节写作返回时恢复 */
  const lastWorkbenchPanel = ref<Exclude<PanelName, 'chapters'>>('outline')
  /** 当前主题名称 */
  const theme = ref<ThemeName>(stored.theme)
  /** 当前选中的项目 ID */
  const selectedProjectId = ref(stored.selectedProjectId)
  /** 所有项目摘要列表 */
  const projects = ref<ProjectSummary[]>(stored.projects)
  /** 首页“我的作品”当前选中的排序方式 */
  const projectSortMode = ref<string>(stored.projectSortMode ?? 'created')
  /** 首页“我的作品”各排序维度的升/降方向 */
  const projectSortDirections = ref<Record<string, 'asc' | 'desc'>>({ ...(stored.projectSortDirections ?? {}) })
  /** 项目 ID → 工作区数据 的映射表 */
  const projectWorkspaces = ref<Record<string, ProjectWorkspaceData>>(stored.workspaces)
  /** 应用级 AI 调用历史；projectId 仅作为可选关联信息。 */
  const globalAiRuns = ref<AiRunRecord[]>(normalizeAiRuns(stored.aiRuns))
  /** 应用全局设置（AI 供应商、模型、自动保存等） */
  const appSettings = ref<AppSettings>(stored.appSettings)
  const coverWorkbenchHistory = ref<import('@/types/app').CoverWorkbenchHistoryItem[]>(stored.coverWorkbenchHistory ?? [])

  /** 待执行的章节正文插入请求 */
  const pendingChapterInsertion = ref<ChapterInsertionRequest | null>(null)
  /** 用户在编辑器中当前选中的文本状态 */
  const currentChapterSelection = ref<ChapterSelectionState | null>(null)
  /** 章节轻检告警：key 为 chapterId，value 为告警 payload。由章节生成后的异步后处理流水线推送。 */
  const chapterStateWarnings = ref<Map<string, CharacterArcChapterStateWarningsPayload>>(new Map())
  /** 章节生成后处理问题：key 为 chapterId，value 为问题 payload。issues 为空时会自动清理旧提示。 */
  const chapterPostGenerationIssues = ref<Map<string, CharacterArcChapterPostGenerationIssuesPayload>>(new Map())
  /** 当前选中的章节 ID */
  const selectedChapterId = ref(stored.workspaces[stored.selectedProjectId]?.chapters[0]?.id ?? '')
  /** 流程面板当前激活的分卷 ID，空字符串时回退到第一个分卷 */
  const activeWorkflowVolumeId = ref<string>('')
  /** 全局助手最近一次写回后的聚焦目标，仅用于当前界面反馈 */
  const assistantFocusTarget = ref<AssistantFocusTarget | null>(null)
  /** 伏笔线索面板聚焦目标：由灵感卡片等触发跳转到指定伏笔 */
  const threadFocusTarget = ref<{ threadId: string; nonce: number } | null>(null)

  const {
    scheduledPersistAt,
    isPersisting,
    persistenceError,
    scheduleWorkspaceSync,
    flushWorkspaceSync,
    persistWorkspace,
    persistAppSettings,
    schedulePersist,
    scheduleSettingsPersist,
    handleRemoteWorkspaceSync
  } = createWorkspacePersistence({
    hasHydrated,
    serializeWorkspaceState: () => serializeWorkspaceState(),
    getSettingsSnapshot: () => ({
      theme: theme.value,
      selectedProjectId: selectedProjectId.value,
      appSettings: appSettings.value
    }),
    applyRemoteState: (payload) => applyWorkspaceState(payload)
  })

  // ── 计算属性：从当前工作区派生各业务实体列表 ──
  /** 当前项目的工作区数据，项目不存在时返回空工作区 */
  const currentWorkspace = computed(
    () => projectWorkspaces.value[selectedProjectId.value] ?? createEmptyWorkspace()
  )
  /** 当前项目的世界观设定列表 */
  const worldviewEntries = computed(() => currentWorkspace.value.worldviewEntries)
  /** 当前项目的角色列表 */
  const characters = computed(() => currentWorkspace.value.characters)
  /** 当前项目的组织列表 */
  const organizations = computed(() => currentWorkspace.value.organizations)
  /** 当前项目的角色关系列表 */
  const characterRelationships = computed(() => currentWorkspace.value.characterRelationships)
  /** 当前项目的组织成员归属列表 */
  const organizationMemberships = computed(() => currentWorkspace.value.organizationMemberships)
  /** 当前项目的灵感卡片列表 */
  const inspirationEntries = computed(() => currentWorkspace.value.inspirationEntries)
  /** 当前项目的灵感自定义生成类型列表 */
  const inspirationTypes = computed(() => currentWorkspace.value.inspirationTypes ?? [])
  /** 当前项目的提示词分类列表 */
  const promptCategories = computed(() => currentWorkspace.value.promptCategories ?? [])
  /** 当前项目的提示词条目列表 */
  const promptEntries = computed(() => currentWorkspace.value.promptEntries ?? [])
  /** 当前项目的大纲节点列表 */
  const outlineItems = computed(() => currentWorkspace.value.outlineItems)
  /** 当前项目的章节列表 */
  const chapters = computed(() => currentWorkspace.value.chapters)
  /** 当前项目的大纲分卷列表 */
  const outlineVolumes = computed(() => currentWorkspace.value.outlineVolumes)
  /** 当前项目的章节历史版本列表 */
  const chapterVersions = computed(() => currentWorkspace.value.chapterVersions)
  /** 当前项目的 AI 聊天消息列表 */
  const globalAssistantSessions = computed(() => currentWorkspace.value.globalAssistantSessions)
  const activeGlobalAssistantSessionId = computed(() => currentWorkspace.value.activeGlobalAssistantSessionId)
  const activeGlobalAssistantSession = computed(
    () => globalAssistantSessions.value.find((session) => session.id === activeGlobalAssistantSessionId.value)
      ?? globalAssistantSessions.value[0]
  )
  const messages = computed(() => activeGlobalAssistantSession.value?.messages ?? currentWorkspace.value.messages)
  /** 当前项目的伏笔线索列表 */
  const plotThreads = computed(() => currentWorkspace.value.plotThreads)
  /** 持久化全部知识文档；项目知识按 projectId 隔离，参考资料保持全局。 */
  const allKnowledgeDocuments = ref<KnowledgeDocument[]>(
    (stored.knowledgeDocuments ?? []).map((document) =>
      normalizeKnowledgeDocumentScope(document)
    )
  )
  /** 当前项目可见的知识文档，以及所有项目共享的参考资料。 */
  const knowledgeDocuments = computed(() =>
    filterKnowledgeDocumentsForProject(allKnowledgeDocuments.value, selectedProjectId.value)
  )
  const projectConstraints = computed(() =>
    knowledgeDocuments.value
      .filter((document) => document.sourceType === 'canon-fact' && document.sourceLabel === 'global-constraint')
      .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''))
  )
  /** 全局拆书库参考作品（跨项目共享） */
  const referenceWorks = ref<ReferenceWorkItem[]>(stored.referenceWorks ?? [])
  /** 全局回收站：存放 AI 接口配置、参考作品等全局数据的删除快照 */
  const globalRecycleBin = ref<import('@/types/app').RecycleBinEntry[]>(stored.globalRecycleBin ?? [])
  /** 当前项目的回收站条目（项目级删除内容） */
  const projectRecycleBin = computed(() => currentWorkspace.value.recycleBin)
  /** 回收站当前查看范围：'global' 显示全局回收站，'all' 显示当前项目 + 全局，其余为指定项目 ID */
  const recycleBinScope = ref<string>('all')
  /** 进入回收站前的来源视图，用于回收站“返回”按钮回到上一个页面（如从主页进入则回主页，从工作台进入则回工作台） */
  const recycleBinReturnView = ref(currentView.value)
  /** 指定项目 ID 的回收站条目 */
  const projectRecycleBinOf = (projectId: string) =>
    (projectWorkspaces.value[projectId] ?? createEmptyWorkspace()).recycleBin ?? []
  /** 全局回收站条目（AI 接口、参考作品等跨项目共享数据的删除快照） */
  const globalRecycleBinEntries = computed(() => globalRecycleBin.value)
  /** 当前回收站视图下展示的条目，按删除时间倒序。
   *  - 'global'：全局回收站，展示所有项目的删除内容 + 全局数据删除快照（含 AI 接口、项目 Skills、参考作品）
   *  - 项目 ID：该项目回收站，仅展示该项目删除内容（不显示 AI 接口、项目 Skills、参考作品等全局数据）
   */
  const recycleBinEntries = computed<import('@/types/app').RecycleBinEntry[]>(() => {
    const scope = recycleBinScope.value
    const isGlobalScope = scope === 'global'
    let projectEntries =
      scope === 'global' || scope === 'all'
        ? Object.values(projectWorkspaces.value).flatMap((workspace) => workspace.recycleBin ?? [])
        : projectRecycleBinOf(String(scope))
    // 全局类数据（AI 接口配置、项目 Skills、参考作品等）仅在全局回收站展示；项目回收站不显示
    if (!isGlobalScope) {
      projectEntries = projectEntries.filter((entry) => !GLOBAL_RECYCLE_CATEGORIES.has(entry.category))
    }
    const globalEntries = isGlobalScope
      ? globalRecycleBin.value
      : globalRecycleBin.value.filter((entry) => !GLOBAL_RECYCLE_CATEGORIES.has(entry.category))
    return [...projectEntries, ...globalEntries].sort((a, b) =>
      (b.deletedAt || '').localeCompare(a.deletedAt || '')
    )
  })
  /** 汇总全部回收站条目（项目级 + 全局），供全局入口/角标统计使用 */
  const allRecycleBinEntries = computed<import('@/types/app').RecycleBinEntry[]>(() =>
    [
      ...Object.values(projectWorkspaces.value).flatMap((workspace) => workspace.recycleBin ?? []),
      ...globalRecycleBin.value
    ].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''))
  )
  /** 当前查看范围的人类可读标题 */
  const recycleBinScopeLabel = computed<string>(() => {
    const scope = recycleBinScope.value
    if (scope === 'global') return '全局回收站'
    if (scope === 'all') return '回收站'
    const project = projects.value.find((item) => item.id === scope)
    return project ? `${project.title} · 回收站` : '回收站'
  })
  /** 回收站配置：内容保留天数，默认 5 天 */
  const recycleBinRetentionDays = computed<number>(() => {
    const configured = appSettings.value.recycleBinSettings?.retentionDays
    return Number.isFinite(configured) && (configured as number) > 0 ? (configured as number) : 5
  })
  /** 当前项目关联的 AI 运行记录列表 */
  const aiRuns = computed(() => globalAiRuns.value.filter((run) => run.projectId === selectedProjectId.value))
  /**
   * 应用级全部 AI 运行记录，按开始时间降序；不要求记录属于某个项目。
   */
  const allAiRuns = computed(() =>
    [...globalAiRuns.value].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  )
  /**
   * 全局 AI 任务注册表（按 key 去重，响应式）。
   *
   * 用途：
   *   1. 跨面板保持按钮 loading 状态——切面板不会把 "生成中..." 切没。
   *   2. 给全局进度面板提供数据源，让用户知道 AI 正在跑什么、跑了多久。
   *   3. 天然防重复点击：同 key 任务已在运行时再次点击会被拒绝。
   */
  const aiTaskRuns = ref<Map<string, AiTaskRun>>(new Map())
  /** 流程面板当前激活的分卷（回退到第一个分卷） */
  const activeWorkflowVolume = computed(
    () => outlineVolumes.value.find((v) => v.id === activeWorkflowVolumeId.value) ?? outlineVolumes.value[0]
  )
  /** 当前激活分卷的创作记忆（每卷独立维护） */
  const workflowDocuments = computed(
    () => activeWorkflowVolume.value?.workflowDocuments ?? createDefaultWorkflowDocuments()
  )
  /** 自动保存间隔的人类可读标签 */
  const autoSaveIntervalLabel = computed(() => formatAutoSaveIntervalLabel(appSettings.value.autoSaveInterval))
  /** 是否为实时自动保存模式 */
  const isLiveAutoSave = computed(() => isLiveAutoSaveInterval(appSettings.value.autoSaveInterval))
  /** 是否有待持久化的更改 */
  const isPersistencePending = computed(() => scheduledPersistAt.value !== null || isPersisting.value)
  /** 当前选中的章节对象 */
  const selectedChapter = computed(
    () => chapters.value.find((chapter) => chapter.id === selectedChapterId.value) ?? chapters.value[0]
  )
  /** 当前选中章节所属的分卷 */
  const selectedChapterVolume = computed(
    () => outlineVolumes.value.find((volume) => volume.id === selectedChapter.value?.volumeId) ?? outlineVolumes.value[0]
  )
  /** 按分卷分组的大纲节点 */
  const outlineVolumeGroups = computed(() => buildVolumeGroups(outlineVolumes.value, outlineItems.value))
  /** 按分卷分组的章节 */
  const chapterVolumeGroups = computed(() => buildVolumeGroups(outlineVolumes.value, chapters.value))
  /** 当前主题的 Naive UI 覆盖配置 */
  const currentTheme = computed(() => getThemePreset(theme.value))
  /** 当前选中的项目摘要 */
  const currentProject = computed(
    () => projects.value.find((project) => project.id === selectedProjectId.value) ?? projects.value[0]
  )

  // ── AI 事件处理 ──

  function handleAiRunEvent(payload: CharacterArcAiRunEventPayload): void {
    if (!payload?.meta) {
      return
    }

    // AI 历史是应用级数据；projectId 为空也必须记录，不能回退并误绑当前项目。
    const runProjectId = payload.projectId || ''
    appendAiRun(runProjectId, payload.meta)

    // agent loop 通过 knowledge_save_document 工具落库的文档：随 ai-run-event 一起回灌
    const produced = (payload.meta as { producedKnowledgeDocuments?: Array<Partial<KnowledgeDocument>> }).producedKnowledgeDocuments
    if (Array.isArray(produced) && produced.length > 0) {
      const now = new Date().toISOString()
      const documents = produced
        .filter((draft): draft is Partial<KnowledgeDocument> & { title: string; sourceType: KnowledgeDocument['sourceType']; content: string } =>
          Boolean(draft && typeof draft.title === 'string' && draft.title.trim() && typeof draft.content === 'string' && draft.content.trim() && typeof draft.sourceType === 'string')
        )
        .map<KnowledgeDocument>((draft) => ({
          id: String(draft.id ?? '').trim() || uniqueId('knowledge'),
          projectId: String(draft.projectId ?? '').trim() || runProjectId,
          title: String(draft.title).trim(),
          sourceType: draft.sourceType,
          sourceLabel: String(draft.sourceLabel ?? '').trim(),
          content: String(draft.content),
          summary: String(draft.summary ?? '').trim() || String(draft.content).slice(0, 220),
          keywords: normalizeKnowledgeKeywords(draft.keywords),
          metadata: draft.metadata && typeof draft.metadata === 'object' ? draft.metadata as Record<string, unknown> : {},
          createdAt: String(draft.createdAt ?? '').trim() || now,
          updatedAt: String(draft.updatedAt ?? '').trim() || now
        }))
      if (documents.length > 0) {
        mergeKnowledgeDocuments(documents)
      }
    }

    // global-assistant agent loop 通过 propose_* 工具产生的结构化写回提案：合并进当前会话的 proposal，
    // 复用既有的 Diff 审阅弹窗与写回逻辑，用户确认后才真正写入图鉴/设定。
    const settingMeta = payload.meta as {
      task?: string
      producedSettingProposal?: Partial<GlobalAssistantProposal> | null
    }
    if (settingMeta.task === 'global-assistant' && settingMeta.producedSettingProposal) {
      const incoming = normalizeGlobalAssistantProposal(settingMeta.producedSettingProposal as GlobalAssistantProposal)
      const merged = mergeGlobalAssistantProposals(activeGlobalAssistantSession.value?.proposal ?? null, incoming)
      if (merged) {
        updateAssistantSessionProposal({ proposal: merged })
      }
    }
  }

  function handleChapterStateWarnings(payload: CharacterArcChapterStateWarningsPayload): void {
    if (!payload?.chapterId || !Array.isArray(payload.violations) || !payload.violations.length) {
      return
    }
    const next = new Map(chapterStateWarnings.value)
    next.set(payload.chapterId, payload)
    chapterStateWarnings.value = next
  }

  function getChapterStateWarnings(chapterId: string): CharacterArcChapterStateWarningsPayload | null {
    if (!chapterId) return null
    return chapterStateWarnings.value.get(chapterId) ?? null
  }

  function dismissChapterStateWarnings(chapterId: string): void {
    if (!chapterId || !chapterStateWarnings.value.has(chapterId)) return
    const next = new Map(chapterStateWarnings.value)
    next.delete(chapterId)
    chapterStateWarnings.value = next
  }

  function handleChapterPostGenerationIssues(payload: CharacterArcChapterPostGenerationIssuesPayload): void {
    if (!payload?.chapterId || !Array.isArray(payload.issues)) {
      return
    }
    const next = new Map(chapterPostGenerationIssues.value)
    if (payload.issues.length === 0) {
      next.delete(payload.chapterId)
    } else {
      next.set(payload.chapterId, payload)
    }
    chapterPostGenerationIssues.value = next
  }

  function handleChapterPostGenerationTask(payload: CharacterArcChapterPostGenerationTaskPayload): void {
    if (!payload?.taskKey || !payload.runId) return
    const next = applyExternalAiTaskEvent(aiTaskRuns.value, {
      taskKey: payload.taskKey,
      runId: payload.runId,
      stage: payload.stage,
      label: '章节分析与索引',
      description: `正在处理《${payload.chapterTitle}》的状态与检索索引`,
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt,
      error: payload.error
    })
    if (next === aiTaskRuns.value) return
    aiTaskRuns.value = next

    if (payload.stage === 'running' || payload.stage === 'error') return
    const terminalStartedAt = payload.startedAt
    window.setTimeout(() => {
      const current = aiTaskRuns.value.get(payload.taskKey)
      if (
        current?.runId === payload.runId
        && current.startedAt === terminalStartedAt
        && current.stage !== 'running'
      ) {
        replaceTaskRuns((runs) => runs.delete(payload.taskKey))
      }
    }, AI_TASK_RETENTION_MS)
  }

  function backfillTaskKey(projectId: string): string {
    return `chapter-state-backfill:${projectId}`
  }

  function resolveBackfillProgress(payload: CharacterArcBackfillStateProgressPayload): number {
    if (payload.status === 'completed') return 100
    if (payload.total <= 0) return payload.phase === 'starting' ? 5 : 10
    const phaseRatio = payload.phase === 'applying' ? 0.85 : payload.phase === 'extracting' ? 0.35 : 0.1
    return Math.min(99, Math.max(1, Math.round(((Math.max(0, payload.current - 1) + phaseRatio) / payload.total) * 100)))
  }

  function describeBackfillTask(payload: CharacterArcBackfillStateProgressPayload): string {
    if (payload.status === 'completed') {
      const result = payload.result
      if (!result?.totalChapters) return '故事状态已是最新，无需重复同步'
      if (result.failed > 0) return `已处理 ${result.processedChapters} 章，${result.failed} 章失败`
      return `已完成 ${result.processedChapters} 章故事状态同步`
    }
    if (payload.status === 'failed') return payload.error || '故事状态同步失败'
    const position = payload.total > 0 ? `${Math.min(payload.current, payload.total)}/${payload.total}` : '准备中'
    const chapter = payload.chapterTitle ? `《${payload.chapterTitle}》` : ''
    return [position, chapter, payload.message].filter(Boolean).join(' · ')
  }

  function handleBackfillStateProgress(payload: CharacterArcBackfillStateProgressPayload): void {
    if (!payload?.projectId || !payload.taskId) return
    const key = backfillTaskKey(payload.projectId)
    const existing = aiTaskRuns.value.get(key)
    const isRunning = payload.status === 'running' || payload.status === 'pausing' || payload.status === 'paused'
    if (existing?.runId && existing.runId !== payload.taskId && !isRunning) return

    const startedAt = Date.parse(payload.startedAt) || existing?.startedAt || Date.now()
    replaceTaskRuns((next) => {
      next.set(key, {
        key,
        kind: 'chapter-post-process',
        label: '同步定稿章节故事状态',
        description: describeBackfillTask(payload),
        panel: 'project-knowledge',
        startedAt,
        finishedAt: isRunning ? undefined : Date.now(),
        stage: isRunning ? 'running' : payload.status === 'completed' ? 'done' : 'error',
        error: payload.status === 'failed' ? payload.error : undefined,
        progress: resolveBackfillProgress(payload),
        runId: payload.taskId
      })
    })

    if (isRunning || payload.status === 'failed') return
    window.setTimeout(() => {
      const current = aiTaskRuns.value.get(key)
      if (current?.runId === payload.taskId && current.stage !== 'running') {
        replaceTaskRuns((next) => next.delete(key))
      }
    }, AI_TASK_RETENTION_MS)
  }

  async function startChapterStateSync(chapterIds: string[]): Promise<void> {
    const projectId = selectedProjectId.value
    const ids = [...new Set(chapterIds.map(String).filter(Boolean))]
    if (!projectId || ids.length === 0) return

    const key = backfillTaskKey(projectId)
    if (isAiTaskRunning(key)) {
      throw new Error('该项目已有故事状态同步任务正在进行。')
    }
    registerManualTask({
      key,
      kind: 'chapter-post-process',
      label: '同步定稿章节故事状态',
      description: `正在准备 ${ids.length} 章的后台同步队列`,
      panel: 'project-knowledge'
    })

    try {
      const response = await window.characterArc.backfillProjectState(toIpcPayload({
        settings: appSettings.value,
        projectId,
        selection: { mode: 'custom', chapterIds: ids }
      }))
      if (!response.success || !response.result?.taskId) {
        throw new Error(response.error ?? '未能创建故事状态同步任务')
      }
      handleBackfillStateProgress(response.result)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      finalizeManualTask(key, 'error', detail)
      throw error
    }
  }

  function getChapterPostGenerationIssues(chapterId: string): CharacterArcChapterPostGenerationIssuesPayload | null {
    if (!chapterId) return null
    return chapterPostGenerationIssues.value.get(chapterId) ?? null
  }

  function dismissChapterPostGenerationIssues(chapterId: string): void {
    if (!chapterId || !chapterPostGenerationIssues.value.has(chapterId)) return
    const next = new Map(chapterPostGenerationIssues.value)
    next.delete(chapterId)
    chapterPostGenerationIssues.value = next
  }

  /**
   * 批量清理已删除章节遗留的运行时状态（轻检告警与后处理问题）。
   * 章节删除后这些 Map 中的条目不再有 UI 消费方，若不清理会形成内存残留。
   * @param chapterIds - 被删除的章节 ID 集合
   */
  function clearChapterRuntimeState(chapterIds: Iterable<string>): void {
    const ids = new Set(chapterIds)
    if (!ids.size) return

    if ([...ids].some((id) => chapterStateWarnings.value.has(id))) {
      const next = new Map(chapterStateWarnings.value)
      for (const id of ids) next.delete(id)
      chapterStateWarnings.value = next
    }
    if ([...ids].some((id) => chapterPostGenerationIssues.value.has(id))) {
      const next = new Map(chapterPostGenerationIssues.value)
      for (const id of ids) next.delete(id)
      chapterPostGenerationIssues.value = next
    }
  }

  /** 同步选中章节 ID：确保当前选中的章节仍属于指定项目，否则回退到第一章 */
  function syncSelectedChapter(projectId = selectedProjectId.value): void {
    const chapterList = projectWorkspaces.value[projectId]?.chapters ?? []
    const hasCurrentChapter = chapterList.some((chapter) => chapter.id === selectedChapterId.value)
    selectedChapterId.value = hasCurrentChapter ? selectedChapterId.value : (chapterList[0]?.id ?? '')
  }

  /** 确保指定项目的工作区数据存在，不存在时创建空工作区 */
  function ensureProjectWorkspace(projectId: string): void {
    if (projectWorkspaces.value[projectId]) {
      return
    }

    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData(undefined)
    }
  }

  /** 切换当前选中的项目（仅改变上下文，不跳转视图）。供全局智能体在项目树中切换。 */
  function selectProject(projectId: string): void {
    const target = projects.value.find((item) => item.id === projectId)
    if (!target) return
    ensureProjectWorkspace(projectId)
    selectedProjectId.value = projectId
    pendingChapterInsertion.value = null
    syncSelectedChapter(projectId)
  }

  /** 用 updater 函数更新指定项目的工作区数据，自动标准化 */
  function updateProjectWorkspace(projectId: string, updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData): void {
    const baseWorkspace = normalizeProjectWorkspaceData(projectWorkspaces.value[projectId])
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData(updater(baseWorkspace))
    }
  }

  function updateCurrentWorkspaceAssistantSession(
    updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData
  ): void {
    const projectId = selectedProjectId.value
    ensureProjectWorkspace(projectId)
    const baseWorkspace = projectWorkspaces.value[projectId] ?? normalizeProjectWorkspaceData(undefined)
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: updater(baseWorkspace)
    }
  }

  /** 用 updater 函数更新当前项目的工作区数据，并同步章节选择和工作区同步 */
  function updateCurrentWorkspace(
    updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData,
    options: { syncWorkspace?: boolean } = {}
  ): void {
    ensureProjectWorkspace(selectedProjectId.value)
    updateProjectWorkspace(selectedProjectId.value, updater)
    syncProjectWordCount(selectedProjectId.value)
    touchProjectEditedAt(selectedProjectId.value)
    syncSelectedChapter()
    if (options.syncWorkspace !== false) {
      scheduleWorkspaceSync()
    }
  }

  /** 刷新指定项目的最近编辑时间（用于工作区内容编辑时同步首页展示） */
  function touchProjectEditedAt(projectId: string): void {
    if (!projectId || !projects.value.some((project) => project.id === projectId)) {
      return
    }
    const nextEditedAt = createProjectEditedAt()
    projects.value = projects.value.map((project) =>
      project.id === projectId ? { ...project, lastEdited: nextEditedAt } : project
    )
  }

  function syncProjectWordCount(projectId: string): void {
    const workspace = projectWorkspaces.value[projectId]
    if (!workspace) {
      return
    }

    const nextWordCount = formatProjectWordCount(workspace.chapters)
    projects.value = projects.value.map((project) =>
      project.id === projectId
        ? {
            ...project,
            wordCount: nextWordCount
          }
        : project
    )
  }

  /** 从持久化载荷恢复全局状态（主题、项目列表、工作区、设置），兼容旧版格式 */
  function applyWorkspaceState(payload?: Partial<StoredState> | LegacyStoredState | null): void {
    if (!payload) {
      return
    }

    theme.value = payload.theme ?? 'doubao'
    projects.value = Array.isArray(payload.projects)
      ? payload.projects.map(normalizeProjectSummary)
      : defaultProjects

    const fallbackProjectId = projects.value[0]?.id ?? ''
    selectedProjectId.value = payload.selectedProjectId ?? fallbackProjectId
    projectWorkspaces.value =
      'workspaces' in payload && payload.workspaces
        ? Object.fromEntries(
            Object.entries(payload.workspaces).map(([projectId, workspace]) => [
              projectId,
              normalizeProjectWorkspaceData(workspace)
            ])
          )
        : buildWorkspaceMapFromLegacy(payload as LegacyStoredState, selectedProjectId.value)

    for (const project of projects.value) {
      ensureProjectWorkspace(project.id)
    }

    appSettings.value = normalizeAppSettings(payload.appSettings)
    coverWorkbenchHistory.value = Array.isArray(payload.coverWorkbenchHistory) ? payload.coverWorkbenchHistory : []
    allKnowledgeDocuments.value = Array.isArray((payload as Partial<StoredState>).knowledgeDocuments)
      ? (payload as Partial<StoredState>).knowledgeDocuments!.map((document) =>
          normalizeKnowledgeDocumentScope(document)
        )
      : []
    referenceWorks.value = Array.isArray((payload as Partial<StoredState>).referenceWorks)
      ? (payload as Partial<StoredState>).referenceWorks!
      : []
    globalRecycleBin.value = Array.isArray((payload as Partial<StoredState>).globalRecycleBin)
      ? (payload as Partial<StoredState>).globalRecycleBin!
      : []
    projectSortMode.value = (payload as Partial<StoredState>).projectSortMode ?? 'created'
    projectSortDirections.value = {
      ...(projectSortDirections.value),
      ...((payload as Partial<StoredState>).projectSortDirections ?? {})
    }
    const workspaceAiRuns = Object.entries(projectWorkspaces.value).flatMap(([projectId, workspace]) =>
      (workspace.aiRuns ?? []).map((run) => ({ ...run, projectId: run.projectId || projectId }))
    )
    const payloadAiRuns = Array.isArray((payload as Partial<StoredState>).aiRuns)
      ? (payload as Partial<StoredState>).aiRuns!
      : []
    globalAiRuns.value = normalizeAiRuns(
      Array.from(new Map([...workspaceAiRuns, ...payloadAiRuns].map((run) => [run.id, run])).values())
    )
    projectWorkspaces.value = Object.fromEntries(
      Object.entries(projectWorkspaces.value).map(([projectId, workspace]) => [
        projectId,
        { ...workspace, aiRuns: [] }
      ])
    )
    syncSelectedChapter()
  }

  /** 将当前全局状态序列化为可持久化的 StoredState 对象 */
  function serializeWorkspaceState(): StoredState {
    return {
      theme: theme.value,
      selectedProjectId: selectedProjectId.value,
      projects: toSerializable(projects.value),
      workspaces: toSerializable(projectWorkspaces.value),
      knowledgeDocuments: toSerializable(allKnowledgeDocuments.value),
      referenceWorks: toSerializable(referenceWorks.value),
      aiRuns: toSerializable(globalAiRuns.value),
      appSettings: toSerializable(appSettings.value),
      coverWorkbenchHistory: toSerializable(coverWorkbenchHistory.value),
      globalRecycleBin: toSerializable(globalRecycleBin.value),
      projectSortMode: projectSortMode.value,
      projectSortDirections: projectSortDirections.value
    }
  }

  /**
   * Store 初始化入口：从 SQLite 加载工作区 → 标记水合完成。
   * 必须在 Vue 挂载前调用。
   */
  async function initialize(): Promise<void> {
    const result = await window.characterArc.loadWorkspace()
    if (result.success && result.payload) {
      applyWorkspaceState(result.payload as Partial<StoredState>)
      persistenceError.value = null
    } else {
      const err = result.error ?? null
      console.error('[workspace] loadWorkspace failed:', err)
      persistenceError.value = err
    }

    hasHydrated.value = true

    // 启动时清理已过期的回收站条目（到期自动删除）
    purgeExpiredRecycleBin()
  }

  // ── 项目导入 ──
  /** 为导入的实体生成带时间戳的唯一 ID，避免与现有数据冲突 */
  function buildImportedId(prefix: string, index: number): string {
    return `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
  }

  /** 导入完整项目数据：创建新项目、分配独立工作区、切换到工作台 */
  function importProjectData(payload: ProjectImportPayload): void {
    const projectId = uniqueId('project')
    const importedWorkspace = normalizeProjectWorkspaceData({
      worldviewEntries: payload.worldviewEntries,
      characters: payload.characters,
      organizations: payload.organizations,
      characterRelationships: payload.characterRelationships,
      organizationMemberships: payload.organizationMemberships,
      inspirationEntries: payload.inspirationEntries,
      promptCategories: payload.promptCategories,
      promptEntries: payload.promptEntries,
      outlineVolumes: payload.outlineVolumes,
      outlineItems: payload.outlineItems,
      chapters: payload.chapters,
      chapterVersions: payload.chapterVersions
    })
    const project: ProjectSummary = {
      id: projectId,
      title: payload.project?.title?.trim() || '导入项目',
      premise: payload.project?.premise?.trim() || '',
      genre: payload.project?.genre?.trim() || '未分类',
      novelLength: payload.project?.novelLength === 'short' ? 'short' : 'long',
      wordCount: formatProjectWordCount(importedWorkspace.chapters),
      lastEdited: createProjectEditedAt(),
      createdAt: payload.project?.createdAt || new Date().toISOString(),
      cover: payload.project?.cover || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)',
      writingStylePresetId: payload.project?.writingStylePresetId?.trim() || 'cinematic-cool',
      writingStylePrompt: payload.project?.writingStylePrompt?.trim() || '',
      chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project?.chapterAssistantTemplates),
      novelWorkflowStages: payload.project?.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
      projectSkills: payload.project?.projectSkills ?? [],
      targetPlatform: payload.project?.targetPlatform?.trim() || '',
      selectedReferenceWorkIds: payload.project?.selectedReferenceWorkIds ?? [],
      coverHistory: payload.project?.coverHistory ?? []
    }

    projects.value = [normalizeProjectSummary(project), ...projects.value]
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: importedWorkspace
    }
    selectedProjectId.value = project.id
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = 'outline'
    syncSelectedChapter(project.id)
    schedulePersist('fast')
  }

  /**
   * 按模块类型导入数据到当前项目工作区。
   * 支持 overwrite（覆盖）和 copy（追加）两种冲突模式。
   * relations 模块会自动匹配角色姓名，缺失时创建新角色。
   */
  function importModuleData(moduleType: ImportExportModuleType, payload: ProjectImportPayload, mode: ImportConflictMode): void {
    updateCurrentWorkspace((workspace) => {
      // Normalize once so every module import can reuse the same fallback and schema repair path.
      const normalizedImport = normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries,
        characters: payload.characters,
        organizations: payload.organizations,
        characterRelationships: payload.characterRelationships,
        organizationMemberships: payload.organizationMemberships,
        inspirationEntries: payload.inspirationEntries,
        promptCategories: payload.promptCategories,
        promptEntries: payload.promptEntries,
        outlineVolumes: payload.outlineVolumes,
        outlineItems: payload.outlineItems,
        chapters: payload.chapters,
        chapterVersions: payload.chapterVersions
      })

      if (moduleType === 'characters') {
        if (mode === 'overwrite') {
          return {
            ...workspace,
            characters: normalizedImport.characters
          }
        }

        return {
          ...workspace,
          characters: [
            ...normalizedImport.characters.map((character, index) => ({
              ...character,
              id: buildImportedId('character', index)
            })),
            ...workspace.characters
          ]
        }
      }

      if (moduleType === 'inspiration') {
        if (mode === 'overwrite') {
          return {
            ...workspace,
            inspirationEntries: reindexInspirationEntries(normalizedImport.inspirationEntries)
          }
        }

        return {
          ...workspace,
          inspirationEntries: reindexInspirationEntries([
            ...normalizedImport.inspirationEntries.map((entry, index) => ({
              ...entry,
              id: buildImportedId('inspiration', index)
            })),
            ...workspace.inspirationEntries
          ])
        }
      }

      if (moduleType === 'outline') {
        const volumeIdMap = new Map<string, string>()
        const importedVolumes = normalizedImport.outlineVolumes.map((volume, index) => {
          const nextId = buildImportedId('volume', index)
          volumeIdMap.set(volume.id, nextId)
          return {
            ...volume,
            id: nextId
          }
        })
        const importedItems = normalizedImport.outlineItems.map((item, index) => ({
          ...item,
          id: buildImportedId('outline', index),
          volumeId: volumeIdMap.get(item.volumeId) || item.volumeId
        }))

        if (mode === 'overwrite') {
          return {
            ...workspace,
            outlineVolumes: importedVolumes,
            outlineItems: reindexOutlineItems(importedItems)
          }
        }

        return {
          ...workspace,
          outlineVolumes: [...workspace.outlineVolumes, ...importedVolumes],
          outlineItems: reindexOutlineItems([...workspace.outlineItems, ...importedItems])
        }
      }

      if (moduleType === 'chapters') {
        const volumeIdMap = new Map<string, string>()
        const chapterIdMap = new Map<string, string>()
        const importedVolumes = normalizedImport.outlineVolumes.map((volume, index) => {
          const nextId = buildImportedId('volume', index)
          volumeIdMap.set(volume.id, nextId)
          return {
            ...volume,
            id: nextId
          }
        })
        const importedChapters = normalizedImport.chapters.map((chapter, index) => {
          const nextId = buildImportedId('chapter', index)
          chapterIdMap.set(chapter.id, nextId)
          return normalizeChapterDraft({
            ...chapter,
            id: nextId,
            volumeId: volumeIdMap.get(chapter.volumeId) || chapter.volumeId
          })
        })
        const importedVersions = normalizedImport.chapterVersions.map((version, index) =>
          normalizeChapterVersion({
            ...version,
            id: buildImportedId('chapter-version', index),
            chapterId: chapterIdMap.get(version.chapterId) || version.chapterId
          })
        )

        if (mode === 'overwrite') {
          return {
            ...workspace,
            outlineVolumes: importedVolumes.length ? importedVolumes : workspace.outlineVolumes,
            chapters: importedChapters,
            chapterVersions: importedVersions
          }
        }

        return {
          ...workspace,
          outlineVolumes: importedVolumes.length ? [...workspace.outlineVolumes, ...importedVolumes] : workspace.outlineVolumes,
          chapters: [...workspace.chapters, ...importedChapters],
          chapterVersions: [...workspace.chapterVersions, ...importedVersions]
        }
      }

      if (moduleType === 'relations') {
        const characterNameMap = new Map(workspace.characters.map((character) => [character.name.trim(), character.id]))
        const importedCharacterIdMap = new Map<string, string>()
        const importedCharacters: CharacterCard[] = []

        // Relations and memberships depend on character ids, so we first match by
        // local name and only create missing characters when no stable match exists.
        normalizedImport.characters.forEach((character, index) => {
          const existingId = characterNameMap.get(character.name.trim())
          if (existingId) {
            importedCharacterIdMap.set(character.id, existingId)
            return
          }

          const nextId = buildImportedId('character', index)
          importedCharacterIdMap.set(character.id, nextId)
          importedCharacters.push({
            ...character,
            id: nextId
          })
        })

        const organizationIdMap = new Map<string, string>()
        const importedOrganizations = normalizedImport.organizations.map((organization, index) => {
          const nextId = buildImportedId('organization', index)
          organizationIdMap.set(organization.id, nextId)
          return {
            ...organization,
            id: nextId
          }
        })
        const importedRelationships = normalizedImport.characterRelationships
          .map((relationship, index) => {
            const fromCharacterId = importedCharacterIdMap.get(relationship.fromCharacterId)
            const toCharacterId = importedCharacterIdMap.get(relationship.toCharacterId)
            if (!fromCharacterId || !toCharacterId) {
              return null
            }

            return {
              ...relationship,
              id: buildImportedId('relationship', index),
              fromCharacterId,
              toCharacterId
            }
          })
          .filter((relationship): relationship is CharacterRelationship => Boolean(relationship))
        const importedMemberships = normalizedImport.organizationMemberships
          .map((membership, index) => {
            const characterId = importedCharacterIdMap.get(membership.characterId)
            const organizationId = organizationIdMap.get(membership.organizationId)
            if (!characterId || !organizationId) {
              return null
            }

            return {
              ...membership,
              id: buildImportedId('membership', index),
              characterId,
              organizationId
            }
          })
          .filter((membership): membership is OrganizationMembership => Boolean(membership))

        if (mode === 'overwrite') {
          return {
            ...workspace,
            characters: [...importedCharacters, ...workspace.characters],
            organizations: reindexOrganizations(importedOrganizations),
            characterRelationships: importedRelationships,
            organizationMemberships: importedMemberships
          }
        }

        return {
          ...workspace,
          characters: [...importedCharacters, ...workspace.characters],
          organizations: reindexOrganizations([...importedOrganizations, ...workspace.organizations]),
          characterRelationships: [...importedRelationships, ...workspace.characterRelationships],
          organizationMemberships: [...importedMemberships, ...workspace.organizationMemberships]
        }
      }

      if (moduleType === 'prompts') {
        const importedCats = normalizedImport.promptCategories
        const importedEntries = normalizedImport.promptEntries

        if (mode === 'overwrite') {
          return {
            ...workspace,
            promptCategories: importedCats.length ? importedCats : workspace.promptCategories,
            promptEntries: importedEntries
          }
        }

        // copy 模式：追加新分类和条目，避免 ID 冲突
        const existingCatNames = new Set(workspace.promptCategories.map((c) => c.name))
        const newCats = importedCats
          .filter((c) => !existingCatNames.has(c.name))
          .map((c, index) => ({ ...c, id: buildImportedId('prompt-cat', index) }))
        const catIdMap = new Map<string, string>()
        importedCats.forEach((c, index) => {
          const match = workspace.promptCategories.find((existing) => existing.name === c.name)
          catIdMap.set(c.id, match?.id ?? newCats[index]?.id ?? workspace.promptCategories[0]?.id ?? '')
        })

        return {
          ...workspace,
          promptCategories: [...workspace.promptCategories, ...newCats],
          promptEntries: [
            ...importedEntries.map((e, index) => ({
              ...e,
              id: buildImportedId('prompt', index),
              categoryId: catIdMap.get(e.categoryId) ?? workspace.promptCategories[0]?.id ?? '',
              isBuiltin: false
            })),
            ...workspace.promptEntries
          ]
        }
      }

      return workspace
    })

    schedulePersist('fast')
  }

  // ── 视图导航 ──
  /** 切换主题并触发快速持久化 */
  function setTheme(nextTheme: ThemeName): void {
    theme.value = nextTheme
    scheduleSettingsPersist({ flushWorkspace: false })
  }

  /** 进入章节写作页面 */
  function openChapterStudio(chapterId?: string): void {
    if (chapterId) {
      selectedChapterId.value = chapterId
    } else if (!selectedChapterId.value) {
      syncSelectedChapter()
    }

    pendingChapterInsertion.value = null
    activePanel.value = 'chapters'
    currentView.value = 'chapter-studio'
  }

  /** 从章节写作返回工作台 */
  function backToWorkbench(): void {
    currentView.value = 'workbench'
    if (activePanel.value === 'chapters') {
      activePanel.value = lastWorkbenchPanel.value
    }
  }

  /** 打开指定项目：确保工作区存在、切换选中项目、进入工作台 */
  function openProject(projectId: string): void {
    const project = projects.value.find((item) => item.id === projectId)
    if (!project) {
      return
    }

    ensureProjectWorkspace(projectId)
    selectedProjectId.value = projectId
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = 'overview'
    lastWorkbenchPanel.value = 'overview'
    syncSelectedChapter(projectId)
    // 记录最近一次打开项目的时间，作为首页“最近编辑”展示依据
    touchProjectEditedAt(projectId)
    scheduleSettingsPersist()
  }

  /** 打开拆书知识库独立页面（全局库，不依赖项目） */
  function openDeconstructionLibrary(): void {
    pendingChapterInsertion.value = null
    navigate('deconstruction-library')
    schedulePersist('fast')
  }

  /** 打开番茄风向标独立页面（全局功能，不依赖项目） */
  function openFanqieTrends(): void {
    pendingChapterInsertion.value = null
    navigate('fanqie-trends')
  }


  /** 打开 Skills 独立页面 */
  function openSkillsPage(projectId?: string): void {
    const resolvedProjectId = String(projectId ?? selectedProjectId.value ?? '').trim()
    const targetProject = projects.value.find((item) => item.id === resolvedProjectId) ?? projects.value[0]

    if (targetProject) {
      ensureProjectWorkspace(targetProject.id)
      selectedProjectId.value = targetProject.id
      syncSelectedChapter(targetProject.id)
    }

    navigate('skills')
    schedulePersist('fast')
  }

  /** 打开封面工作台独立页面 */
  function openCoverWorkbenchPage(projectId?: string): void {
    const resolvedProjectId = String(projectId ?? selectedProjectId.value ?? '').trim()
    const targetProject = projects.value.find((item) => item.id === resolvedProjectId) ?? projects.value[0]

    if (targetProject) {
      ensureProjectWorkspace(targetProject.id)
      selectedProjectId.value = targetProject.id
      syncSelectedChapter(targetProject.id)
    }

    navigate('cover-workbench')
    schedulePersist('fast')
  }

  /** 打开回收站。可指定范围：
   *  - 不传：全局回收站视图（主页 / 标题栏入口默认进入全局，展示所有项目 + 全局数据）
   *  - 传 projectId：进入指定项目的回收站
   *  - 传 'all'：全局视图（兼容）
   */
  function openRecycleBin(scope?: string): void {
    // 记录进入回收站前的来源视图，用于回收站“返回”按钮回到上一个页面
    if (currentView.value !== 'recycle-bin') {
      recycleBinReturnView.value = currentView.value
    }
    if (scope === 'global' || scope === 'all' || !scope) {
      recycleBinScope.value = 'global'
    } else {
      ensureProjectWorkspace(scope)
      selectedProjectId.value = scope
      recycleBinScope.value = scope
    }
    currentView.value = 'recycle-bin'
  }

  /** 从项目工作台打开当前项目回收站（若未选项目则进入全局视图） */
  function openCurrentProjectRecycleBin(): void {
    openRecycleBin(selectedProjectId.value || 'global')
  }

  /** 在回收站内切换查看范围（不离开回收站页面） */
  function setRecycleBinScope(scope: 'global' | 'all' | string): void {
    if (scope && scope !== 'global' && scope !== 'all') {
      ensureProjectWorkspace(scope)
      selectedProjectId.value = scope
    }
    recycleBinScope.value = scope
  }


  /** 打开全局智能体独立页面（全局功能，不依赖具体项目，可跨项目批量操作） */
  function openGlobalAgent(): void {
    pendingChapterInsertion.value = null
    navigate('global-agent')
  }

  function backToProjects(): void {
    currentView.value = 'projects'
  }

  /** 记录一次视图跳转：将当前视图压入导航历史栈后再切换，供“返回”回到上一个页面 */
  function navigate(view: typeof currentView.value): void {
    if (currentView.value !== view) {
      navHistory.value.push(currentView.value)
    }
    currentView.value = view
  }

  /** 返回上一个页面；若没有历史记录则回落到项目主页 */
  function navigateBack(): void {
    const prev = navHistory.value.pop()
    currentView.value = prev ?? 'projects'
  }

  /** 打开新建项目向导 */
  function openWizard(): void {
    wizardPrefill.value = null
    navigate('wizard')
  }

  /** 携带预填数据打开新建项目向导（番茄风向标等入口使用） */
  function openWizardWithPrefill(prefill: WizardPrefill): void {
    wizardPrefill.value = prefill
    navigate('wizard')
  }

  /** 读取并清空向导预填数据，返回是否消费成功（供向导在挂载时调用） */
  function consumeWizardPrefill(): WizardPrefill | null {
    const prefill = wizardPrefill.value
    wizardPrefill.value = null
    return prefill
  }

  /** 从主页打开独立的小说续写导入向导 */
  function openContinuationImport(): void {
    currentView.value = 'continuation-import'
  }

  /** 关闭向导，返回上一个页面（若从全局智能体进入新建项目，则返回全局智能体） */
  function closeWizard(): void {
    navigateBack()
  }

  // ── 项目 CRUD ──
  /** 为尚未完成生成的项目预留稳定 ID，使生成期间的 AI 运行记录可归档到目标项目。 */
  function reserveProjectId(): string {
    return uniqueId('project')
  }

  /** 从向导创建完整项目工作区：分配 ID、设置默认分卷和章节、切换到工作台 */
  function createProjectWorkspace(payload: ProjectWorkspacePayload, requestedProjectId?: string): string {
    const projectId = requestedProjectId?.trim() || uniqueId('project')
    const nextVolumes = payload.outlineVolumes?.length ? payload.outlineVolumes : [createWorkspaceVolume()]
    const nextChapters = payload.chapters?.length ? payload.chapters : [buildStarterChapter(nextVolumes[0].id)]
    const computedWordCount = formatProjectWordCount(nextChapters)

    projects.value.unshift(normalizeProjectSummary({
      id: projectId,
      title: payload.project.title,
      premise: payload.project.premise ?? '',
      genre: payload.project.genre,
      novelLength: payload.project.novelLength,
      wordCount: computedWordCount,
      lastEdited: createProjectEditedAt(),
      createdAt: new Date().toISOString(),
      cover: payload.project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
      writingStylePresetId: payload.project.writingStylePresetId?.trim() || 'cinematic-cool',
      writingStylePrompt: payload.project.writingStylePrompt?.trim() || '',
      chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project.chapterAssistantTemplates),
      novelWorkflowStages: payload.project.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
      projectSkills: payload.project.projectSkills ?? [],
      targetPlatform: payload.project.targetPlatform?.trim() || '',
      selectedReferenceWorkIds: payload.project.selectedReferenceWorkIds ?? [],
      coverHistory: payload.project.coverHistory ?? []
    }))

    // A new project gets its own isolated workspace instead of reusing the previous project's draft state.
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries,
        characters: payload.characters,
        organizations: payload.organizations,
        characterRelationships: payload.characterRelationships,
        organizationMemberships: payload.organizationMemberships,
        inspirationEntries: payload.inspirationEntries,
        promptCategories: payload.promptCategories,
        promptEntries: payload.promptEntries,
        outlineVolumes: nextVolumes,
        outlineItems: payload.outlineItems,
        chapters: nextChapters,
        chapterVersions: payload.chapterVersions,
        plotThreads: payload.plotThreads,
        messages: payload.messages
      })
    }
    selectedProjectId.value = projectId
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value =
      payload.worldviewEntries?.length || payload.inspirationEntries?.length || payload.outlineItems?.length
        ? 'overview'
        : 'chapters'
    syncSelectedChapter(projectId)
    schedulePersist('fast')
    return projectId
  }

  /** 快速创建项目（仅标题/题材/长短篇/字数展示），自动生成默认分卷和首章 */
  function createProject(payload: { title: string; genre: string; novelLength: NovelLength }): void {
    const starterVolume = createWorkspaceVolume()
    createProjectWorkspace({
      project: payload,
      outlineVolumes: [starterVolume],
      chapters: [buildStarterChapter(starterVolume.id)]
    })
  }

  /** 批量创建多个项目（批量生成作品用）。与 createProjectWorkspace 不同，本方法不切换当前选中项目与视图。 */
  function batchCreateProjects(payloads: ProjectWorkspacePayload[]): number {
    let createdCount = 0
    const nextProjects = [...projects.value]
    const nextWorkspaces = { ...projectWorkspaces.value }

    for (const payload of payloads) {
      const projectId = uniqueId('project')
      const nextVolumes = payload.outlineVolumes?.length ? payload.outlineVolumes : [createWorkspaceVolume()]
      const nextChapters = payload.chapters?.length ? payload.chapters : [buildStarterChapter(nextVolumes[0].id)]
      const computedWordCount = formatProjectWordCount(nextChapters)

      nextProjects.unshift(normalizeProjectSummary({
        id: projectId,
        title: payload.project.title,
        premise: payload.project.premise ?? '',
        genre: payload.project.genre,
        novelLength: payload.project.novelLength,
        wordCount: computedWordCount,
        lastEdited: createProjectEditedAt(),
        createdAt: new Date().toISOString(),
        cover: payload.project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
        writingStylePresetId: payload.project.writingStylePresetId?.trim() || 'cinematic-cool',
        writingStylePrompt: payload.project.writingStylePrompt?.trim() || '',
        chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project.chapterAssistantTemplates),
        novelWorkflowStages: payload.project.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
        projectSkills: payload.project.projectSkills ?? [],
        targetPlatform: payload.project.targetPlatform?.trim() || '',
        selectedReferenceWorkIds: payload.project.selectedReferenceWorkIds ?? [],
        coverHistory: payload.project.coverHistory ?? []
      }))

      nextWorkspaces[projectId] = normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries,
        characters: payload.characters,
        organizations: payload.organizations,
        characterRelationships: payload.characterRelationships,
        organizationMemberships: payload.organizationMemberships,
        inspirationEntries: payload.inspirationEntries,
        outlineVolumes: nextVolumes,
        outlineItems: payload.outlineItems,
        chapters: nextChapters,
        chapterVersions: payload.chapterVersions,
        plotThreads: payload.plotThreads,
        messages: payload.messages
      })
      createdCount += 1
    }

    projects.value = nextProjects
    projectWorkspaces.value = nextWorkspaces
    if (createdCount > 0) {
      schedulePersist('fast')
    }
    return createdCount
  }

  // ── 回收站 ──

  /** 计算某条回收站记录默认的到期时间（基于全局保留天数） */
  function resolveRecycleExpiry(deletedAt?: string): string {
    const base = deletedAt ? new Date(deletedAt) : new Date()
    const expiry = new Date(base.getTime() + recycleBinRetentionDays.value * 24 * 60 * 60 * 1000)
    return expiry.toISOString()
  }

  /** 全局类别集合：这些内容跨项目共享，删除后进入全局回收站 */
  const GLOBAL_RECYCLE_CATEGORIES = new Set<import('@/types/app').RecycleBinCategory>([
    'ai-profile',
    'image-profile',
    'vision-profile',
    'speech-profile',
    'reference-work',
    'skill',
    'ai-run'
  ])

  /** 向当前项目回收站写入一条删除记录 */
  function pushRecycleEntry(
    category: import('@/types/app').RecycleBinCategory,
    title: string,
    data: Record<string, unknown>,
    options: { projectId?: string; summary?: string; global?: boolean } = {}
  ): void {
    const now = new Date().toISOString()
    // 全局类别的 projectId 固定为空字符串，确保在全局回收站中可被所有项目找到
    const isGlobal = GLOBAL_RECYCLE_CATEGORIES.has(category) || options.global === true
    const entry: import('@/types/app').RecycleBinEntry = {
      id: `recycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      projectId: isGlobal ? '' : (options.projectId ?? selectedProjectId.value),
      title: String(title ?? '').trim() || '未命名',
      summary: options.summary,
      data: data ?? {},
      deletedAt: now,
      expiresAt: resolveRecycleExpiry(now)
    }

    // 全局类别（AI 接口、参考作品等）写入全局回收站
    if (isGlobal) {
      globalRecycleBin.value = [entry, ...globalRecycleBin.value]
    } else {
      updateCurrentWorkspace((workspace) => ({
        ...workspace,
        recycleBin: [entry, ...(workspace.recycleBin ?? [])]
      }))
    }
    schedulePersist('fast')
  }

  /** 记录一个被删除的 Runtime v2 智能体会话到回收站 */
  function recordDeletedAssistantSessionV2(session: Record<string, unknown>): void {
    const title = String((session as { title?: unknown })?.title ?? '').trim() || '智能体对话'
    pushRecycleEntry('assistant-session', title, {
      ...(session as object),
      runtimeV2: true
    } as Record<string, unknown>)
  }

  /**
   * 记录一组被删除的项目级 skills 到回收站（skill 文件已由主进程移入暂存区）。
   * @param skills 主进程 project-skills-delete 返回的 deletedSkills 列表
   * @param projectId 删除时所在项目 id（用于确定归属项目回收站）
   */
  function recordDeletedSkills(
    skills: Array<{ path: string; id: string; name: string; group: string; stashId: string }>,
    projectId?: string
  ): void {
    for (const skill of skills) {
      const ownerProjectId = projectId ?? selectedProjectId.value
      pushRecycleEntry(
        'skill',
        skill.name || skill.id,
        {
          stashId: skill.stashId,
          path: skill.path,
          id: skill.id,
          group: skill.group,
          scope: 'project',
          projectId: ownerProjectId
        },
        {
          projectId: ownerProjectId,
          summary: `项目 Skills · ${skill.path}`
        }
      )
    }
  }

  /** 记录一个被删除的智能体到回收站（本小说智能体 / 全局智能体）。 */
  function recordDeletedAgent(profile: import('@shared/assistant-runtime').AgentProfile): void {
    const isLocal = profile.scope === 'local'
    pushRecycleEntry(
      'agent',
      profile.name,
      { profile },
      {
        projectId: isLocal ? (profile.projectId ?? selectedProjectId.value) : undefined,
        summary: `${isLocal ? '本小说' : '全局'}智能体 · ${profile.isBuiltin ? '内置' : '自定义'}`,
        // 全局智能体跨项目共享，删除后放入全局回收站，便于任意项目视图找回
        global: !isLocal
      }
    )
  }

  /** 移除过期回收站条目（到期自动删除），并返回移除数量 */
  function purgeExpiredRecycleBin(): number {
    const now = Date.now()
    let removed = 0

    // 清理全局回收站过期项
    const nextGlobal = globalRecycleBin.value.filter((entry) => {
      const expired = new Date(entry.expiresAt).getTime() <= now
      if (expired) {
        removed += 1
        void purgeSkillStash(entry)
      }
      return !expired
    })
    if (nextGlobal.length !== globalRecycleBin.value.length) {
      globalRecycleBin.value = nextGlobal
      schedulePersist('fast')
    }

    // 清理每个项目回收站的过期项
    for (const [projectId, workspace] of Object.entries(projectWorkspaces.value)) {
      const nextEntries = (workspace.recycleBin ?? []).filter((entry) => {
        const expired = new Date(entry.expiresAt).getTime() <= now
        if (expired) {
          removed += 1
          void purgeSkillStash(entry)
        }
        return !expired
      })
      if (nextEntries.length !== (workspace.recycleBin ?? []).length) {
        projectWorkspaces.value = {
          ...projectWorkspaces.value,
          [projectId]: {
            ...workspace,
            recycleBin: nextEntries
          }
        }
        schedulePersist('fast')
      }
    }

    return removed
  }

  /** 若回收站条目是 skill，则同步清理主进程中的暂存文件 */
  async function purgeSkillStash(entry: import('@/types/app').RecycleBinEntry): Promise<void> {
    if (entry.category !== 'skill') return
    const stashId = String((entry.data as Record<string, unknown>)?.stashId ?? '').trim()
    if (!stashId) return
    try {
      await window.characterArc.purgeProjectSkill(stashId)
    } catch {
      // 静默失败，暂存文件留待下次清理
    }
  }

  /** 从回收站永久删除一条记录（按当前查看范围定位，兼容任意项目） */
  function permanentlyDeleteRecycleEntry(entryId: string): void {
    // 若目标条目是 skill，先清理主进程中的暂存文件
    const target = globalRecycleBin.value.find((entry) => entry.id === entryId)
      ?? Object.values(projectWorkspaces.value)
        .flatMap((workspace) => workspace.recycleBin ?? [])
        .find((entry) => entry.id === entryId)
    if (target?.category === 'skill') {
      void purgeSkillStash(target)
    }

    const cleanedGlobal = globalRecycleBin.value.filter((entry) => entry.id !== entryId)
    if (cleanedGlobal.length !== globalRecycleBin.value.length) {
      globalRecycleBin.value = cleanedGlobal
      schedulePersist('fast')
      return
    }

    // 逐项目清理（避免只清理当前项目，导致在其它项目回收站视图下删不掉）
    for (const [projectId, workspace] of Object.entries(projectWorkspaces.value)) {
      const next = (workspace.recycleBin ?? []).filter((entry) => entry.id !== entryId)
      if (next.length !== (workspace.recycleBin ?? []).length) {
        projectWorkspaces.value = {
          ...projectWorkspaces.value,
          [projectId]: { ...workspace, recycleBin: next }
        }
        schedulePersist('fast')
        return
      }
    }
  }

  /** 清空当前回收站视图（仅清空当前查看范围：全局 / 指定项目 / 全部） */
  function emptyRecycleBin(): void {
    const scope = recycleBinScope.value
    // 清理 skill 暂存文件，避免残留垃圾数据
    const purgeAll = () => {
      for (const entry of allRecycleBinEntries.value) {
        if (entry.category === 'skill') {
          void purgeSkillStash(entry)
        }
      }
    }
    // 全局视图展示“所有项目 + 全局数据”，清空时应一并清空
    if (scope === 'global' || scope === 'all') {
      purgeAll()
      globalRecycleBin.value = []
      projectWorkspaces.value = Object.fromEntries(
        Object.entries(projectWorkspaces.value).map(([projectId, workspace]) => [
          projectId,
          { ...workspace, recycleBin: [] }
        ])
      )
      schedulePersist('fast')
      return
    }

    // 指定项目：只清空该项目的回收站；全局数据（AI 接口等所有项目共有）保留在全局回收站
    const targetWorkspace = projectWorkspaces.value[scope]
    for (const entry of targetWorkspace?.recycleBin ?? []) {
      if (entry.category === 'skill') {
        void purgeSkillStash(entry)
      }
    }
    updateProjectWorkspace(scope, (workspace) => ({ ...workspace, recycleBin: [] }))
    schedulePersist('fast')
  }

  /** 从回收站恢复一个 Runtime v2 智能体会话（调用后端重建完整会话） */
  async function restoreRuntimeV2Session(
    v2Data: Record<string, unknown> & {
      id?: string
      projectId?: string
      surfaceId?: string
      scopeRef?: string
      title?: string
      createdAt?: string
      updatedAt?: string
      turns?: unknown[]
      events?: unknown[]
    }
  ): Promise<boolean> {
    try {
      const A = window.characterArc?.assistant
      if (!A) return false

      const projectId = String(v2Data.projectId ?? '').trim()
      const surfaceId = String(v2Data.surfaceId ?? 'global-page').trim()
      const title = String(v2Data.title ?? '').trim() || '智能体对话'

      const result = await A.sessionRestore({
        id: v2Data.id,
        projectId: projectId || selectedProjectId.value,
        surfaceId,
        scopeRef: v2Data.scopeRef,
        title,
        createdAt: v2Data.createdAt,
        updatedAt: v2Data.updatedAt,
        turns: v2Data.turns,
        events: v2Data.events
      })

      if (!result.ok) {
        console.error('[recycle] 恢复 Runtime v2 会话失败:', result.error)
        return false
      }
      return true
    } catch (e) {
      console.error('[recycle] 恢复 Runtime v2 会话异常:', e)
      return false
    }
  }

  /** 从回收站恢复一条记录：根据类别将快照写回对应集合 */
  async function restoreRecycleEntry(entryId: string): Promise<boolean> {
    // 查找条目（全局或任一项目回收站）
    let entry = globalRecycleBin.value.find((item) => item.id === entryId)
    let isGlobal = Boolean(entry)
    if (!entry) {
      for (const workspace of Object.values(projectWorkspaces.value)) {
        const found = workspace.recycleBin?.find((item) => item.id === entryId)
        if (found) {
          entry = found
          break
        }
      }
    }
    if (!entry) return false
    // 恢复目标是项目级数据时，把选中项目切到条目所属项目，保证写回正确工作区
    if (entry.category !== 'ai-profile' && entry.category !== 'reference-work') {
      const targetProjectId = String(entry.projectId ?? '').trim()
      if (targetProjectId && projects.value.some((project) => project.id === targetProjectId)) {
        ensureProjectWorkspace(targetProjectId)
        selectedProjectId.value = targetProjectId
        syncSelectedChapter(targetProjectId)
      }
    }

    const data = entry.data ?? {}
    switch (entry.category) {
      case 'worldview': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          worldviewEntries: [...workspace.worldviewEntries, data as unknown as import('@/types/app').WorldviewEntry]
        }))
        break
      }
      case 'character': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          characters: [...workspace.characters, data as unknown as import('@/types/app').CharacterCard]
        }))
        break
      }
      case 'organization': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          organizations: [...workspace.organizations, data as unknown as import('@/types/app').OrganizationEntry]
        }))
        break
      }
      case 'relationship': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          characterRelationships: [...workspace.characterRelationships, data as unknown as import('@/types/app').CharacterRelationship]
        }))
        break
      }
      case 'membership': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          organizationMemberships: [...workspace.organizationMemberships, data as unknown as import('@/types/app').OrganizationMembership]
        }))
        break
      }
      case 'inspiration': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          inspirationEntries: [...workspace.inspirationEntries, data as unknown as import('@/types/app').InspirationEntry]
        }))
        break
      }
      case 'outline': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          outlineItems: [...workspace.outlineItems, data as unknown as import('@/types/app').OutlineItem]
        }))
        break
      }
      case 'outline-volume': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          outlineVolumes: [...workspace.outlineVolumes, data as unknown as import('@/types/app').OutlineVolume]
        }))
        break
      }
      case 'plot-thread': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          plotThreads: [...workspace.plotThreads, data as unknown as import('@/types/app').PlotThread]
        }))
        break
      }
      case 'inspiration-type': {
        const restoredType = String((data as Record<string, unknown>)?.type ?? '').trim()
        if (restoredType && !(currentWorkspace.value.inspirationTypes ?? []).includes(restoredType)) {
          updateCurrentWorkspace((workspace) => ({
            ...workspace,
            inspirationTypes: [...(workspace.inspirationTypes ?? []), restoredType]
          }))
        }
        break
      }
      case 'chapter': {
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          chapters: [...workspace.chapters, data as unknown as import('@/types/app').ChapterDraft]
        }))
        break
      }
      case 'knowledge-document': {
        const doc = data as unknown as import('@/types/app').KnowledgeDocument
        allKnowledgeDocuments.value = [...allKnowledgeDocuments.value, doc]
        break
      }
      case 'story-state': {
        // 世界状态库恢复需写回 SQLite（异步），失败则中断并保留回收站记录
        const projectId = String(data.projectId ?? selectedProjectId.value ?? '').trim()
        const block = String(data.block ?? '').trim()
        const rows = Array.isArray(data.rows) ? data.rows : []
        if (!projectId || !block || !rows.length) {
          return false
        }
        const res = await window.characterArc.restoreStoryState({ projectId, block, rows })
        if (!res.success) {
          return false
        }
        break
      }
      case 'assistant-session': {
        if (data.runtimeV2) {
          // Runtime v2 会话：调用后端恢复完整会话（含 turns / events）
          const v2Data = data as Record<string, unknown> & {
            id?: string
            projectId?: string
            surfaceId?: string
            scopeRef?: string
            title?: string
            turns?: unknown[]
            events?: unknown[]
          }
          const restored = await restoreRuntimeV2Session(v2Data)
          if (!restored) {
            return false
          }
        } else {
          // 旧版会话：写入 appStore.globalAssistantSessions
          const session = data as unknown as import('@/types/app').GlobalAssistantSession
          updateCurrentWorkspace((workspace) => ({
            ...workspace,
            globalAssistantSessions: [...workspace.globalAssistantSessions, session]
          }))
        }
        break
      }
      case 'chapter-version': {
        const version = data as unknown as import('@/types/app').ChapterVersion
        const chapterId = String((data as Record<string, unknown>)?.chapterId ?? version.chapterId ?? '').trim()
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          chapterVersions: [
            ...workspace.chapterVersions.filter((item) => item.id !== version.id),
            normalizeChapterVersion({ ...version, chapterId: chapterId || version.chapterId })
          ]
        }))
        break
      }
      case 'character-version': {
        const characterId = String((data as Record<string, unknown>)?.characterId ?? '').trim()
        const version = data as unknown as import('@/types/app').CharacterCardVersion
        if (!characterId) return false
        updateCurrentWorkspace((workspace) => ({
          ...workspace,
          characters: workspace.characters.map((character) =>
            character.id === characterId
              ? {
                  ...character,
                  versions: [
                    ...(character.versions ?? []).filter((item) => item.id !== version.id),
                    version
                  ]
                }
              : character
          )
        }))
        break
      }
      case 'ai-profile': {
        const profile = data as unknown as import('@/types/app').AiProfile
        if (!appSettings.value.aiProfiles.some((p) => p.id === profile.id)) {
          appSettings.value.aiProfiles.push(profile)
        }
        scheduleSettingsPersist()
        break
      }
      case 'image-profile': {
        const profile = data as unknown as import('@/types/app').ImageProfile
        if (!appSettings.value.imageProfiles.some((p) => p.id === profile.id)) {
          appSettings.value.imageProfiles.push(profile)
        }
        scheduleSettingsPersist()
        break
      }
      case 'vision-profile': {
        const profile = data as unknown as import('@/types/app').VisionProfile
        if (!appSettings.value.visionProfiles.some((p) => p.id === profile.id)) {
          appSettings.value.visionProfiles.push(profile)
        }
        scheduleSettingsPersist()
        break
      }
      case 'speech-profile': {
        const profile = data as unknown as import('@/types/app').SpeechProfile
        if (!appSettings.value.speechProfiles.some((p) => p.id === profile.id)) {
          appSettings.value.speechProfiles.push(profile)
        }
        scheduleSettingsPersist()
        break
      }
      case 'reference-work': {
        const work = data as unknown as import('@/types/app').ReferenceWorkItem
        if (!referenceWorks.value.some((item) => item.id === work.id)) {
          referenceWorks.value = [...referenceWorks.value, work]
        }
        schedulePersist('fast')
        break
      }
      case 'project': {
        const project = (data as Record<string, unknown>)?.project as
          | import('@/types/app').ProjectSummary
          | undefined
        const workspace = (data as Record<string, unknown>)?.workspace as
          | import('@/types/app').ProjectWorkspaceData
          | undefined
        if (!project || !workspace) return false
        if (projects.value.some((item) => item.id === project.id)) return false
        projects.value = [normalizeProjectSummary(project), ...projects.value]
        projectWorkspaces.value = {
          ...projectWorkspaces.value,
          [project.id]: normalizeProjectWorkspaceData(workspace)
        }
        selectedProjectId.value = project.id
        syncSelectedChapter(project.id)
        schedulePersist('fast')
        break
      }
      case 'skill': {
        // 项目级 skill：调用主进程把暂存文件移回原目录
        const stashId = String((data as Record<string, unknown>)?.stashId ?? '').trim()
        const targetProjectId = String((data as Record<string, unknown>)?.projectId ?? entry.projectId ?? '').trim()
        if (!stashId) return false
        const res = await window.characterArc.restoreProjectSkill(targetProjectId || selectedProjectId.value, stashId)
        if (!res.success) return false
        break
      }
      case 'ai-run': {
        const run = (data as Record<string, unknown>)?.run as unknown as import('@/types/app').AiRunRecord
        if (!run || !run.id) return false
        if (!globalAiRuns.value.some((item) => item.id === run.id)) {
          globalAiRuns.value = normalizeAiRuns([...globalAiRuns.value, run])
        }
        schedulePersist('fast')
        break
      }
      case 'agent': {
        // 恢复已删除的智能体：用完整快照重新创建。
        const profile = (data as Record<string, unknown>)?.profile as
          | import('@shared/assistant-runtime').AgentProfile
          | undefined
        if (!profile || !profile.name) return false
        const A = window.characterArc?.assistant
        if (!A) return false
        try {
          await A.agentCreate({
            name: profile.name,
            description: profile.description,
            systemPrompt: profile.systemPrompt,
            avatar: profile.avatar,
            avatarType: profile.avatarType,
            presetIndex: profile.presetIndex,
            scope: profile.scope,
            projectId: profile.scope === 'local' ? (profile.projectId || selectedProjectId.value) : undefined,
            skillIds: profile.skillIds
          })
        } catch (e) {
          console.error('[recycle] 恢复智能体失败:', e)
          return false
        }
        break
      }
      default:
        return false
    }

    // 恢复成功后从回收站移除该记录
    if (isGlobal) {
      globalRecycleBin.value = globalRecycleBin.value.filter((item) => item.id !== entryId)
    } else {
      const targetProjectId = String(entry.projectId ?? selectedProjectId.value ?? '').trim()
      const removeIn = (projectId: string) => {
        const workspace = projectWorkspaces.value[projectId]
        if (!workspace) return false
        const next = (workspace.recycleBin ?? []).filter((item) => item.id !== entryId)
        if (next.length === (workspace.recycleBin ?? []).length) return false
        projectWorkspaces.value = {
          ...projectWorkspaces.value,
          [projectId]: { ...workspace, recycleBin: next }
        }
        return true
      }
      if (!removeIn(targetProjectId)) {
        for (const projectId of Object.keys(projectWorkspaces.value)) {
          if (removeIn(projectId)) break
        }
      }
    }
    schedulePersist('fast')
    return true
  }

  /** 更新回收站保留天数配置 */
  function setRecycleBinRetentionDays(days: number): void {
    const safe = Number.isFinite(days) && days >= 1 ? Math.floor(days) : 5
    appSettings.value = {
      ...appSettings.value,
      recycleBinSettings: {
        retentionDays: safe
      }
    }
    // 更新已有条目的到期时间按新配置重算（仅对未过期的保留）
    // 已过期条目不重算，保持过期以由 purgeExpiredRecycleBin 清理，避免调大保留天数后“复活”。
    const now = Date.now()
    const recomputeExpiry = (entry: import('@/types/app').RecycleBinEntry): import('@/types/app').RecycleBinEntry | null => {
      if (new Date(entry.expiresAt).getTime() <= now) return null
      const base = new Date(entry.deletedAt)
      const expiresAt = new Date(base.getTime() + safe * 24 * 60 * 60 * 1000)
      return { ...entry, expiresAt: expiresAt.toISOString() }
    }
    globalRecycleBin.value = globalRecycleBin.value
      .map(recomputeExpiry)
      .filter((entry): entry is import('@/types/app').RecycleBinEntry => entry !== null)
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      recycleBin: (workspace.recycleBin ?? [])
        .map(recomputeExpiry)
        .filter((entry): entry is import('@/types/app').RecycleBinEntry => entry !== null)
    }))
    scheduleSettingsPersist()
  }

  /** 删除项目；若删除的是当前项目，自动切到剩余首个项目，删空时停留在项目中心空状态 */
  function deleteProject(projectId: string): void {
    const targetProject = projects.value.find((project) => project.id === projectId)
    if (!targetProject) {
      return
    }

    // 删除前将整个项目工作区快照写入全局回收站，支持“一个不放过”地找回
    const workspaceSnapshot = projectWorkspaces.value[projectId]
    if (workspaceSnapshot) {
      globalRecycleBin.value = [
        {
          id: `recycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          category: 'project',
          projectId: projectId,
          title: targetProject.title || '未命名项目',
          summary: `项目《${targetProject.title}》及其全部工作区数据（世界观/角色/大纲/章节/伏笔等）`,
          data: {
            project: { ...targetProject },
            workspace: toSerializable(workspaceSnapshot)
          } as Record<string, unknown>,
          deletedAt: new Date().toISOString(),
          expiresAt: resolveRecycleExpiry()
        },
        ...globalRecycleBin.value
      ]
    }

    projects.value = projects.value.filter((project) => project.id !== projectId)
    const { [projectId]: _removedWorkspace, ...remainingWorkspaces } = projectWorkspaces.value
    projectWorkspaces.value = remainingWorkspaces
    allKnowledgeDocuments.value = allKnowledgeDocuments.value.filter((document) => (
      !isProjectKnowledgeSource(document.sourceType) || document.projectId !== projectId
    ))

    // 清理被删除项目内所有章节遗留的运行时状态（轻检告警、后处理问题提示）
    const removedChapterIds = workspaceSnapshot
      ? workspaceSnapshot.chapters.map((chapter) => chapter.id)
      : []
    if (removedChapterIds.length) {
      clearChapterRuntimeState(removedChapterIds)
    }

    if (selectedProjectId.value === projectId) {
      selectedProjectId.value = projects.value[0]?.id ?? ''
      pendingChapterInsertion.value = null
      currentView.value = 'projects'
      syncSelectedChapter()
    }

    schedulePersist('fast')
  }

  /** 手动排序：按传入的项目 ID 顺序重排项目列表并持久化（首页“我的作品”手动排序用） */
  function reorderProjects(projectIds: string[]): void {
    const orderIndex = new Map(projectIds.map((id, index) => [id, index]))
    const nextProjects = [...projects.value].sort((a, b) => {
      const aIndex = orderIndex.get(a.id)
      const bIndex = orderIndex.get(b.id)
      if (aIndex === undefined && bIndex === undefined) return 0
      if (aIndex === undefined) return 1
      if (bIndex === undefined) return -1
      return aIndex - bIndex
    })
    projects.value = nextProjects
    schedulePersist('fast')
  }

  /** 设置首页“我的作品”的排序方式并持久化 */
  function setProjectSortMode(mode: string): void {
    projectSortMode.value = mode || 'created'
    schedulePersist('fast')
  }

  /** 设置首页“我的作品”某个排序维度的升/降方向并持久化 */
  function setProjectSortDirection(dimension: string, direction: 'asc' | 'desc'): void {
    projectSortDirections.value = { ...projectSortDirections.value, [dimension]: direction }
    schedulePersist('fast')
  }

  /** 判定本次 updateProject 是否真正编辑了项目元数据（标题/题材/简介/封面等），用于决定是否刷新最近编辑时间 */
  function isProjectMetaEdit(payload: Partial<ProjectSummary>): boolean {
    return (
      payload.title !== undefined
      || payload.premise !== undefined
      || payload.genre !== undefined
      || payload.novelLength !== undefined
      || payload.cover !== undefined
      || payload.writingStylePresetId !== undefined
      || payload.writingStylePrompt !== undefined
      || payload.chapterAssistantTemplates !== undefined
      || payload.novelWorkflowStages !== undefined
      || payload.targetPlatform !== undefined
      || payload.coverHistory !== undefined
    )
  }

  /** 更新项目摘要信息（标题、题材、封面等） */
  function updateProject(projectId: string, payload: Partial<ProjectSummary>): void {
    projects.value = projects.value.map((project) =>
      project.id === projectId
        ? {
            ...project,
            title: payload.title?.trim() || project.title,
            premise: payload.premise !== undefined ? payload.premise.trim() : project.premise,
            genre: payload.genre?.trim() || project.genre,
            novelLength: payload.novelLength !== undefined ? payload.novelLength : project.novelLength,
            lastEdited: payload.lastEdited?.trim()
              || (isProjectMetaEdit(payload) ? createProjectEditedAt() : project.lastEdited),
            cover: payload.cover || project.cover,
            writingStylePresetId: payload.writingStylePresetId?.trim() || project.writingStylePresetId,
            writingStylePrompt:
              payload.writingStylePrompt !== undefined ? payload.writingStylePrompt.trim() : project.writingStylePrompt,
            chapterAssistantTemplates:
              payload.chapterAssistantTemplates !== undefined
                ? normalizeChapterAssistantTemplates(payload.chapterAssistantTemplates)
                : project.chapterAssistantTemplates,
            novelWorkflowStages:
              payload.novelWorkflowStages !== undefined ? payload.novelWorkflowStages : project.novelWorkflowStages,
            projectSkills: payload.projectSkills !== undefined ? payload.projectSkills : project.projectSkills,
            targetPlatform: payload.targetPlatform !== undefined ? payload.targetPlatform.trim() : project.targetPlatform,
            selectedReferenceWorkIds: payload.selectedReferenceWorkIds !== undefined
              ? payload.selectedReferenceWorkIds
              : project.selectedReferenceWorkIds,
            coverHistory: payload.coverHistory !== undefined ? payload.coverHistory : project.coverHistory
          }
        : project
    )
    schedulePersist('fast')
  }

  function updateWorkflowDocument(volumeId: string, documentKey: string, content: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map((volume) =>
        volume.id !== volumeId
          ? volume
          : {
              ...volume,
              workflowDocuments: (volume.workflowDocuments ?? []).map((document) =>
                document.key === documentKey
                  ? { ...document, content, updatedAt: new Date().toISOString() }
                  : document
              )
            }
      )
    }))
    schedulePersist('fast')
  }

  function mergeKnowledgeDocuments(documents: KnowledgeDocument[]): void {
    const normalizedDocuments = documents
      .filter((document) => document && typeof document.id === 'string' && document.id.trim())
      .map((document) => normalizeKnowledgeDocumentScope({
        ...document,
        keywords: Array.isArray(document.keywords)
          ? document.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
          : [],
        metadata: document.metadata && typeof document.metadata === 'object'
          ? document.metadata
          : {},
        createdAt: document.createdAt || new Date().toISOString(),
        updatedAt: document.updatedAt || document.createdAt || new Date().toISOString()
      }, selectedProjectId.value))

    allKnowledgeDocuments.value = replaceKnowledgeDocumentsBySource(
      allKnowledgeDocuments.value,
      normalizedDocuments
    )
    schedulePersist('fast')
  }

  function removeKnowledgeDocuments(documentIds: string[]): void {
    const idSet = new Set(documentIds.map((id) => String(id).trim()).filter(Boolean))
    if (!idSet.size) {
      return
    }

    const removed = allKnowledgeDocuments.value.filter((document) => idSet.has(document.id))
    removed.forEach((document) => pushRecycleEntry('knowledge-document', document.title, { ...document }))
    allKnowledgeDocuments.value = allKnowledgeDocuments.value.filter((document) => !idSet.has(document.id))
    schedulePersist('fast')
  }

  /** 删除世界状态库中的某个区块（角色状态/伏笔/关系/时间线/世界规则/倒计时），删除后进入回收站 */
  async function deleteStoryStateBlock(block: string): Promise<{ success: boolean; count?: number; error?: string }> {
    const project = currentProject.value
    if (!project) return { success: false, error: '请先选择一个项目。' }
    const response = await window.characterArc.deleteStoryState({ projectId: project.id, block })
    if (!response.success || !response.result) {
      return { success: false, error: response.error ?? '删除世界状态失败。' }
    }
    const { count, snapshot } = response.result
    if (count > 0) {
      pushRecycleEntry('story-state', `世界状态库·${block}`, {
        block,
        rows: snapshot,
        projectId: project.id
      })
    }
    return { success: true, count }
  }

  /** 删除世界状态库中的单条卡片数据（角色状态/伏笔/时间线等），删除后进入回收站 */
  async function deleteStoryStateItem(block: string, itemId: string | number): Promise<{ success: boolean; count?: number; error?: string }> {
    const project = currentProject.value
    if (!project) return { success: false, error: '请先选择一个项目。' }
    const response = await window.characterArc.deleteStoryStateItem({ projectId: project.id, block, itemId })
    if (!response.success || !response.result) {
      return { success: false, error: response.error ?? '删除世界状态卡片失败。' }
    }
    const { count, snapshot } = response.result
    if (count > 0) {
      pushRecycleEntry('story-state', `世界状态库·${block}`, {
        block,
        rows: snapshot,
        projectId: project.id
      })
    }
    return { success: true, count }
  }

  function upsertProjectConstraint(payload: {
    id?: string
    title: string
    content: string
    summary?: string
    keywords?: string[]
    scope?: string
    weight?: 'core' | 'important' | 'supporting'
    locked?: boolean
  }): void {
    const title = String(payload.title ?? '').trim()
    const content = String(payload.content ?? '').trim()
    if (!title || !content) {
      return
    }

    const now = new Date().toISOString()
    const targetId = String(payload.id ?? '').trim()
    const existing = targetId
      ? knowledgeDocuments.value.find((document) => document.id === targetId)
      : null

    const nextDocument: KnowledgeDocument = {
      id: existing?.id || uniqueId('constraint'),
      projectId: selectedProjectId.value,
      title,
      sourceType: 'canon-fact',
      sourceLabel: 'global-constraint',
      content,
      summary: String(payload.summary ?? '').trim() || content.slice(0, 180),
      keywords: Array.isArray(payload.keywords)
        ? payload.keywords.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
        : [],
      metadata: {
        ...(existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
        scope: String(payload.scope ?? '').trim() || String(existing?.metadata?.scope ?? '').trim() || 'project',
        weight: payload.weight ?? existing?.metadata?.weight ?? 'core',
        locked: payload.locked ?? existing?.metadata?.locked ?? true,
        source: 'global-assistant'
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }

    if (existing) {
      allKnowledgeDocuments.value = allKnowledgeDocuments.value.map((document) =>
        document.id === existing.id ? nextDocument : document
      )
    } else {
      allKnowledgeDocuments.value = [...allKnowledgeDocuments.value, nextDocument]
    }

    schedulePersist('fast')
  }

  function removeProjectConstraint(documentId: string): void {
    const trimmedId = String(documentId ?? '').trim()
    if (!trimmedId) {
      return
    }
    removeKnowledgeDocuments([trimmedId])
  }

  function upsertReferenceWork(work: ReferenceWorkItem): void {
    const existingIndex = referenceWorks.value.findIndex((item) => item.id === work.id)
    if (existingIndex >= 0) {
      const next = [...referenceWorks.value]
      next[existingIndex] = work
      referenceWorks.value = next
    } else {
      referenceWorks.value = [...referenceWorks.value, work]
    }
    schedulePersist('fast')
  }

  function removeReferenceWork(referenceWorkId: string): void {
    const trimmedId = String(referenceWorkId ?? '').trim()
    if (!trimmedId) return
    const target = referenceWorks.value.find((item) => item.id === trimmedId)
    referenceWorks.value = referenceWorks.value.filter((item) => item.id !== trimmedId)
    if (target) {
      pushRecycleEntry('reference-work', target.title, { ...target })
    }
    for (const project of projects.value) {
      const ids = project.selectedReferenceWorkIds ?? []
      if (ids.includes(trimmedId)) {
        updateProject(project.id, {
          selectedReferenceWorkIds: ids.filter((id) => id !== trimmedId)
        })
      }
    }
    schedulePersist('fast')
  }

  function appendAiRun(projectId: string, record: Omit<AiRunRecord, 'projectId'>): void {
    globalAiRuns.value = [
      ...globalAiRuns.value,
      {
        ...record,
        projectId: projectId.trim(),
        usage: record.usage && typeof record.usage === 'object'
          ? {
                promptTokens: Number.isFinite(record.usage.promptTokens) ? Math.max(0, Number(record.usage.promptTokens)) : undefined,
                completionTokens: Number.isFinite(record.usage.completionTokens) ? Math.max(0, Number(record.usage.completionTokens)) : undefined,
                totalTokens: Number.isFinite(record.usage.totalTokens) ? Math.max(0, Number(record.usage.totalTokens)) : undefined,
                reasoningTokens: Number.isFinite(record.usage.reasoningTokens) ? Math.max(0, Number(record.usage.reasoningTokens)) : undefined,
                cachedInputTokens: Number.isFinite(record.usage.cachedInputTokens) ? Math.max(0, Number(record.usage.cachedInputTokens)) : undefined
            }
          : undefined,
        usedKnowledge: Array.isArray(record.usedKnowledge)
          ? record.usedKnowledge.map((item) => {
                const sourceType: AiRunRecord['usedKnowledge'][number]['sourceType'] =
                  item.sourceType === 'reference-summary'
                  || item.sourceType === 'workflow-document'
                  || item.sourceType === 'canon-fact'
                  || item.sourceType === 'chapter-summary'
                    ? item.sourceType
                    : 'reference-chunk'

                return {
                  documentId: String(item.documentId ?? '').trim(),
                  title: String(item.title ?? '').trim() || '未命名知识片段',
                  sourceType,
                  sourceLabel: String(item.sourceLabel ?? '').trim(),
                  snippet: String(item.snippet ?? '').trim(),
                  keywords: Array.isArray(item.keywords)
                    ? item.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 8)
                    : []
                }
            })
          : [],
        toolCalls: Array.isArray(record.toolCalls)
          ? record.toolCalls.map((item) => ({
                tool: String(item.tool ?? '').trim(),
                args: item.args && typeof item.args === 'object' ? item.args as Record<string, unknown> : {},
                durationMs: Number.isFinite(item.durationMs) ? Math.max(0, Number(item.durationMs)) : 0,
                status: (item.status === 'error' ? 'error' : 'ok') as 'ok' | 'error',
                error: String(item.error ?? '').trim() || undefined
            }))
          : undefined
      }
    ].slice(-500)
    schedulePersist('fast')
  }

  /** 将指定的 AI 调用日志移入全局回收站（软删除，可恢复）。 */
  function moveAiRunsToRecycle(ids: string[]): void {
    const idSet = new Set(ids)
    if (!idSet.size) return
    const runs = globalAiRuns.value.filter((run) => idSet.has(run.id))
    if (!runs.length) return
    for (const run of runs) {
      const title = String(run.task ?? '').trim() || 'AI 调用'
      pushRecycleEntry(
        'ai-run',
        title,
        { run } as Record<string, unknown>,
        {
          projectId: run.projectId || '',
          summary: `${run.provider} / ${run.model} · ${run.startedAt ?? ''}`
        }
      )
    }
    globalAiRuns.value = globalAiRuns.value.filter((run) => !idSet.has(run.id))
    schedulePersist('fast')
  }

  function updateWorkflowDocuments(
    volumeId: string,
    payloads: Array<{ key: string; content: string }>
  ): void {
    if (!payloads.length) {
      return
    }

    const payloadMap = new Map(payloads.map((payload) => [payload.key, payload.content]))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map((volume) =>
        volume.id !== volumeId
          ? volume
          : {
              ...volume,
              workflowDocuments: (volume.workflowDocuments ?? []).map((document) =>
                payloadMap.has(document.key)
                  ? { ...document, content: payloadMap.get(document.key) ?? document.content, updatedAt: new Date().toISOString() }
                  : document
              )
            }
      )
    }))
    schedulePersist('fast')
  }

  function appendWorkflowDocumentEntry(volumeId: string, documentKey: string, entryTitle: string, body: string): void {
    const normalizedBody = body.trim()
    if (!normalizedBody) {
      return
    }

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map((volume) => {
        if (volume.id !== volumeId) {
          return volume
        }

        return {
          ...volume,
          workflowDocuments: (volume.workflowDocuments ?? []).map((document) => {
            if (document.key !== documentKey) {
              return document
            }

            const header = document.content.split('\n')[0] || `# ${document.title.replace(/\.md$/i, '')}`
            const isPlaceholder = /待 AI 生成|待补充/.test(document.content) && document.content.trim().split('\n').length <= 3
            const nextContent = isPlaceholder
              ? `${header}\n\n## ${entryTitle}\n${normalizedBody}\n`
              : `${document.content.trim()}\n\n## ${entryTitle}\n${normalizedBody}\n`

            return { ...document, content: nextContent, updatedAt: new Date().toISOString() }
          })
        }
      })
    }))
    schedulePersist('fast')
  }

  function setActiveWorkflowVolumeId(id: string): void {
    activeWorkflowVolumeId.value = id
  }

  // ── 世界观 CRUD ──
  /** 创建世界观设定条目，插入到列表头部 */
  function createWorldviewEntry(payload?: Partial<WorldviewEntry>): string {
    const entryId = uniqueId('world')
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries([
        {
          id: entryId,
          type: payload?.type?.trim() || '地理',
          title: payload?.title?.trim() || `新设定条目 ${workspace.worldviewEntries.length + 1}`,
          content:
            payload?.content?.trim() ||
            '这里是新的世界观设定草稿。你可以继续补充时代背景、法则机制或地理环境细节。',
          tags: Array.isArray(payload?.tags) ? payload.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8) : [],
          sortOrder: payload?.sortOrder ?? 0,
          createdAt,
          updatedAt
        },
        ...workspace.worldviewEntries
      ])
    }))
    schedulePersist('fast')
    return entryId
  }

  function updateWorldviewEntry(entryId: string, payload: Partial<WorldviewEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(
        workspace.worldviewEntries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                type: payload.type?.trim() || entry.type,
                title: payload.title?.trim() || entry.title,
                content: payload.content?.trim() || entry.content,
                tags: Array.isArray(payload.tags)
                  ? payload.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8)
                  : entry.tags,
                updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
              }
            : entry
        )
      )
    }))
    schedulePersist('fast')
  }

  function deleteWorldviewEntry(entryId: string): void {
    const target = currentWorkspace.value.worldviewEntries.find((entry) => entry.id === entryId)
    if (target) {
      pushRecycleEntry('worldview', target.title, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(workspace.worldviewEntries.filter((entry) => entry.id !== entryId))
    }))
    schedulePersist('fast')
  }

  /** 批量删除世界观词条 */
  function deleteWorldviewEntries(entryIds: string[]): void {
    if (!entryIds.length) return
    const idSet = new Set(entryIds)
    currentWorkspace.value.worldviewEntries
      .filter((entry) => idSet.has(entry.id))
      .forEach((entry) => pushRecycleEntry('worldview', entry.title, { ...entry }))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(
        workspace.worldviewEntries.filter((entry) => !idSet.has(entry.id))
      )
    }))
    schedulePersist('fast')
  }

  /** 批量修改世界观词条分类（类型） */
  function updateWorldviewEntriesType(entryIds: string[], type: string): void {
    if (!entryIds.length) return
    const idSet = new Set(entryIds)
    const nextType = type.trim() || '地理'
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(
        workspace.worldviewEntries.map((entry) =>
          idSet.has(entry.id)
            ? { ...entry, type: nextType, updatedAt: toIsoTimestamp(new Date().toISOString()) }
            : entry
        )
      )
    }))
    schedulePersist('fast')
  }

  /** 批量修改世界观词条标签 */
  function updateWorldviewEntriesTags(entryIds: string[], tags: string[]): void {
    if (!entryIds.length) return
    const idSet = new Set(entryIds)
    const nextTags = tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8)
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(
        workspace.worldviewEntries.map((entry) =>
          idSet.has(entry.id)
            ? { ...entry, tags: nextTags, updatedAt: toIsoTimestamp(new Date().toISOString()) }
            : entry
        )
      )
    }))
    schedulePersist('fast')
  }

  // ── 角色 CRUD ──
  /** 创建新角色卡，追加到列表末尾，保持旧角色优先展示 */
  function createCharacter(payload?: Partial<CharacterCard>): string {
    const characterId = uniqueId('char')
    const now = new Date().toISOString()
    updateCurrentWorkspace((workspace) => {
      const character: CharacterCard = {
        id: characterId,
        name: payload?.name?.trim() || `新角色 ${workspace.characters.length + 1}`,
        role: payload?.role?.trim() || '待设定',
        avatar: payload?.avatar || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)',
        description:
          payload?.description?.trim() ||
          '这是一名新加入项目的角色草稿。你可以继续补充身份、背景、动机与冲突。',
        appearance: payload?.appearance?.trim() || '',
        personality: payload?.personality?.trim() || '',
        background: payload?.background?.trim() || '',
        scenario: payload?.scenario?.trim() || '',
        greeting: payload?.greeting?.trim() || '',
        dialogueExamples: payload?.dialogueExamples || '',
        tags:
          payload?.tags?.length
            ? payload.tags
            : [{ label: '待完善', tone: 'warning' }],
        customTags: payload?.customTags?.length
          ? payload.customTags
          : (payload?.tags ?? []).map((tag) => tag.label),
        projectBinding: payload?.projectBinding ?? 'local',
        relatedChapterIds: payload?.relatedChapterIds ?? [],
        versions: payload?.versions ?? [],
        createdAt: now,
        updatedAt: now
      }
      return {
        ...workspace,
        characters: [
          ...workspace.characters,
          character
        ]
      }
    })
    schedulePersist('fast')
    return characterId
  }

  function updateCharacter(characterId: string, payload: Partial<CharacterCard>): void {
    const now = new Date().toISOString()
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              name: payload.name?.trim() || character.name,
              role: payload.role?.trim() ?? character.role,
              avatar: payload.avatar || character.avatar,
              description: payload.description?.trim() ?? character.description,
              appearance: payload.appearance ?? character.appearance,
              personality: payload.personality ?? character.personality,
              background: payload.background ?? character.background,
              scenario: payload.scenario ?? character.scenario,
              greeting: payload.greeting ?? character.greeting,
              dialogueExamples: payload.dialogueExamples ?? character.dialogueExamples,
              tags: payload.tags?.length ? payload.tags : character.tags,
              customTags: payload.customTags?.length ? payload.customTags : character.customTags,
              projectBinding: payload.projectBinding ?? character.projectBinding,
              relatedChapterIds: payload.relatedChapterIds ?? character.relatedChapterIds,
              versions: payload.versions ?? character.versions,
              updatedAt: now
            }
          : character
      )
    }))
    schedulePersist('fast')
  }

  /** 保存角色卡版本快照（防止误改） */
  function snapshotCharacter(characterId: string, note = '手动快照'): void {
    const now = new Date().toISOString()
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              versions: [
                ...(Array.isArray(character.versions) ? character.versions : []),
                {
                  id: uniqueId('ver'),
                  note,
                  createdAt: now,
                  data: {
                    name: character.name,
                    role: character.role,
                    description: character.description,
                    appearance: character.appearance,
                    personality: character.personality,
                    background: character.background,
                    scenario: character.scenario,
                    greeting: character.greeting,
                    dialogueExamples: character.dialogueExamples,
                    avatar: character.avatar,
                    tags: character.tags,
                    customTags: character.customTags,
                    projectBinding: character.projectBinding,
                    relatedChapterIds: character.relatedChapterIds
                  }
                }
              ].slice(-50),
              updatedAt: now
            }
          : character
      )
    }))
    schedulePersist('fast')
  }

  /** 回滚角色卡到某个版本快照 */
  function restoreCharacterVersion(characterId: string, versionId: string): boolean {
    let restored = false
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.map((character) => {
        if (character.id !== characterId) return character
        const version = (character.versions ?? []).find((v) => v.id === versionId)
        if (!version) return character
        restored = true
        const data = version.data as Partial<CharacterCard>
        return {
          ...character,
          ...data,
          versions: character.versions,
          updatedAt: new Date().toISOString()
        }
      })
    }))
    schedulePersist('fast')
    return restored
  }

  /** 删除角色卡版本快照 */
  function deleteCharacterVersion(characterId: string, versionId: string): void {
    const targetCharacter = currentWorkspace.value.characters.find((character) => character.id === characterId)
    const targetVersion = targetCharacter?.versions?.find((version) => version.id === versionId)
    if (targetCharacter && targetVersion) {
      pushRecycleEntry('character-version', `版本快照：${targetVersion.note || targetCharacter.name}`, {
        characterId,
        ...targetVersion
      })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.map((character) =>
        character.id === characterId
          ? { ...character, versions: (character.versions ?? []).filter((v) => v.id !== versionId) }
          : character
      )
    }))
    schedulePersist('fast')
  }

  /** 关联/取消关联某章节到角色（用于查看出场章节） */
  function toggleCharacterChapterLink(characterId: string, chapterId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              relatedChapterIds: character.relatedChapterIds.includes(chapterId)
                ? character.relatedChapterIds.filter((id) => id !== chapterId)
                : [...character.relatedChapterIds, chapterId]
            }
          : character
      )
    }))
    schedulePersist('fast')
  }

  /** 删除角色，同时清理其所有关系和组织归属 */
  function deleteCharacter(characterId: string): void {
    const target = currentWorkspace.value.characters.find((character) => character.id === characterId)
    if (target) {
      pushRecycleEntry('character', target.name, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.filter((character) => character.id !== characterId),
      characterRelationships: workspace.characterRelationships.filter(
        (relationship) =>
          relationship.fromCharacterId !== characterId && relationship.toCharacterId !== characterId
      ),
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => membership.characterId !== characterId
      )
    }))
    schedulePersist('fast')
  }

  /** 批量删除角色，同时清理其相关关系与组织归属 */
  function deleteCharacters(characterIds: string[]): void {
    if (!characterIds.length) return
    const idSet = new Set(characterIds)
    currentWorkspace.value.characters
      .filter((character) => idSet.has(character.id))
      .forEach((character) => pushRecycleEntry('character', character.name, { ...character }))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.filter((character) => !idSet.has(character.id)),
      characterRelationships: workspace.characterRelationships.filter(
        (relationship) =>
          !idSet.has(relationship.fromCharacterId) && !idSet.has(relationship.toCharacterId)
      ),
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => !idSet.has(membership.characterId)
      )
    }))
    schedulePersist('fast')
  }

  // ── 组织 CRUD ──
  /** 创建新组织，插入到列表头部 */
  function createOrganization(payload?: Partial<OrganizationEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations([
        {
          id: uniqueId('org'),
          name: payload?.name?.trim() || `新组织 ${workspace.organizations.length + 1}`,
          type: payload?.type?.trim() || '中立势力',
          description:
            payload?.description?.trim() ||
            '这里记录组织定位、资源边界和它在故事中的作用，方便后续接入关系图与章节推进。',
          motto: payload?.motto?.trim() || '待补充组织口号',
          color: payload?.color || 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
          sortOrder: payload?.sortOrder ?? 0,
          createdAt,
          updatedAt
        },
        ...workspace.organizations
      ])
    }))
    schedulePersist('fast')
  }

  function updateOrganization(organizationId: string, payload: Partial<OrganizationEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations(
        workspace.organizations.map((organization) =>
          organization.id === organizationId
            ? {
                ...organization,
                name: payload.name?.trim() || organization.name,
                type: payload.type?.trim() || organization.type,
                description: payload.description?.trim() || organization.description,
                motto: payload.motto?.trim() || organization.motto,
                color: payload.color || organization.color,
                updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
              }
            : organization
        )
      )
    }))
    schedulePersist('fast')
  }

  /** 删除组织，同时清理其所有成员归属关系 */
  function deleteOrganization(organizationId: string): void {
    const target = currentWorkspace.value.organizations.find((organization) => organization.id === organizationId)
    if (target) {
      pushRecycleEntry('organization', target.name, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations(
        workspace.organizations.filter((organization) => organization.id !== organizationId)
      ),
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => membership.organizationId !== organizationId
      )
    }))
    schedulePersist('fast')
  }

  /** 批量删除组织，同时清理其相关成员归属关系 */
  function deleteOrganizations(organizationIds: string[]): void {
    if (!organizationIds.length) return
    const idSet = new Set(organizationIds)
    currentWorkspace.value.organizations
      .filter((organization) => idSet.has(organization.id))
      .forEach((organization) => pushRecycleEntry('organization', organization.name, { ...organization }))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations(
        workspace.organizations.filter((organization) => !idSet.has(organization.id))
      ),
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => !idSet.has(membership.organizationId)
      )
    }))
    schedulePersist('fast')
  }

  // ── 角色关系 CRUD ──
  /** 创建角色关系，自动选择默认的角色对 */
  function createCharacterRelationship(payload?: Partial<CharacterRelationship>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    const fallbackFromCharacterId = payload?.fromCharacterId || characters.value[0]?.id || ''
    const fallbackToCharacterId =
      payload?.toCharacterId ||
      characters.value.find((character) => character.id !== fallbackFromCharacterId)?.id ||
      fallbackFromCharacterId

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: [
        {
          id: uniqueId('relationship'),
          fromCharacterId: fallbackFromCharacterId,
          toCharacterId: fallbackToCharacterId,
          type: payload?.type?.trim() || '待定义关系',
          description:
            payload?.description?.trim() ||
            '补充两人之间的合作、对立、情感张力或利益绑定，后续可直接服务章节冲突编排。',
          intensity:
            payload?.intensity !== undefined && Number.isFinite(payload.intensity)
              ? Math.min(100, Math.max(0, payload.intensity))
              : 50,
          createdAt,
          updatedAt
        },
        ...workspace.characterRelationships
      ]
    }))
    schedulePersist('fast')
  }

  function updateCharacterRelationship(relationshipId: string, payload: Partial<CharacterRelationship>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: workspace.characterRelationships.map((relationship) =>
        relationship.id === relationshipId
          ? {
              ...relationship,
              fromCharacterId: payload.fromCharacterId || relationship.fromCharacterId,
              toCharacterId: payload.toCharacterId || relationship.toCharacterId,
              type: payload.type?.trim() || relationship.type,
              description: payload.description?.trim() || relationship.description,
              intensity:
                payload.intensity !== undefined && Number.isFinite(payload.intensity)
                  ? Math.min(100, Math.max(0, payload.intensity))
                  : relationship.intensity,
              updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
            }
          : relationship
      )
    }))
    schedulePersist('fast')
  }

  function deleteCharacterRelationship(relationshipId: string): void {
    const target = currentWorkspace.value.characterRelationships.find((relationship) => relationship.id === relationshipId)
    if (target) {
      pushRecycleEntry('relationship', `关系：${target.type || '未命名'}`, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: workspace.characterRelationships.filter(
        (relationship) => relationship.id !== relationshipId
      )
    }))
    schedulePersist('fast')
  }

  /** 批量删除角色关系 */
  function deleteCharacterRelationships(relationshipIds: string[]): void {
    if (!relationshipIds.length) return
    const idSet = new Set(relationshipIds)
    currentWorkspace.value.characterRelationships
      .filter((relationship) => idSet.has(relationship.id))
      .forEach((relationship) =>
        pushRecycleEntry('relationship', `关系：${relationship.type || '未命名'}`, { ...relationship })
      )
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: workspace.characterRelationships.filter(
        (relationship) => !idSet.has(relationship.id)
      )
    }))
    schedulePersist('fast')
  }

  // ── 组织成员归属 CRUD ──
  /** 创建组织成员归属关系 */
  function createOrganizationMembership(payload?: Partial<OrganizationMembership>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: [
        {
          id: uniqueId('membership'),
          characterId: payload?.characterId || workspace.characters[0]?.id || '',
          organizationId: payload?.organizationId || workspace.organizations[0]?.id || '',
          role: payload?.role?.trim() || '普通成员',
          notes: payload?.notes?.trim() || '待补充归属说明',
          createdAt,
          updatedAt
        },
        ...workspace.organizationMemberships
      ]
    }))
    schedulePersist('fast')
  }

  function updateOrganizationMembership(membershipId: string, payload: Partial<OrganizationMembership>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: workspace.organizationMemberships.map((membership) =>
        membership.id === membershipId
          ? {
              ...membership,
              characterId: payload.characterId || membership.characterId,
              organizationId: payload.organizationId || membership.organizationId,
              role: payload.role?.trim() || membership.role,
              notes: payload.notes?.trim() || membership.notes,
              updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
            }
          : membership
      )
    }))
    schedulePersist('fast')
  }

  function deleteOrganizationMembership(membershipId: string): void {
    const target = currentWorkspace.value.organizationMemberships.find((membership) => membership.id === membershipId)
    if (target) {
      pushRecycleEntry('membership', `成员归属：${target.role || '成员'}`, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => membership.id !== membershipId
      )
    }))
    schedulePersist('fast')
  }

  /** 批量删除组织成员归属 */
  function deleteOrganizationMemberships(membershipIds: string[]): void {
    if (!membershipIds.length) return
    const idSet = new Set(membershipIds)
    currentWorkspace.value.organizationMemberships
      .filter((membership) => idSet.has(membership.id))
      .forEach((membership) =>
        pushRecycleEntry('membership', `成员归属：${membership.role || '成员'}`, { ...membership })
      )
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => !idSet.has(membership.id)
      )
    }))
    schedulePersist('fast')
  }

  // ── 灵感卡片 CRUD ──
  function normalizeInspirationTags(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value
      .map((tag) => tag && typeof tag === 'object'
        ? String((tag as Record<string, unknown>).label ?? '').trim()
        : String(tag ?? '').trim())
      .filter((tag) => tag && tag !== '[object Object]')
      .slice(0, 8)
  }

  /** 创建灵感卡片，限制标签最多 8 个 */
  function createInspirationEntry(payload?: Partial<InspirationEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    const normalizedTags = normalizeInspirationTags(payload?.tags)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries([
        {
        id: uniqueId('inspiration'),
          type: payload?.type?.trim() || '场景火花',
          title: payload?.title?.trim() || `灵感卡片 ${workspace.inspirationEntries.length + 1}`,
          content:
            payload?.content?.trim() ||
            '这里记录一个可以继续扩写的灵感片段，你可以补充场景、冲突、情绪或关键台词。',
          tags: normalizedTags,
          relatedThreadId: payload?.relatedThreadId || undefined,
          source: payload?.source === 'ai' ? 'ai' : 'manual',
          sortOrder: payload?.sortOrder ?? 0,
          createdAt,
          updatedAt
        },
        ...workspace.inspirationEntries
      ])
    }))
    schedulePersist('fast')
  }

  function updateInspirationEntry(entryId: string, payload: Partial<InspirationEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries(
        workspace.inspirationEntries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                type: payload.type?.trim() || entry.type,
                title: payload.title?.trim() || entry.title,
                content: payload.content?.trim() || entry.content,
                tags:
                  Array.isArray(payload.tags) && payload.tags.length
                    ? normalizeInspirationTags(payload.tags)
                    : entry.tags,
                source: payload.source ?? entry.source,
                relatedThreadId: payload.relatedThreadId !== undefined ? payload.relatedThreadId : entry.relatedThreadId,
                updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
              }
            : entry
        )
      )
    }))
    schedulePersist('fast')
  }

  function deleteInspirationEntry(entryId: string): void {
    const target = currentWorkspace.value.inspirationEntries.find((entry) => entry.id === entryId)
    if (target) {
      pushRecycleEntry('inspiration', target.title, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries(
        workspace.inspirationEntries.filter((entry) => entry.id !== entryId)
      )
    }))
    schedulePersist('fast')
  }

  /** 批量删除灵感卡片 */
  function deleteInspirationEntries(entryIds: string[]): void {
    if (!entryIds.length) return
    const idSet = new Set(entryIds)
    currentWorkspace.value.inspirationEntries
      .filter((entry) => idSet.has(entry.id))
      .forEach((entry) => pushRecycleEntry('inspiration', entry.title, { ...entry }))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries(
        workspace.inspirationEntries.filter((entry) => !idSet.has(entry.id))
      )
    }))
    schedulePersist('fast')
  }

  // ── 提示词库 CRUD ──

  /** 创建提示词分类，返回新分类 ID */
  function createPromptCategory(name: string): string | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    if (currentWorkspace.value.promptCategories.some((c) => c.name === trimmed)) return null
    const now = new Date().toISOString()
    const category: PromptCategory = {
      id: uniqueId('prompt-cat'),
      name: trimmed,
      sortOrder: currentWorkspace.value.promptCategories.length,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptCategories: [...workspace.promptCategories, category]
    }))
    schedulePersist('fast')
    return category.id
  }

  /** 更新提示词分类 */
  function updatePromptCategory(categoryId: string, payload: Partial<Pick<PromptCategory, 'name' | 'sortOrder'>>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptCategories: workspace.promptCategories.map((cat) =>
        cat.id === categoryId
          ? { ...cat, name: payload.name?.trim() || cat.name, sortOrder: payload.sortOrder ?? cat.sortOrder, updatedAt: new Date().toISOString() }
          : cat
      )
    }))
    schedulePersist('fast')
  }

  /** 删除提示词分类：将分类下的提示词移入回收站，分类本身也入回收站 */
  function deletePromptCategory(categoryId: string): void {
    const target = currentWorkspace.value.promptCategories.find((c) => c.id === categoryId)
    if (!target || target.isBuiltin) return
    const categoryEntries = currentWorkspace.value.promptEntries.filter((e) => e.categoryId === categoryId)
    categoryEntries.forEach((entry) => pushRecycleEntry('prompt', entry.title, { ...entry }))
    pushRecycleEntry('prompt-category', target.name, { ...target })
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptCategories: workspace.promptCategories.filter((c) => c.id !== categoryId),
      promptEntries: workspace.promptEntries.filter((e) => e.categoryId !== categoryId)
    }))
    schedulePersist('fast')
  }

  /** 拖拽排序提示词分类 */
  function reorderPromptCategories(orderedIds: string[]): void {
    const idIndexMap = new Map(orderedIds.map((id, index) => [id, index]))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptCategories: workspace.promptCategories
        .map((cat) => ({ ...cat, sortOrder: idIndexMap.get(cat.id) ?? cat.sortOrder }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((cat, index) => ({ ...cat, sortOrder: index }))
    }))
    schedulePersist('fast')
  }

  /** 创建提示词条目 */
  function createPromptEntry(payload: Partial<PromptEntry>): string {
    const now = new Date().toISOString()
    const entry: PromptEntry = {
      id: uniqueId('prompt'),
      categoryId: payload.categoryId || currentWorkspace.value.promptCategories[0]?.id || '',
      title: payload.title?.trim() || '未命名提示词',
      content: payload.content?.trim() || '',
      tags: payload.tags ?? [],
      remark: payload.remark ?? '',
      isFavorite: payload.isFavorite ?? false,
      isPinned: payload.isPinned ?? false,
      usageCount: payload.usageCount ?? 0,
      isBuiltin: payload.isBuiltin ?? false,
      sortOrder: payload.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptEntries: reindexPromptEntries([entry, ...workspace.promptEntries])
    }))
    schedulePersist('fast')
    return entry.id
  }

  /** 更新提示词条目 */
  function updatePromptEntry(entryId: string, payload: Partial<PromptEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptEntries: workspace.promptEntries.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              categoryId: payload.categoryId !== undefined ? payload.categoryId : entry.categoryId,
              title: payload.title?.trim() || entry.title,
              content: payload.content !== undefined ? payload.content : entry.content,
              tags: Array.isArray(payload.tags) ? payload.tags : entry.tags,
              remark: payload.remark !== undefined ? payload.remark : entry.remark,
              isFavorite: payload.isFavorite !== undefined ? payload.isFavorite : entry.isFavorite,
              isPinned: payload.isPinned !== undefined ? payload.isPinned : entry.isPinned,
              usageCount: payload.usageCount !== undefined ? payload.usageCount : entry.usageCount,
              isBuiltin: payload.isBuiltin !== undefined ? payload.isBuiltin : entry.isBuiltin,
              updatedAt: new Date().toISOString()
            }
          : entry
      )
    }))
    schedulePersist('fast')
  }

  /** 删除提示词条目 */
  function deletePromptEntry(entryId: string): void {
    const target = currentWorkspace.value.promptEntries.find((e) => e.id === entryId)
    if (target) {
      pushRecycleEntry('prompt', target.title, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptEntries: workspace.promptEntries.filter((e) => e.id !== entryId)
    }))
    schedulePersist('fast')
  }

  /** 批量删除提示词条目 */
  function deletePromptEntries(entryIds: string[]): void {
    if (!entryIds.length) return
    const idSet = new Set(entryIds)
    currentWorkspace.value.promptEntries
      .filter((e) => idSet.has(e.id))
      .forEach((e) => pushRecycleEntry('prompt', e.title, { ...e }))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptEntries: workspace.promptEntries.filter((e) => !idSet.has(e.id))
    }))
    schedulePersist('fast')
  }

  /** 切换提示词收藏状态 */
  function togglePromptFavorite(entryId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptEntries: workspace.promptEntries.map((e) =>
        e.id === entryId ? { ...e, isFavorite: !e.isFavorite, updatedAt: new Date().toISOString() } : e
      )
    }))
    schedulePersist('fast')
  }

  /** 切换提示词置顶状态 */
  function togglePromptPin(entryId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptEntries: workspace.promptEntries.map((e) =>
        e.id === entryId ? { ...e, isPinned: !e.isPinned, updatedAt: new Date().toISOString() } : e
      )
    }))
    schedulePersist('fast')
  }

  /** 记录提示词使用次数 +1 */
  function incrementPromptUsage(entryId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptEntries: workspace.promptEntries.map((e) =>
        e.id === entryId ? { ...e, usageCount: (e.usageCount ?? 0) + 1, updatedAt: new Date().toISOString() } : e
      )
    }))
    schedulePersist('fast')
  }

  /** 批量移动提示词到指定分类 */
  function movePromptEntriesToCategory(entryIds: string[], categoryId: string): void {
    if (!entryIds.length) return
    const idSet = new Set(entryIds)
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      promptEntries: workspace.promptEntries.map((e) =>
        idSet.has(e.id) ? { ...e, categoryId, updatedAt: new Date().toISOString() } : e
      )
    }))
    schedulePersist('fast')
  }

  /** 导入提示词数据（支持覆盖/追加模式） */
  function importPrompts(payload: { promptCategories?: PromptCategory[]; promptEntries?: PromptEntry[] }, mode: ImportConflictMode): void {
    updateCurrentWorkspace((workspace) => {
      const importedCats = payload.promptCategories ?? []
      const importedEntries = payload.promptEntries ?? []

      if (mode === 'overwrite') {
        return {
          ...workspace,
          promptCategories: normalizePromptCategoriesData(importedCats.length ? importedCats : workspace.promptCategories),
          promptEntries: normalizePromptEntriesData(importedEntries)
        }
      }

      // copy 模式：追加新分类和条目，避免 ID 冲突
      const existingCatNames = new Set(workspace.promptCategories.map((c) => c.name))
      const newCats = importedCats
        .filter((c) => !existingCatNames.has(c.name))
        .map((c) => ({ ...c, id: uniqueId('prompt-cat') }))
      const catIdMap = new Map<string, string>()
      importedCats.forEach((c, index) => {
        const match = workspace.promptCategories.find((existing) => existing.name === c.name)
        catIdMap.set(c.id, match?.id ?? newCats[index]?.id ?? workspace.promptCategories[0]?.id ?? '')
      })

      return {
        ...workspace,
        promptCategories: [...workspace.promptCategories, ...newCats],
        promptEntries: [
          ...importedEntries.map((e) => ({
            ...e,
            id: uniqueId('prompt'),
            categoryId: catIdMap.get(e.categoryId) ?? workspace.promptCategories[0]?.id ?? '',
            isBuiltin: false
          })),
          ...workspace.promptEntries
        ]
      }
    })
    schedulePersist('fast')
  }

  // ── 伏笔线索 CRUD ──
  function createPlotThread(payload?: Partial<PlotThread>): string {
    const now = new Date().toISOString()
    const nextThread: PlotThread = {
      id: uniqueId('thread'),
      title: payload?.title?.trim() || '未命名伏笔',
      description: payload?.description?.trim() || '',
      openedInChapterId: payload?.openedInChapterId || '',
      plannedCloseChapterId: payload?.plannedCloseChapterId || undefined,
      status: payload?.status || 'pending',
      closedInChapterId: payload?.closedInChapterId || undefined,
      tags: Array.isArray(payload?.tags) ? payload.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      priority: payload?.priority || 'medium',
      remark: payload?.remark || '',
      characterIds: Array.isArray(payload?.characterIds) ? payload.characterIds : [],
      createdAt: now,
      updatedAt: now
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: [...workspace.plotThreads, nextThread]
    }))
    schedulePersist('fast')
    return nextThread.id
  }

  function updatePlotThread(threadId: string, payload: Partial<PlotThread>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              ...payload,
              title: payload.title?.trim() || thread.title,
              description: payload.description?.trim() ?? thread.description,
              tags: Array.isArray(payload.tags)
                ? payload.tags.map((t) => String(t).trim()).filter(Boolean)
                : thread.tags,
              characterIds: Array.isArray(payload.characterIds)
                ? payload.characterIds
                : thread.characterIds ?? [],
              updatedAt: new Date().toISOString()
            }
          : thread
      )
    }))
    schedulePersist('fast')
  }

  function deletePlotThread(threadId: string): void {
    const target = currentWorkspace.value.plotThreads.find((thread) => thread.id === threadId)
    if (target) {
      pushRecycleEntry('plot-thread', target.title, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.filter((thread) => thread.id !== threadId)
    }))
    schedulePersist('fast')
  }

  /** 批量删除伏笔 */
  function deletePlotThreads(threadIds: string[]): void {
    if (!threadIds.length) return
    const idSet = new Set(threadIds)
    currentWorkspace.value.plotThreads
      .filter((thread) => idSet.has(thread.id))
      .forEach((thread) => pushRecycleEntry('plot-thread', thread.title, { ...thread }))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.filter((thread) => !idSet.has(thread.id))
    }))
    schedulePersist('fast')
  }

  /** 批量修改伏笔状态 */
  function batchUpdatePlotThreadStatus(threadIds: string[], status: PlotThreadStatus): void {
    if (!threadIds.length) return
    const idSet = new Set(threadIds)
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.map((thread) =>
        idSet.has(thread.id)
          ? {
              ...thread,
              status,
              closedInChapterId: status === 'resolved' ? (thread.closedInChapterId || selectedChapterId.value) : undefined,
              updatedAt: new Date().toISOString()
            }
          : thread
      )
    }))
    schedulePersist('fast')
  }

  /** 批量修改伏笔标签 */
  function batchUpdatePlotThreadTags(threadIds: string[], tags: string[]): void {
    if (!threadIds.length) return
    const idSet = new Set(threadIds)
    const cleanTags = tags.map((t) => String(t).trim()).filter(Boolean)
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.map((thread) =>
        idSet.has(thread.id)
          ? {
              ...thread,
              tags: cleanTags,
              updatedAt: new Date().toISOString()
            }
          : thread
      )
    }))
    schedulePersist('fast')
  }

  /** 批量导入伏笔 */
  function importPlotThreads(threads: Array<Partial<PlotThread> & { title: string }>): void {
    if (!threads.length) return
    const now = new Date().toISOString()
    const newThreads: PlotThread[] = threads.map((t) => ({
      id: uniqueId('thread'),
      title: t.title.trim(),
      description: t.description?.trim() || '',
      openedInChapterId: t.openedInChapterId || '',
      plannedCloseChapterId: t.plannedCloseChapterId || undefined,
      status: t.status || 'pending',
      closedInChapterId: t.closedInChapterId || undefined,
      tags: Array.isArray(t.tags) ? t.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      priority: t.priority || 'medium',
      remark: t.remark || '',
      characterIds: Array.isArray(t.characterIds) ? t.characterIds : [],
      createdAt: t.createdAt || now,
      updatedAt: now
    }))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: [...workspace.plotThreads, ...newThreads]
    }))
    schedulePersist('fast')
  }

  // ── 灵感自定义生成类型 CRUD ──
  /** 新增一条自定义灵感生成类型，去重后保存 */
  function addInspirationType(type: string): boolean {
    const clean = String(type ?? '').trim()
    if (!clean) return false
    const current = currentWorkspace.value.inspirationTypes ?? []
    if (current.includes(clean)) return false
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationTypes: [...(workspace.inspirationTypes ?? []), clean]
    }))
    schedulePersist('fast')
    return true
  }

  /** 删除一条自定义灵感生成类型，并写入回收站 */
  function deleteInspirationType(type: string): void {
    const clean = String(type ?? '').trim()
    if (!clean) return
    const target = (currentWorkspace.value.inspirationTypes ?? []).find((item) => item === clean)
    if (target) {
      pushRecycleEntry('inspiration-type', target, { type: target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationTypes: (workspace.inspirationTypes ?? []).filter((item) => item !== clean)
    }))
    schedulePersist('fast')
  }

  // ── 大纲分卷 CRUD ──
  /** 创建新的大纲分卷，返回新分卷 ID */
  function createOutlineVolume(payload?: Partial<OutlineVolume>): string {
    const nextVolume = createWorkspaceVolume({
      id: uniqueId('volume'),
      title: payload?.title?.trim() || `分卷 ${outlineVolumes.value.length + 1}`,
      wordTarget: normalizeVolumeWordTarget(payload?.wordTarget),
      summary: payload?.summary?.trim()
    })

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: [...workspace.outlineVolumes, nextVolume]
    }))
    schedulePersist('fast')
    return nextVolume.id
  }

  function updateOutlineVolume(volumeId: string, payload: Partial<OutlineVolume>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map((volume) =>
        volume.id === volumeId
          ? {
              ...volume,
              title: payload.title?.trim() || volume.title,
              wordTarget: normalizeVolumeWordTarget(payload.wordTarget) || volume.wordTarget,
              summary: payload.summary?.trim() || volume.summary
            }
          : volume
      )
    }))
    schedulePersist('fast')
  }

  /** 拖拽移动分卷位置，并同步章节/大纲节点的整体卷顺序 */
  function moveOutlineVolume(
    volumeId: string,
    targetVolumeId: string,
    position: OutlineDropPosition = 'before'
  ): void {
    updateCurrentWorkspace((workspace) => {
      const sourceIndex = workspace.outlineVolumes.findIndex((volume) => volume.id === volumeId)
      const targetIndex = workspace.outlineVolumes.findIndex((volume) => volume.id === targetVolumeId)

      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return workspace
      }

      const nextVolumes = [...workspace.outlineVolumes]
      const [movedVolume] = nextVolumes.splice(sourceIndex, 1)
      const targetIndexAfterRemove = nextVolumes.findIndex((volume) => volume.id === targetVolumeId)
      if (targetIndexAfterRemove === -1) {
        return workspace
      }

      const insertIndex = position === 'after' ? targetIndexAfterRemove + 1 : targetIndexAfterRemove
      nextVolumes.splice(insertIndex, 0, movedVolume)
      const nextVolumeIds = nextVolumes.map((volume) => volume.id)

      return {
        ...workspace,
        outlineVolumes: nextVolumes,
        outlineItems: reindexOutlineItems(sortByVolumeOrder(workspace.outlineItems, nextVolumeIds)),
        chapters: sortByVolumeOrder(workspace.chapters, nextVolumeIds)
      }
    })
    schedulePersist('fast')
  }

  function deleteOutlineVolume(volumeId: string): void {
    const volumeIndex = outlineVolumes.value.findIndex((volume) => volume.id === volumeId)
    if (volumeIndex === -1) {
      return
    }

    const targetVolume = outlineVolumes.value[volumeIndex]
    if (targetVolume) {
      pushRecycleEntry('outline-volume', targetVolume.title, { ...targetVolume })
    }

    // 删除分卷时不再迁移其下内容：将该分卷下的大纲节点与章节一并删除，并写入回收站
    currentWorkspace.value.outlineItems
      .filter((item) => item.volumeId === volumeId)
      .forEach((item) => pushRecycleEntry('outline', item.title, { ...item }))
    const removedChapterIds = currentWorkspace.value.chapters
      .filter((chapter) => chapter.volumeId === volumeId)
      .map((chapter) => chapter.id)
    currentWorkspace.value.chapters
      .filter((chapter) => chapter.volumeId === volumeId)
      .forEach((chapter) => pushRecycleEntry('chapter', chapter.title, { ...chapter }))

    updateCurrentWorkspace((workspace) => {
      const removedIds = new Set(removedChapterIds)
      return {
        ...workspace,
        outlineVolumes: workspace.outlineVolumes.filter((volume) => volume.id !== volumeId),
        outlineItems: reindexOutlineItems(
          workspace.outlineItems.filter((item) => item.volumeId !== volumeId)
        ),
        chapters: workspace.chapters.filter((chapter) => chapter.volumeId !== volumeId),
        chapterVersions: workspace.chapterVersions.filter((version) => !removedIds.has(version.chapterId))
      }
    })
    // 清理该分卷下被级联删除章节的运行时状态（轻检告警、后处理问题提示）
    clearChapterRuntimeState(removedChapterIds)

    if (activeWorkflowVolumeId.value === volumeId) {
      activeWorkflowVolumeId.value = outlineVolumes.value[0]?.id ?? ''
    }
    if (selectedChapterId.value && !currentWorkspace.value.chapters.some((chapter) => chapter.id === selectedChapterId.value)) {
      selectedChapterId.value = currentWorkspace.value.chapters[0]?.id ?? ''
    }
    schedulePersist('fast')
  }

  // ── 面板与章节导航 ──
  /** 切换工作台面板，chapters 面板会自动进入章节写作模式 */
  function setPanel(panel: PanelName): void {
    if (panel === 'chapters') {
      openChapterStudio()
      return
    }

    if (panel === 'deconstruction') {
      openDeconstructionLibrary()
      return
    }

    lastWorkbenchPanel.value = panel
    activePanel.value = panel
    currentView.value = 'workbench'
  }

  function setAssistantFocusTarget(panel: AssistantFocusPanel, entityId: string): void {
    assistantFocusTarget.value = {
      panel,
      entityId,
      nonce: Date.now()
    }
  }

  function clearAssistantFocusTarget(panel?: AssistantFocusPanel, entityId?: string): void {
    const current = assistantFocusTarget.value
    if (!current) {
      return
    }

    if (panel && current.panel !== panel) {
      return
    }

    if (entityId && current.entityId !== entityId) {
      return
    }

    assistantFocusTarget.value = null
  }

  /** 设置伏笔线索面板的聚焦目标（用于从灵感卡片跳转到指定伏笔） */
  function setThreadFocus(threadId: string): void {
    threadFocusTarget.value = {
      threadId,
      nonce: Date.now()
    }
  }

  function clearThreadFocus(): void {
    threadFocusTarget.value = null
  }

  /** 选中章节并进入章节写作模式 */
  function selectChapter(chapterId: string): void {
    selectedChapterId.value = chapterId
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    currentView.value = 'chapter-studio'
  }

  // ── 章节 CRUD ──
  /** 创建新章节，插入到当前分卷末尾 */
  function createChapter(volumeId = selectedChapter.value?.volumeId): void {
    let nextChapterId = ''
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextIndex = getChapterSequenceInVolume(workspace.chapters, targetVolumeId)
      const nextChapter: ChapterDraft = {
        id: uniqueId('chapter'),
        outlineItemId: '',
        volumeId: targetVolumeId,
        title: `第${nextIndex}章：新章节`,
        summary: '待补充章节摘要',
        status: 'draft',
        wordTarget: DEFAULT_CHAPTER_WORD_TARGET,
        content: ''
      }
      nextChapterId = nextChapter.id

      return {
        ...workspace,
        chapters: insertIntoVolumeSection(workspace.chapters, nextChapter)
      }
    })

    selectedChapterId.value = nextChapterId || selectedChapterId.value
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    schedulePersist('fast')
  }

  /** 从大纲节点创建章节，继承标题、摘要和字数目标 */
  function createChapterFromOutlineItem(item: Pick<OutlineItem, 'id' | 'volumeId' | 'title' | 'summary' | 'wordTarget'>): void {
    let nextChapterId = ''
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = item.volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextChapter: ChapterDraft = {
        id: uniqueId('chapter'),
        outlineItemId: item.id,
        volumeId: targetVolumeId,
        title: item.title?.trim() || '新章节',
        summary: item.summary?.trim() || '待补充章节摘要',
        status: 'draft',
        wordTarget: normalizeChapterWordTarget(item.wordTarget),
        content: ''
      }
      nextChapterId = nextChapter.id

      return {
        ...workspace,
        chapters: insertIntoVolumeSection(workspace.chapters, nextChapter)
      }
    })

    selectedChapterId.value = nextChapterId || selectedChapterId.value
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    currentView.value = 'chapter-studio'
    schedulePersist('fast')
  }

  /** 拖拽移动章节位置，跨卷时自动更新章节所属分卷 */
  function moveChapter(
    chapterId: string,
    targetChapterId: string,
    position: OutlineDropPosition = 'before'
  ): void {
    updateCurrentWorkspace((workspace) => {
      const nextChapters = moveOutlineItemsAroundTarget(
        workspace.chapters,
        [chapterId],
        targetChapterId,
        position
      )
      if (nextChapters === workspace.chapters) {
        return workspace
      }

      return {
        ...workspace,
        chapters: nextChapters
      }
    })
    schedulePersist('fast')
  }

  /** 将章节拖到指定分卷末尾 */
  function moveChaptersToVolumeEnd(chapterIds: string[], volumeId: string): void {
    updateCurrentWorkspace((workspace) => {
      const nextChapters = reorderOutlineItemsToVolumeEnd(
        workspace.chapters,
        chapterIds,
        volumeId,
        workspace.outlineVolumes.map((volume) => volume.id)
      )
      if (nextChapters === workspace.chapters) {
        return workspace
      }

      return {
        ...workspace,
        chapters: nextChapters
      }
    })
    schedulePersist('fast')
  }

  // ── 大纲节点 CRUD ──
  /** 创建大纲节点，插入到当前分卷末尾 */
  function createOutlineItem(payload?: Partial<OutlineItem>): string {
    const outlineId = uniqueId('outline')
    updateCurrentWorkspace((workspace) => {
      const requestedVolumeId = payload?.volumeId?.trim()
      const targetVolumeId = requestedVolumeId && workspace.outlineVolumes.some((volume) => volume.id === requestedVolumeId)
        ? requestedVolumeId
        : (selectedChapter.value?.volumeId && workspace.outlineVolumes.some((volume) => volume.id === selectedChapter.value?.volumeId)
            ? selectedChapter.value.volumeId
            : getWorkspacePrimaryVolumeId(workspace))
      const nextIndex = getOutlineSequenceInVolume(workspace.outlineItems, targetVolumeId)
      const nextItem: OutlineItem = {
        id: outlineId,
        volumeId: targetVolumeId,
        title: payload?.title?.trim() || `第${nextIndex}章：新剧情节点`,
        wordTarget: payload?.wordTarget?.trim() || '预估 3000字',
        conflict: payload?.conflict?.trim() || '新的冲突正在酝酿。',
        summary:
          payload?.summary?.trim() ||
          '这里是新的剧情大纲节点草稿，可以继续补充剧情推进、角色目标和关键转折。',
        relatedCharacterIds: normalizeOutlineReferenceIds(payload?.relatedCharacterIds),
        relatedOrganizationIds: normalizeOutlineReferenceIds(payload?.relatedOrganizationIds),
        relatedWorldviewIds: normalizeOutlineReferenceIds(payload?.relatedWorldviewIds),
        status: payload?.status || 'planned',
        sortOrder: payload?.sortOrder ?? workspace.outlineItems.length
      }

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(insertIntoVolumeSection(workspace.outlineItems, nextItem))
      }
    })
    schedulePersist('fast')
    return outlineId
  }

  function createOutlineItemsAfter(anchorOutlineId: string, payloads: Array<Partial<OutlineItem>>): void {
    if (!payloads.length) {
      return
    }

    updateCurrentWorkspace((workspace) => {
      const anchorIndex = workspace.outlineItems.findIndex((item) => item.id === anchorOutlineId)
      if (anchorIndex === -1) {
        return workspace
      }

      const anchorItem = workspace.outlineItems[anchorIndex]
      const insertedItems = payloads.map((payload, index) => ({
        id: uniqueId('outline'),
        volumeId: payload.volumeId || anchorItem.volumeId,
        title: payload.title?.trim() || `第${anchorIndex + index + 2}章：新剧情节点`,
        wordTarget: payload.wordTarget?.trim() || '预估 3000字',
        conflict: payload.conflict?.trim() || '新的冲突正在酝酿。',
        summary:
          payload.summary?.trim() ||
          '这里是新的剧情大纲节点草稿，可以继续补充剧情推进、角色目标和关键转折。',
        relatedCharacterIds: normalizeOutlineReferenceIds(payload.relatedCharacterIds),
        relatedOrganizationIds: normalizeOutlineReferenceIds(payload.relatedOrganizationIds),
        relatedWorldviewIds: normalizeOutlineReferenceIds(payload.relatedWorldviewIds),
        status: payload.status || 'planned',
        sortOrder: anchorIndex + index + 1
      }))

      const nextItems = [...workspace.outlineItems]
      nextItems.splice(anchorIndex + 1, 0, ...insertedItems)

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(nextItems)
      }
    })
    schedulePersist('fast')
  }

  function applyOutlineImportPlan(
    entries: OutlineImportPlanEntry[],
    newVolumes: OutlineImportNewVolume[],
    volumeUpdates: OutlineImportVolumeUpdate[] = []
  ): OutlineImportApplyResult {
    const result: OutlineImportApplyResult = { added: 0, overwritten: 0, createdVolumes: 0 }
    if (!entries.length) return result

    updateCurrentWorkspace((workspace) => {
      const volumeKeyMap = new Map(workspace.outlineVolumes.map((volume) => [volume.id, volume.id]))
      const nextVolumes = [...workspace.outlineVolumes]
      for (const update of volumeUpdates) {
        const index = nextVolumes.findIndex((volume) => volume.id === update.volumeId)
        if (index < 0) continue
        const existing = nextVolumes[index]
        nextVolumes[index] = {
          ...existing,
          title: update.title?.trim() || existing.title,
          wordTarget: normalizeVolumeWordTarget(update.wordTarget) || existing.wordTarget,
          summary: update.summary?.trim() || existing.summary
        }
      }
      for (const volume of newVolumes) {
        const existing = nextVolumes.find((item) => item.title.trim().toLowerCase() === volume.title.trim().toLowerCase())
        if (existing) {
          volumeKeyMap.set(volume.key, existing.id)
          continue
        }
        const created = createWorkspaceVolume({
          id: uniqueId('volume'),
          title: volume.title,
          wordTarget: normalizeVolumeWordTarget(volume.wordTarget),
          summary: volume.summary?.trim()
        })
        nextVolumes.push(created)
        volumeKeyMap.set(volume.key, created.id)
        result.createdVolumes += 1
      }

      type PendingInsert = {
        item: OutlineItem
        position: OutlineImportPlanEntry['position']
        anchorOutlineId?: string
        order: number
        sourceRow: number
      }
      const pending: PendingInsert[] = []
      let nextItems = [...workspace.outlineItems]

      for (const entry of entries) {
        const targetVolumeId = volumeKeyMap.get(entry.targetVolumeKey) ?? getWorkspacePrimaryVolumeId(workspace)
        const existingIndex = entry.matchOutlineId
          ? nextItems.findIndex((item) => item.id === entry.matchOutlineId)
          : -1
        const existing = existingIndex >= 0 ? nextItems[existingIndex] : null

        if (entry.action === 'overwrite' && existing) {
          const updated: OutlineItem = {
            ...existing,
            volumeId: targetVolumeId,
            title: entry.item.title.trim() || existing.title,
            wordTarget: entry.item.wordTarget?.trim() || existing.wordTarget,
            conflict: entry.item.conflict?.trim() || existing.conflict,
            summary: entry.item.summary?.trim() || existing.summary,
            relatedCharacterIds: normalizeOutlineReferenceIds(entry.item.relatedCharacterIds ?? existing.relatedCharacterIds),
            relatedOrganizationIds: normalizeOutlineReferenceIds(entry.item.relatedOrganizationIds ?? existing.relatedOrganizationIds),
            relatedWorldviewIds: normalizeOutlineReferenceIds(entry.item.relatedWorldviewIds ?? existing.relatedWorldviewIds),
            status: entry.item.status || existing.status
          }
          result.overwritten += 1
          if (entry.position === 'keep' && existing.volumeId === targetVolumeId) {
            nextItems.splice(existingIndex, 1, updated)
          } else {
            nextItems.splice(existingIndex, 1)
            pending.push({
              item: updated,
              position: entry.position === 'keep' ? 'end' : entry.position,
              anchorOutlineId: entry.anchorOutlineId,
              order: entry.order,
              sourceRow: entry.sourceRow
            })
          }
          continue
        }

        result.added += 1
        pending.push({
          item: {
            id: uniqueId('outline'),
            volumeId: targetVolumeId,
            title: entry.item.title.trim() || '未命名大纲节点',
            wordTarget: entry.item.wordTarget?.trim() || '3000',
            conflict: entry.item.conflict?.trim() || '待补充核心冲突',
            summary: entry.item.summary?.trim() || '待补充剧情摘要',
            relatedCharacterIds: normalizeOutlineReferenceIds(entry.item.relatedCharacterIds),
            relatedOrganizationIds: normalizeOutlineReferenceIds(entry.item.relatedOrganizationIds),
            relatedWorldviewIds: normalizeOutlineReferenceIds(entry.item.relatedWorldviewIds),
            status: entry.item.status || 'planned',
            sortOrder: 0
          },
          position: entry.position === 'keep' ? 'end' : entry.position,
          anchorOutlineId: entry.anchorOutlineId,
          order: entry.order,
          sourceRow: entry.sourceRow
        })
      }

      const groups = new Map<string, PendingInsert[]>()
      for (const item of pending) {
        const key = `${item.item.volumeId}:${item.position}:${item.anchorOutlineId ?? ''}`
        const group = groups.get(key) ?? []
        group.push(item)
        groups.set(key, group)
      }

      for (const group of groups.values()) {
        group.sort((a, b) => a.order - b.order || a.sourceRow - b.sourceRow)
        const first = group[0]
        let insertIndex = nextItems.length
        if (first.position === 'start') {
          const firstVolumeIndex = nextItems.findIndex((item) => item.volumeId === first.item.volumeId)
          insertIndex = firstVolumeIndex >= 0 ? firstVolumeIndex : nextItems.length
        } else if (first.position === 'before' || first.position === 'after') {
          const anchorIndex = first.anchorOutlineId
            ? nextItems.findIndex((item) => item.id === first.anchorOutlineId)
            : -1
          if (anchorIndex >= 0) insertIndex = anchorIndex + (first.position === 'after' ? 1 : 0)
        } else {
          const volumeIndexes = nextItems
            .map((item, index) => item.volumeId === first.item.volumeId ? index : -1)
            .filter((index) => index >= 0)
          insertIndex = volumeIndexes.length ? volumeIndexes[volumeIndexes.length - 1] + 1 : nextItems.length
        }
        nextItems.splice(insertIndex, 0, ...group.map((item) => item.item))
      }

      return {
        ...workspace,
        outlineVolumes: nextVolumes,
        outlineItems: reindexOutlineItems(nextItems)
      }
    })
    schedulePersist('fast')
    return result
  }

  function updateOutlineItem(outlineId: string, payload: Partial<OutlineItem>): void {
    updateCurrentWorkspace((workspace) => {
      const currentItem = workspace.outlineItems.find((item) => item.id === outlineId)
      if (!currentItem) {
        return workspace
      }

      const nextItem: OutlineItem = {
        ...currentItem,
        volumeId: payload.volumeId || currentItem.volumeId,
        title: payload.title?.trim() || currentItem.title,
        wordTarget: payload.wordTarget?.trim() || currentItem.wordTarget,
        conflict: payload.conflict?.trim() || currentItem.conflict,
        summary: payload.summary?.trim() || currentItem.summary,
        relatedCharacterIds: normalizeOutlineReferenceIds(payload.relatedCharacterIds ?? currentItem.relatedCharacterIds),
        relatedOrganizationIds: normalizeOutlineReferenceIds(payload.relatedOrganizationIds ?? currentItem.relatedOrganizationIds),
        relatedWorldviewIds: normalizeOutlineReferenceIds(payload.relatedWorldviewIds ?? currentItem.relatedWorldviewIds),
        status: payload.status || currentItem.status
      }

      const remainingItems = workspace.outlineItems.filter((item) => item.id !== outlineId)
      const nextOutlineItems =
        nextItem.volumeId === currentItem.volumeId
          ? workspace.outlineItems.map((item) => (item.id === outlineId ? nextItem : item))
          : insertIntoVolumeSection(remainingItems, nextItem)

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(nextOutlineItems)
      }
    })
    schedulePersist('fast')
  }

  function deleteOutlineItem(outlineId: string): void {
    const target = currentWorkspace.value.outlineItems.find((item) => item.id === outlineId)
    if (target) {
      pushRecycleEntry('outline', target.title, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineItems: reindexOutlineItems(workspace.outlineItems.filter((item) => item.id !== outlineId))
    }))
    schedulePersist('fast')
  }

  /** 批量删除大纲条目（同时清理对应章节及其历史版本、运行时状态） */
  function deleteOutlineItems(outlineIds: string[]): void {
    if (!outlineIds.length) return
    const idSet = new Set(outlineIds)
    currentWorkspace.value.outlineItems
      .filter((item) => idSet.has(item.id))
      .forEach((item) => pushRecycleEntry('outline', item.title, { ...item }))

    // 收集被级联删除的章节 ID，用于清理其历史版本与运行时状态
    const removedChapterIds = currentWorkspace.value.chapters
      .filter((chapter) => idSet.has(chapter.outlineItemId))
      .map((chapter) => chapter.id)

    updateCurrentWorkspace((workspace) => {
      const removedIds = new Set(
        workspace.chapters.filter((chapter) => idSet.has(chapter.outlineItemId)).map((chapter) => chapter.id)
      )
      return {
        ...workspace,
        outlineItems: reindexOutlineItems(
          workspace.outlineItems.filter((item) => !idSet.has(item.id))
        ),
        chapters: workspace.chapters.filter((chapter) => !removedIds.has(chapter.id)),
        chapterVersions: workspace.chapterVersions.filter((version) => !removedIds.has(version.chapterId))
      }
    })
    clearChapterRuntimeState(removedChapterIds)

    // 若被选中的章节因大纲项删除而被级联删除，回退到剩余章节
    if (selectedChapterId.value && !currentWorkspace.value.chapters.some((chapter) => chapter.id === selectedChapterId.value)) {
      selectedChapterId.value = currentWorkspace.value.chapters[0]?.id ?? ''
      pendingChapterInsertion.value = null
    }
    schedulePersist('fast')
  }

  /** 拖拽移动单个大纲节点，位置语义与批量移动保持一致 */
  function moveOutlineItem(
    outlineId: string,
    targetOutlineId: string,
    position: OutlineDropPosition = 'before'
  ): void {
    moveOutlineItems([outlineId], targetOutlineId, position)
  }

  /**
   * 批量移动大纲节点到目标位置（跨卷自动更新 volumeId）
   * @param outlineIds - 要移动的节点 ID 列表
   * @param targetOutlineId - 目标位置节点 ID
   */
  function moveOutlineItems(
    outlineIds: string[],
    targetOutlineId: string,
    position: OutlineDropPosition = 'before'
  ): void {
    updateCurrentWorkspace((workspace) => {
      const nextOutlineItems = moveOutlineItemsAroundTarget(
        workspace.outlineItems,
        outlineIds,
        targetOutlineId,
        position
      )
      if (nextOutlineItems === workspace.outlineItems) {
        return workspace
      }

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(nextOutlineItems)
      }
    })
    schedulePersist('fast')
  }

  /** 将一个或多个大纲节点追加到指定分卷末尾 */
  function moveOutlineItemsToVolumeEnd(outlineIds: string[], volumeId: string): void {
    updateCurrentWorkspace((workspace) => {
      const nextOutlineItems = reorderOutlineItemsToVolumeEnd(
        workspace.outlineItems,
        outlineIds,
        volumeId,
        workspace.outlineVolumes.map((volume) => volume.id)
      )
      if (nextOutlineItems === workspace.outlineItems) {
        return workspace
      }

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(nextOutlineItems)
      }
    })
    schedulePersist('fast')
  }

  /** 删除章节（至少保留一章），自动切换到相邻章节 */
  function deleteChapter(chapterId: string): void {
    if (chapters.value.length === 0) {
      return
    }

    const targetIndex = chapters.value.findIndex((chapter) => chapter.id === chapterId)
    if (targetIndex === -1) {
      return
    }

    const target = currentWorkspace.value.chapters.find((chapter) => chapter.id === chapterId)
    if (target) {
      pushRecycleEntry('chapter', target.title, { ...target })
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      chapters: workspace.chapters.filter((chapter) => chapter.id !== chapterId),
      chapterVersions: workspace.chapterVersions.filter((version) => version.chapterId !== chapterId)
    }))
    // 清理该章节遗留的运行时状态（轻检告警、后处理问题提示）
    clearChapterRuntimeState([chapterId])

    if (selectedChapterId.value === chapterId) {
      const fallback = chapters.value[Math.max(0, targetIndex - 1)] ?? chapters.value[0]
      selectedChapterId.value = fallback?.id ?? ''
      pendingChapterInsertion.value = null
    }
    schedulePersist('fast')
  }

  function updateChapterTitle(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) {
      return
    }

    const resolvedOutlineItemId = chapter.outlineItemId
      || outlineItems.value.find((item) =>
        item.volumeId === chapter.volumeId && item.title.trim() === chapter.title.trim()
      )?.id
      || ''

    updateChapter(chapter.id, {
      title: value,
      outlineItemId: resolvedOutlineItemId || chapter.outlineItemId
    })
    schedulePersist('autosave')
  }

  function updateChapterContent(value: string, chapterId = selectedChapter.value?.id ?? ''): void {
    if (!chapterId || !chapters.value.some((chapter) => chapter.id === chapterId)) {
      return
    }

    updateChapter(chapterId, { content: value })
    // 内容编辑是高频热路径：正文更新时不触发 120ms 的工作区全量序列化 + IPC 同步
    // （单窗口下该同步主要是回写主进程快照，而持久化的 saveWorkspace 已负责更新快照），
    // 避免大章节（数十万字）每次按键都序列化整个工作区导致卡顿。
    schedulePersist('autosave', { syncWorkspace: false })
  }

  async function reloadChapterFromDb(chapterId: string): Promise<void> {
    const projectId = currentProject.value?.id
    if (!projectId) return
    const res = await window.characterArc.readChapterFromDb(projectId, chapterId)
    if (!res.success || !res.result) return
    const data = res.result
    updateChapter(chapterId, {
      title: data.title,
      summary: data.summary,
      status: data.status as ChapterDraft['status'],
      wordTarget: data.wordTarget,
      content: data.content
    })
  }

  function updateChapterSummary(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) {
      return
    }

    updateChapter(chapter.id, { summary: value })
    schedulePersist('autosave')
  }

  function updateChapter(chapterId: string, payload: Partial<ChapterDraft>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      chapters: workspace.chapters.map((chapter) =>
        chapter.id === chapterId
          ? normalizeChapterDraft({
              ...chapter,
              outlineItemId: payload.outlineItemId !== undefined ? payload.outlineItemId : chapter.outlineItemId,
              volumeId: payload.volumeId || chapter.volumeId,
              title: payload.title?.trim() || chapter.title,
              summary: payload.summary !== undefined ? payload.summary.trim() || chapter.summary : chapter.summary,
              status: payload.status ?? chapter.status,
              wordTarget:
                payload.wordTarget !== undefined ? normalizeChapterWordTarget(payload.wordTarget) : chapter.wordTarget,
              content: payload.content !== undefined ? payload.content : chapter.content
            })
          : chapter
      )
    }))
  }

  function updateChapterStatuses(chapterIds: string[], status: ChapterDraft['status']): number {
    const selectedIds = new Set(chapterIds)
    let changed = 0
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      chapters: workspace.chapters.map((chapter) => {
        if (!selectedIds.has(chapter.id) || chapter.status === status) return chapter
        changed += 1
        return normalizeChapterDraft({ ...chapter, status })
      })
    }))
    return changed
  }

  // ── 章节版本管理 ──
  /** 获取指定章节的历史版本列表，按创建时间降序排列 */
  function getChapterVersions(chapterId: string): ChapterVersion[] {
    return chapterVersions.value
      .filter((version) => version.chapterId === chapterId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /** 保存当前章节的快照版本，立即持久化 */
  async function saveCurrentChapterVersion(): Promise<{ success: boolean; version?: ChapterVersion; error?: string }> {
    const chapter = selectedChapter.value
    if (!chapter) {
      return {
        success: false,
        error: '当前没有可保存的章节。'
      }
    }

    const version = normalizeChapterVersion({
      id: uniqueId('chapter-version'),
      chapterId: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      status: chapter.status,
      wordTarget: chapter.wordTarget,
      content: chapter.content,
      createdAt: new Date().toISOString()
    })

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      chapterVersions: [version, ...workspace.chapterVersions]
    }))

    if (hasHydrated.value) {
      await persistWorkspace()
      if (persistenceError.value) {
        return {
          success: false,
          error: persistenceError.value
        }
      }
    }

    return {
      success: true,
      version
    }
  }

  /** 恢复到指定的历史版本，覆盖当前章节内容 */
  async function restoreChapterVersion(versionId: string): Promise<{ success: boolean; error?: string }> {
    let version = chapterVersions.value.find((item) => item.id === versionId)

    if (!version) {
      const projectId = currentProject.value?.id
      if (projectId) {
        const res = await window.characterArc.readChapterVersionFromDb(projectId, versionId)
        if (res.success && res.result) {
          version = {
            id: res.result.id,
            chapterId: res.result.chapterId,
            title: res.result.title,
            summary: res.result.summary,
            status: res.result.status as ChapterDraft['status'],
            wordTarget: res.result.wordTarget,
            content: res.result.content,
            createdAt: res.result.createdAt
          }
        }
      }
    }

    if (!version) {
      return {
        success: false,
        error: '未找到对应的历史版本。'
      }
    }

    updateChapter(version.chapterId, {
      title: version.title,
      summary: version.summary,
      status: version.status,
      wordTarget: version.wordTarget,
      content: version.content
    })

    selectedChapterId.value = version.chapterId
    activePanel.value = 'chapters'
    pendingChapterInsertion.value = null

    if (hasHydrated.value) {
      await persistWorkspace()
      if (persistenceError.value) {
        return {
          success: false,
          error: persistenceError.value
        }
      }
    }

    return {
      success: true
    }
  }

  /** 批量删除章节历史版本，删除后写入项目回收站 */
  function deleteChapterVersions(versionIds: string[]): { success: boolean; error?: string } {
    if (!versionIds.length) {
      return { success: false, error: '未选择要删除的历史版本' }
    }
    const idSet = new Set(versionIds)
    const targetVersions = chapterVersions.value.filter((v) => idSet.has(v.id))
    if (targetVersions.length === 0) {
      return { success: false, error: '未找到要删除的历史版本' }
    }

    // 将删除的版本快照写入项目回收站
    for (const version of targetVersions) {
      pushRecycleEntry('chapter-version', `历史版本：${version.title || '未命名章节'}`, {
        ...version
      })
    }

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      chapterVersions: workspace.chapterVersions.filter((v) => !idSet.has(v.id))
    }))

    schedulePersist('fast')
    return { success: true }
  }

  /** 更新单个应用设置项并触发快速持久化（仅写入 app_settings 行） */
  function updateAppSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
    options: { flushWorkspace?: boolean } = {}
  ): void {
    appSettings.value[key] = value
    scheduleSettingsPersist(options)
  }

  async function saveAppSettingsDraft(nextSettings: AppSettings, nextTheme: ThemeName = theme.value): Promise<boolean> {
    theme.value = nextTheme

    // 检测被删除的各类接口配置，写入全局回收站（接口配置为跨项目共享的全局数据）
    const prev = normalizeAppSettings(appSettings.value)
    const next = normalizeAppSettings(nextSettings)
    const profileCollections: Array<{
      category: import('@/types/app').RecycleBinCategory
      prevList: Array<{ id: string; name?: string; model?: string }>
      nextList: Array<{ id: string }>
    }> = [
      { category: 'ai-profile', prevList: prev.aiProfiles, nextList: next.aiProfiles },
      { category: 'image-profile', prevList: prev.imageProfiles, nextList: next.imageProfiles },
      { category: 'vision-profile', prevList: prev.visionProfiles, nextList: next.visionProfiles },
      { category: 'speech-profile', prevList: prev.speechProfiles, nextList: next.speechProfiles }
    ]
    for (const { category, prevList, nextList } of profileCollections) {
      for (const profile of prevList) {
        if (nextList.some((p) => p.id === profile.id)) continue
        // 避免重复写入（例如恢复后再次保存）
        if (!globalRecycleBin.value.some((entry) => entry.category === category && (entry.data as { id?: string })?.id === profile.id)) {
          pushRecycleEntry(category, profile.name || profile.model || '未命名接口', { ...profile })
        }
      }
    }

    appSettings.value = normalizeAppSettings(nextSettings)
    await persistAppSettings()
    return !persistenceError.value
  }

  async function flushAppSettings(): Promise<boolean> {
    await persistAppSettings()
    return !persistenceError.value
  }

  function switchAiProfile(profileId: string): void {
    const profile = appSettings.value.aiProfiles.find(p => p.id === profileId)
    if (!profile) return
    appSettings.value.activeAiProfileId = profileId
    appSettings.value.provider = profile.provider
    appSettings.value.model = profile.model
    appSettings.value.apiKey = profile.apiKey
    appSettings.value.baseUrl = profile.baseUrl
    appSettings.value.apiProtocol = profile.apiProtocol ?? 'auto'
    appSettings.value.temperature = profile.temperature
    appSettings.value.topP = profile.topP
    scheduleSettingsPersist({ flushWorkspace: false })
  }

  function updateActiveAiProfileModel(model: string): void {
    appSettings.value.model = model
    const profile = appSettings.value.aiProfiles.find(p => p.id === appSettings.value.activeAiProfileId)
    if (profile) {
      profile.model = model
      // 同步把当前模型加入已保存模型列表，方便同一接口下快速切换
      profile.models = mergeProfileModel(profile.models, model)
    }
    scheduleSettingsPersist({ flushWorkspace: false })
  }

  /** 把某个模型加入指定接口配置的已保存列表（去空、去重、限量） */
  function addProfileModel(profileId: string, model: string): void {
    const profile = appSettings.value.aiProfiles.find(p => p.id === profileId)
    if (!profile) return
    profile.models = mergeProfileModel(profile.models, model)
    scheduleSettingsPersist({ flushWorkspace: false })
  }

  /** 从指定接口配置的已保存列表中移除某个模型 */
  function removeProfileModel(profileId: string, model: string): void {
    const profile = appSettings.value.aiProfiles.find(p => p.id === profileId)
    if (!profile) return
    profile.models = (profile.models ?? []).filter(m => m !== model)
    scheduleSettingsPersist({ flushWorkspace: false })
  }

  /** 把某接口配置下已保存的某个模型设为该配置的当前模型 */
  function applyProfileModel(profileId: string, model: string): void {
    const profile = appSettings.value.aiProfiles.find(p => p.id === profileId)
    if (!profile) return
    profile.model = model
    if (profile.id === appSettings.value.activeAiProfileId) {
      appSettings.value.model = model
    }
    scheduleSettingsPersist({ flushWorkspace: false })
  }

  function addAiProfile(profile: import('@/types/app').AiProfile): void {
    appSettings.value.aiProfiles.push(profile)
    scheduleSettingsPersist()
  }

  function deleteAiProfile(profileId: string): void {
    if (profileId === appSettings.value.activeAiProfileId) return
    const target = appSettings.value.aiProfiles.find((p) => p.id === profileId)
    appSettings.value.aiProfiles = appSettings.value.aiProfiles.filter(p => p.id !== profileId)
    if (target) {
      pushRecycleEntry('ai-profile', target.name || target.model || '未命名接口', { ...target })
    }
    // 全局回收站（globalRecycleBin）随 workspace 快照持久化；这里不触发 schedulePersist，
    // 避免后续 persistAppSettings 把内存中尚未落盘的全局回收站覆盖掉。
    scheduleSettingsPersist({ flushWorkspace: false })
  }

  function updateAiProfile(profileId: string, updates: Partial<import('@/types/app').AiProfile>): void {
    const profile = appSettings.value.aiProfiles.find(p => p.id === profileId)
    if (!profile) return
    Object.assign(profile, updates)
    if (profileId === appSettings.value.activeAiProfileId) {
      if (updates.provider !== undefined) appSettings.value.provider = updates.provider
      if (updates.model !== undefined) appSettings.value.model = updates.model
      if (updates.apiKey !== undefined) appSettings.value.apiKey = updates.apiKey
      if (updates.baseUrl !== undefined) appSettings.value.baseUrl = updates.baseUrl
      if (updates.apiProtocol !== undefined) appSettings.value.apiProtocol = updates.apiProtocol
      if ('temperature' in updates) appSettings.value.temperature = updates.temperature
      if ('topP' in updates) appSettings.value.topP = updates.topP
    }
    scheduleSettingsPersist()
  }

  function updateCoverWorkbenchHistory(items: import('@/types/app').CoverWorkbenchHistoryItem[]): void {
    coverWorkbenchHistory.value = items
    schedulePersist('fast')
  }

  const MAX_CHAT_MESSAGES = 100
  const STREAMING_ASSISTANT_PERSIST_INTERVAL_MS = 2400
  let lastStreamingAssistantPersistAt = 0

  function scheduleAssistantSessionPersist(mode: 'streaming' | 'final' = 'final'): void {
    if (mode === 'streaming') {
      const now = Date.now()
      if (now - lastStreamingAssistantPersistAt < STREAMING_ASSISTANT_PERSIST_INTERVAL_MS) {
        return
      }
      lastStreamingAssistantPersistAt = now
      schedulePersist('autosave', { syncWorkspace: false })
      return
    }

    lastStreamingAssistantPersistAt = Date.now()
    schedulePersist('fast')
  }

  function resolveSessionTitle(messages: ChatMessage[]): string {
    const firstUserMessage = messages.find((item) => item.role === 'user')?.content.trim()
    if (!firstUserMessage) {
      return '新对话'
    }

    return firstUserMessage.length > 24 ? `${firstUserMessage.slice(0, 24)}...` : firstUserMessage
  }

  function createGlobalAssistantSession(messages: ChatMessage[] = createEmptyWorkspace().messages): GlobalAssistantSession {
    const now = new Date().toISOString()
    const clonedMessages = messages.map((item) => ({ ...item }))
    return {
      id: uniqueId('global-assistant-session'),
      title: resolveSessionTitle(clonedMessages),
      messages: clonedMessages,
      proposal: null,
      lastProposalPrompt: '',
      lastAssistantReply: '',
      createdAt: now,
      updatedAt: now
    }
  }

  function syncActiveGlobalAssistantSession(
    workspace: ProjectWorkspaceData,
    updater: (session: GlobalAssistantSession) => GlobalAssistantSession
  ): ProjectWorkspaceData {
    const sessions = workspace.globalAssistantSessions.length
      ? workspace.globalAssistantSessions
      : [createGlobalAssistantSession(workspace.messages)]
    const activeSession = sessions.find((session) => session.id === workspace.activeGlobalAssistantSessionId) ?? sessions[0]
    const nextActiveSession = updater(activeSession)
    const nextSessions = sessions.map((session) => (
      session.id === nextActiveSession.id ? nextActiveSession : session
    ))

    return {
      ...workspace,
      messages: nextActiveSession.messages,
      globalAssistantSessions: nextSessions,
      activeGlobalAssistantSessionId: nextActiveSession.id
    }
  }

  // ── AI 聊天消息 ──
  /** 添加用户消息到聊天记录 */
  function pushUserMessage(content: string): void {
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages: ChatMessage[] = [
        ...session.messages.slice(-MAX_CHAT_MESSAGES + 1),
        {
          id: uniqueId('msg'),
          role: 'user',
          content
        }
      ]

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    schedulePersist('fast')
  }

  function pushAssistantMessage(content: string): void {
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages: ChatMessage[] = [
        ...session.messages.slice(-MAX_CHAT_MESSAGES + 1),
        {
          id: uniqueId('msg'),
          role: 'assistant',
          content
        }
      ]

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    schedulePersist('fast')
  }

  function pushStreamingAssistantMessage(): string {
    const messageId = uniqueId('msg')
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages: ChatMessage[] = [
        ...session.messages.slice(-MAX_CHAT_MESSAGES + 1),
        {
          id: messageId,
          role: 'assistant',
          content: ''
        }
      ]

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    schedulePersist('fast')
    return messageId
  }

  function updateAssistantMessageContent(
    messageId: string,
    updater: (content: string) => string,
    options: { persistMode?: 'streaming' | 'final' } = {}
  ): void {
    updateCurrentWorkspaceAssistantSession((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages = session.messages.map((item) => (
        item.id === messageId
          ? { ...item, content: updater(item.content) }
          : item
      ))

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    scheduleAssistantSessionPersist(options.persistMode ?? 'streaming')
  }

  function updateAssistantMessageMeta(
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
    options: { persistMode?: 'streaming' | 'final' } = {}
  ): void {
    updateCurrentWorkspaceAssistantSession((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages = session.messages.map((item) => (
        item.id === messageId ? updater(item) : item
      ))

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    scheduleAssistantSessionPersist(options.persistMode ?? 'streaming')
  }

  function appendAssistantToolCall(messageId: string, toolCall: AssistantToolCall): void {
    updateAssistantMessageMeta(messageId, (message) => {
      const nextToolCalls = [...(message.toolCalls ?? []), toolCall]
      const turns = [...(message.turns ?? [])]
      const currentTurn = turns[turns.length - 1]
      const targetTurn: AssistantTurn = currentTurn && !currentTurn.text.trim()
        ? currentTurn
        : { text: '', toolCalls: [], editEvents: [] }

      if (!currentTurn || currentTurn !== targetTurn) {
        turns.push(targetTurn)
      }

      targetTurn.toolCalls = [...targetTurn.toolCalls, toolCall]

      return {
        ...message,
        toolCalls: nextToolCalls,
        turns
      }
    })
  }

  function updateAssistantToolCall(
    messageId: string,
    toolUseId: string,
    updater: (toolCall: AssistantToolCall) => AssistantToolCall
  ): void {
    updateAssistantMessageMeta(messageId, (message) => {
      const nextToolCalls = (message.toolCalls ?? []).map((item) => (
        item.toolUseId === toolUseId ? updater(item) : item
      ))
      const nextTurns = (message.turns ?? []).map((turn) => ({
        ...turn,
        toolCalls: turn.toolCalls.map((item) => (
          item.toolUseId === toolUseId ? updater(item) : item
        ))
      }))

      return {
        ...message,
        toolCalls: nextToolCalls,
        turns: nextTurns
      }
    })
  }

  function appendAssistantEditEvent(messageId: string, event: AssistantEditEvent): void {
    updateAssistantMessageMeta(messageId, (message) => {
      const nextEditEvents = [...(message.editEvents ?? []), event]
      const turns = [...(message.turns ?? [])]
      if (turns.length === 0) {
        turns.push({ text: '', toolCalls: [], editEvents: [] })
      }
      const currentTurn = turns[turns.length - 1]
      currentTurn.editEvents = [...currentTurn.editEvents, event]

      return {
        ...message,
        editEvents: nextEditEvents,
        turns
      }
    })
  }

  function finalizeAssistantStreamingMessage(messageId: string, payload?: {
    isError?: boolean
    isCanceled?: boolean
  }): void {
    updateAssistantMessageMeta(messageId, (message) => ({
      ...message,
      isError: payload?.isError ?? false,
      isCanceled: payload?.isCanceled ?? false,
      toolCalls: (message.toolCalls ?? []).map((item) => (
        item.status === 'running'
          ? { ...item, status: 'error', isError: true, result: item.result || '（连接中断）' }
          : item
      )),
      turns: (message.turns ?? []).map((turn) => ({
        ...turn,
        toolCalls: turn.toolCalls.map((item) => (
          item.status === 'running'
            ? { ...item, status: 'error', isError: true, result: item.result || '（连接中断）' }
            : item
        ))
      }))
    }), { persistMode: 'final' })
  }

  function updateAssistantSessionProposal(payload: {
    proposal?: GlobalAssistantProposal | null
    lastProposalPrompt?: string
    lastAssistantReply?: string
  }): void {
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => ({
      ...session,
      proposal: payload.proposal === undefined ? session.proposal : payload.proposal,
      lastProposalPrompt: payload.lastProposalPrompt === undefined ? session.lastProposalPrompt : payload.lastProposalPrompt,
      lastAssistantReply: payload.lastAssistantReply === undefined ? session.lastAssistantReply : payload.lastAssistantReply,
      updatedAt: new Date().toISOString()
    })))
    schedulePersist('fast')
    if (payload.proposal !== undefined) {
      void persistWorkspace()
    }
  }

  function clearAssistantMessages(): void {
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const messages = createEmptyWorkspace().messages
      return {
        ...session,
        title: resolveSessionTitle(messages),
        messages,
        updatedAt: new Date().toISOString()
      }
    }))
    schedulePersist('fast')
  }

  function createAssistantSession(): void {
    const nextSession = createGlobalAssistantSession([])
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      messages: nextSession.messages,
      globalAssistantSessions: [nextSession, ...workspace.globalAssistantSessions],
      activeGlobalAssistantSessionId: nextSession.id
    }))
    schedulePersist('fast')
  }

  function switchAssistantSession(sessionId: string): void {
    updateCurrentWorkspace((workspace) => {
      const target = workspace.globalAssistantSessions.find((session) => session.id === sessionId)
      if (!target) {
        return workspace
      }

      return {
        ...workspace,
        messages: target.messages,
        activeGlobalAssistantSessionId: target.id
      }
    })
    schedulePersist('fast')
  }

  function deleteAssistantSession(sessionId: string): void {
    const target = currentWorkspace.value.globalAssistantSessions.find((session) => session.id === sessionId)
    if (target) {
      pushRecycleEntry('assistant-session', target.title || '智能体对话', { ...target })
    }
    updateCurrentWorkspace((workspace) => {
      const nextSessions = workspace.globalAssistantSessions.filter((session) => session.id !== sessionId)
      const fallbackSession = nextSessions.find((session) => session.id === workspace.activeGlobalAssistantSessionId)
        ?? nextSessions[0]
        ?? createGlobalAssistantSession([])

      return {
        ...workspace,
        messages: fallbackSession.messages,
        globalAssistantSessions: nextSessions.length ? nextSessions : [fallbackSession],
        activeGlobalAssistantSessionId: fallbackSession.id
      }
    })
    schedulePersist('fast')
  }

  // ── 章节正文插入 ──
  /** 将 AI 生成的内容插入到当前章节正文，返回是否成功 */
  function insertIntoChapter(content: string, mode: ChapterInsertionMode = 'cursor'): boolean {
    const chapter = selectedChapter.value
    if (!chapter) {
      return false
    }

    const insertion = content.trim()
    if (!insertion) {
      return false
    }

    pendingChapterInsertion.value = {
      id: uniqueId('insert'),
      chapterId: chapter.id,
      content: insertion,
      mode
    }
    return true
  }

  /** 标记章节插入请求已执行完毕 */
  function consumeChapterInsertion(requestId: string): void {
    if (pendingChapterInsertion.value?.id === requestId) {
      pendingChapterInsertion.value = null
    }
  }

  /** 更新编辑器中用户选中的文本状态 */
  function updateChapterSelection(selection: ChapterSelectionState | null): void {
    if (!selection || selection.chapterId !== selectedChapter.value?.id || !selection.text.trim()) {
      currentChapterSelection.value = null
      return
    }

    currentChapterSelection.value = {
      chapterId: selection.chapterId,
      text: selection.text.trim()
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 全局 AI 任务注册表：跨面板维持按钮 loading，驱动进度面板
  // ══════════════════════════════════════════════════════════════════

  /**
   * 把 Map 当作响应式容器时的常规操作：
   * 替换引用才能触发 Vue 重新收集依赖，否则 computed 不会重算。
   */
  function replaceTaskRuns(updater: (next: Map<string, AiTaskRun>) => void): void {
    const next = new Map(aiTaskRuns.value)
    updater(next)
    aiTaskRuns.value = next
  }

  /** 正在进行中的任务（按启动顺序排列，稳定展示在进度面板顶部） */
  const runningAiTasks = computed<AiTaskRun[]>(() =>
    Array.from(aiTaskRuns.value.values())
      .filter((run) => run.stage === 'running')
      .sort((a, b) => a.startedAt - b.startedAt)
  )

  /** 最近已结束的任务；成功任务短暂保留，失败任务保留到用户手动关闭。 */
  const recentAiTasks = computed<AiTaskRun[]>(() =>
    Array.from(aiTaskRuns.value.values())
      .filter((run) => run.stage !== 'running')
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  )

  /** 查询某个任务 key 是否在运行——组件绑定按钮 disabled 和 loading 文本 */
  function isAiTaskRunning(key: string): boolean {
    return aiTaskRuns.value.get(key)?.stage === 'running'
  }

  /** 读取单个任务记录（进度面板或特殊 UI 需要 onCancel 时使用） */
  function getAiTaskRun(key: string): AiTaskRun | undefined {
    return aiTaskRuns.value.get(key)
  }

  /** 当前正在执行的 `runTrackedAiTask` 的 clientTaskId 调用栈（支持并发任务隔离）。 */
  const clientTaskIdStack: string[] = []

  /** 任务被暂停后等待「继续」的 resolve 回调，按任务 key 索引，用于暂停-继续重放。 */
  const resumeWaiters = new Map<string, () => void>()

  /**
   * 执行一次被跟踪的 AI 任务。
   *
   * - 同 key 已在运行时直接拒绝，避免重复请求；如需同一功能并发多次，
   *   调用方应为每次调用生成唯一 key（参考番茄风向标选题、批量生成的 `#序号` 模式）。
   * - 并发任务通过 clientTaskId 调用栈隔离，互不覆盖 abort 通道。
   * - 无论 executor 抛异常还是成功返回，任务都会被标记为结束并在短暂保留后自动清理。
   * - 返回值是 executor 的返回值，方便调用方继续处理结果。
   * - 自动生成 `clientTaskId` 并注入到 executor 的闭包上下文中（通过 `getClientTaskId()`）。
   * - 不按运行时长自动取消；网络错误、协议错误、用户暂停或手动取消时结束。
   * - 支持「暂停-继续」：用户点击暂停会真正中止底层请求，任务保持「已暂停」；
   *   点击继续后用新的 clientTaskId 重新执行 executor（重放），因此暂停不会丢失任务，也不会继续空转。
   *
   * @throws 保留 executor 原始错误抛出，让上层可以 try/catch 常规处理。
   */
  async function runTrackedAiTask<T>(input: AiTaskRunInput, executor: () => Promise<T>): Promise<T> {
    if (isAiTaskRunning(input.key)) {
      throw new Error(`AI 任务「${input.label}」正在进行中，请稍候。`)
    }

    // 每次执行（含暂停后继续）使用一个新的 clientTaskId，用于主进程 abort 通道。
    let clientTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const registerRun = (): void => {
      replaceTaskRuns((next) => {
        next.set(input.key, {
          ...input,
          startedAt: Date.now(),
          stage: 'running',
          clientTaskId
        })
      })
    }
    registerRun()

    const runOnce = (): Promise<T> => {
      // 把 clientTaskId 压入调用栈，让 executor 内部构造 payload 时可以取到当前任务对应的 id。
      clientTaskIdStack.push(clientTaskId)
      return executor().finally(() => {
        const idx = clientTaskIdStack.lastIndexOf(clientTaskId)
        if (idx >= 0) clientTaskIdStack.splice(idx, 1)
      })
    }

    try {
      for (;;) {
        try {
          const result = await runOnce()
          // 用户点击"退出"已标记任务为 canceled，此时即使底层请求成功返回，
          // 也不再把结果交回调用方继续处理（避免已取消任务仍写入业务数据）。
          if (aiTaskRuns.value.get(input.key)?.stage === 'canceled') {
            throw new Error('任务已被取消。')
          }
          finalizeAiTask(input.key, 'done')
          return result
        } catch (error) {
          // 任务被用户暂停：pauseAiTask 已中止底层请求，executor 因此抛错。
          // 此时保持「已暂停」状态，等待用户点击「继续」后换新的 clientTaskId 重新执行。
          if (aiTaskRuns.value.get(input.key)?.paused) {
            await waitForResume(input.key)
            clientTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            const current = aiTaskRuns.value.get(input.key)
            if (!current || current.stage !== 'running') {
              throw new Error('任务已被取消。')
            }
            registerRun()
            continue
          }
          throw error
        }
      }
    } catch (error) {
      // 若任务仍处于暂停态（例如用户在重放间隙再次暂停），保持「已暂停」而不转为失败。
      if (aiTaskRuns.value.get(input.key)?.paused) {
        throw error
      }
      const msg = error instanceof Error ? error.message : String(error)
      finalizeAiTask(input.key, 'error', msg)
      throw error
    }
  }

  /** 等待任务被用户「继续」；暂停期间挂起，resumeAiTask 时放行以触发重放。 */
  function waitForResume(key: string): Promise<void> {
    return new Promise<void>((resolve) => {
      resumeWaiters.set(key, resolve)
    })
  }

  /** 获取当前正在执行的任务的 clientTaskId（供 executor 闭包内使用） */
  function getClientTaskId(): string | undefined {
    return clientTaskIdStack.length ? clientTaskIdStack[clientTaskIdStack.length - 1] : undefined
  }

  function finalizeAiTask(key: string, stage: 'done' | 'error' | 'canceled', error?: string): void {
    const existing = aiTaskRuns.value.get(key)
    if (!existing) {
      return
    }

    // 任务已被用户明确取消/暂停，忽略迟到的终态覆盖（如 abort 后 executor 抛错触发的 error）。
    // 暂停中的任务保持「已暂停」，等待用户「继续」后重放，不应被中途的 error/done 覆盖。
    if (existing.stage === 'canceled' || existing.paused) {
      return
    }

    const finishedAt = Date.now()
    replaceTaskRuns((next) => {
      // 任务结束后自动展开被最小化到后台的任务，让用户能看到成功/失败反馈。
      next.set(key, { ...existing, stage, finishedAt, error, minimized: false })
    })

    if (stage === 'error') {
      return
    }

    window.setTimeout(() => {
      const current = aiTaskRuns.value.get(key)
      // 只清理那条没被重新启动的任务；新任务会带新的 startedAt
      if (current && current.startedAt === existing.startedAt && current.stage !== 'running') {
        replaceTaskRuns((next) => {
          next.delete(key)
        })
      }
    }, AI_TASK_RETENTION_MS)
  }

  /** 手动清理一条任务记录（进度面板的"关闭"按钮使用） */
  function dismissAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage === 'running') {
      return
    }

    replaceTaskRuns((next) => {
      next.delete(key)
    })
  }

  /**
   * 退出/停止某条运行中的任务：
   * - 优先调用任务自带 onCancel 回调；
   * - 若任务携带 clientTaskId，则通过主进程 abort 通道中断底层 IPC 请求；
   * - 立即将任务标记为 canceled，让进度面板及时反映停止状态。
   */
  function cancelAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage !== 'running') {
      return
    }

    // 优先执行任务自带的 onCancel 回调（如章节初稿的内部中止逻辑）
    if (run.onCancel) {
      try {
        run.onCancel()
      } catch (error) {
        console.error('[aiTasks] cancel handler failed:', error)
      }
    }

    // 若无 onCancel 或同时携带了 clientTaskId，则通过主进程 abort 通道中断底层 IPC 请求，
    // 确保退出/暂停按钮对未提供 onCancel 的任务也能真正停止底层执行。
    if (run.clientTaskId) {
      void window.characterArc.cancelAiTask(run.clientTaskId).catch((err) => {
        console.error('[aiTasks] abort underlying IPC failed:', err)
      })
    }

    // 立即将任务标记为已取消，让面板及时反映停止状态，
    // 避免 executor 迟到的 error 终态把面板变成"失败"。
    const current = aiTaskRuns.value.get(key)
    if (current && current.stage === 'running') {
      const finishedAt = Date.now()
      replaceTaskRuns((next) => {
        next.set(key, { ...current, stage: 'canceled', finishedAt, minimized: false, paused: false })
      })
    }

    // 若任务正因「暂停」而挂起等待继续，需放行让 runTrackedAiTask 退出，避免 promise 永久挂起。
    const waiter = resumeWaiters.get(key)
    if (waiter) {
      resumeWaiters.delete(key)
      waiter()
    }
  }

  /**
   * 最小化某条正在运行的任务：隐藏任务行但让它在后台继续执行（不取消）。
   * 用于批量生成等场景，用户想让出窗口继续做别的事。
   */
  function minimizeAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage !== 'running') return
    replaceTaskRuns((next) => {
      next.set(key, { ...run, minimized: true })
    })
  }

  /** 展开一条被最小化到后台的任务，让它在进度面板恢复显示。 */
  function unminimizeAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || !run.minimized) return
    replaceTaskRuns((next) => {
      next.set(key, { ...run, minimized: false })
    })
  }

  /**
   * 暂停某条正在运行的任务：
   * - 真正中止底层执行：调用任务的 onCancel 回调并通过 clientTaskId 通道中止底层 LLM 请求，
   *   让任务立即停止消耗资源，而不是继续在后台跑完。
   * - 展示层：将任务标记为「已暂停」，冻结进度与耗时，按钮图标切换为播放。
   * - 用户点击「继续」后，runTrackedAiTask 会用新的 clientTaskId 重新执行该任务（重放）。
   */
  function pauseAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage !== 'running' || run.paused) return

    // 真正中止底层执行：先执行任务自带的 onCancel 回调（如章节初稿的内部中止逻辑）。
    if (run.onCancel) {
      try {
        run.onCancel()
      } catch (error) {
        console.error('[aiTasks] pause onCancel handler failed:', error)
      }
    }
    // 若任务携带 clientTaskId，则通过主进程 abort 通道中断底层 IPC 请求。
    if (run.clientTaskId) {
      void window.characterArc.cancelAiTask(run.clientTaskId).catch((err) => {
        console.error('[aiTasks] abort underlying IPC on pause failed:', err)
      })
    }

    replaceTaskRuns((next) => {
      next.set(key, { ...run, paused: true, pausedAt: Date.now() })
    })
  }

  /** 继续一条被暂停的任务：解除暂停态，并触发底层任务用新的 clientTaskId 重新执行（重放）。 */
  function resumeAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || !run.paused) return
    replaceTaskRuns((next) => {
      next.set(key, { ...run, paused: false, pausedAt: undefined })
    })
    const waiter = resumeWaiters.get(key)
    if (waiter) {
      resumeWaiters.delete(key)
      waiter()
    }
  }

  /** 查询某条任务是否处于暂停状态。 */
  function isAiTaskPaused(key: string): boolean {
    return aiTaskRuns.value.get(key)?.paused === true
  }

  /** 更新某条正在运行任务的实时进度（0-100），驱动进度面板进度条。 */
  function updateAiTaskProgress(key: string, progress: number): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage !== 'running' || run.paused) return
    const clamped = Math.max(0, Math.min(100, Math.round(progress)))
    if (run.progress === clamped) return
    replaceTaskRuns((next) => {
      next.set(key, { ...run, progress: clamped })
    })
  }

  /**
   * 手动注册一条 AI 任务（不绑定 executor，由调用方自行管理生命周期）。
   * 配合 `finalizeManualTask` 使用。
   */
  function registerManualTask(input: AiTaskRunInput): void {
    const run: AiTaskRun = {
      ...input,
      startedAt: Date.now(),
      stage: 'running'
    }
    replaceTaskRuns((next) => {
      next.set(input.key, run)
    })
  }

  /**
   * 手动终结一条由 `registerManualTask` 注册的 AI 任务。
   */
  function finalizeManualTask(key: string, stage: 'done' | 'error', error?: string): void {
    finalizeAiTask(key, stage, error)
  }

  // ── 事件监听注册 ──
  window.characterArc.onWorkspaceSync(handleRemoteWorkspaceSync)
  window.characterArc.onAiRunEvent(handleAiRunEvent)
  window.characterArc.onChapterStateWarnings(handleChapterStateWarnings)
  window.characterArc.onChapterPostGenerationIssues(handleChapterPostGenerationIssues)
  window.characterArc.onChapterPostGenerationTask(handleChapterPostGenerationTask)
  window.characterArc.onBackfillStateProgress(handleBackfillStateProgress)

  // ── 窗口可见性跟踪 ──
  // 窗口被最小化/隐藏/遮挡时 document.hidden 变为 true，各后台组件据此暂停
  // 非必要定时器与动画，降低空闲 CPU/内存占用（Electron 对隐藏窗口的渲染
  // 进程已做后台节流，这里让业务层定时器也能感知并主动让路）。
  function syncWindowVisibility(): void {
    windowVisible.value = !document.hidden
  }
  document.addEventListener('visibilitychange', syncWindowVisibility)

  // ── 响应式监听器 ──
  // 切换章节时清空选中文本
  watch(
    () => selectedChapterId.value,
    () => {
      currentChapterSelection.value = null
    }
  )

  // 自动保存间隔变更时，若有待保存内容则重新调度
  watch(
    () => appSettings.value.autoSaveInterval,
    () => {
      if (isPersistencePending.value) {
        schedulePersist('fast')
      }
    }
  )

  return {
    activePanel,
    autoSaveIntervalLabel,
    aiRuns,
    allAiRuns,
    moveAiRunsToRecycle,
    allRecycleBinEntries,
    recycleBinEntries,
    recycleBinScope,
    recycleBinScopeLabel,
    recycleBinReturnView,
    globalRecycleBinEntries,
    emptyRecycleBin,
    permanentlyDeleteRecycleEntry,
    purgeExpiredRecycleBin,
    recycleBinRetentionDays,
    restoreRecycleEntry,
    recordDeletedAssistantSessionV2,
    recordDeletedSkills,
    recordDeletedAgent,
    setRecycleBinRetentionDays,
    setRecycleBinScope,
    openCurrentProjectRecycleBin,
    projectRecycleBin,
    appSettings,
    activeGlobalAssistantSessionId,
    assistantFocusTarget,
    threadFocusTarget,
    coverWorkbenchHistory,
    openRecycleBin,
    backToProjects,
    openGlobalAgent,
    navigate,
    navigateBack,
    navHistory,
    selectProject,
    backToWorkbench,
    chapterVersions,
    chapters,
    characterRelationships,
    characters,
    inspirationEntries,
    inspirationTypes,
    promptCategories,
    promptEntries,
    createPromptCategory,
    updatePromptCategory,
    deletePromptCategory,
    reorderPromptCategories,
    createPromptEntry,
    updatePromptEntry,
    deletePromptEntry,
    deletePromptEntries,
    togglePromptFavorite,
    togglePromptPin,
    incrementPromptUsage,
    movePromptEntriesToCategory,
    importPrompts,
    closeWizard,
    createProject,
    createProjectWorkspace,
    batchCreateProjects,
    reserveProjectId,
    createCharacter,
    createCharacterRelationship,
    createInspirationEntry,
    createOrganization,
    createOrganizationMembership,
    createOutlineItem,
    createOutlineItemsAfter,
    applyOutlineImportPlan,
    createOutlineVolume,
    createPlotThread,
    createWorldviewEntry,
    createChapter,
    createChapterFromOutlineItem,
    chapterVolumeGroups,
    activeGlobalAssistantSession,
    currentTheme,
    currentProject,
    currentChapterSelection,
    currentView,
    wizardPrefill,
    openWizardWithPrefill,
    consumeWizardPrefill,
    globalAssistantSessions,
    hasHydrated,
    initialize,
    isLiveAutoSave,
    isPersisting,
    isPersistencePending,
    windowVisible,
    deleteChapter,
    deleteCharacter,
    deleteCharacterVersion,
    deleteCharacterRelationship,
    deleteCharacters,
    deleteCharacterRelationships,
    deleteInspirationEntry,
    deleteInspirationEntries,
    deleteOrganization,
    deleteOrganizationMembership,
    deleteOrganizationMemberships,
    deleteOrganizations,
    deleteOutlineItem,
    deleteOutlineItems,
    deleteOutlineVolume,
    deletePlotThread,
    deletePlotThreads,
    batchUpdatePlotThreadStatus,
    batchUpdatePlotThreadTags,
    importPlotThreads,
    addInspirationType,
    deleteInspirationType,
    deleteProject,
    deleteWorldviewEntry,
    deleteWorldviewEntries,
    updateWorldviewEntriesTags,
    updateWorldviewEntriesType,
    insertIntoChapter,
    importProjectData,
    importModuleData,
    consumeChapterInsertion,
    getChapterVersions,
    messages,
    moveChapter,
    moveChaptersToVolumeEnd,
    moveOutlineItem,
    moveOutlineItems,
    moveOutlineItemsToVolumeEnd,
    moveOutlineVolume,
    openChapterStudio,
    openDeconstructionLibrary,
    openFanqieTrends,
    openProject,
    openCoverWorkbenchPage,
    openContinuationImport,
    openSkillsPage,
    openWizard,
    outlineItems,
    organizationMemberships,
    organizations,
    outlineVolumeGroups,
    outlineVolumes,
    pendingChapterInsertion,
    plotThreads,
    projects,
    projectSortMode,
    setProjectSortMode,
    projectSortDirections,
    setProjectSortDirection,
    reorderProjects,
    clearAssistantMessages,
    createAssistantSession,
    deleteAssistantSession,
    pushAssistantMessage,
    pushStreamingAssistantMessage,
    pushUserMessage,
    restoreChapterVersion,
    deleteChapterVersions,
    saveCurrentChapterVersion,
    selectChapter,
    selectedChapter,
    selectedChapterId,
    selectedChapterVolume,
    selectedProjectId,
    setPanel,
    setAssistantFocusTarget,
    setThreadFocus,
    switchAssistantSession,
    setTheme,
    theme,
    updateAppSetting,
    saveAppSettingsDraft,
    flushAppSettings,
    switchAiProfile,
    updateActiveAiProfileModel,
    addProfileModel,
    removeProfileModel,
    applyProfileModel,
    addAiProfile,
    deleteAiProfile,
    updateAiProfile,
    updateAssistantMessageContent,
    updateAssistantMessageMeta,
    appendAssistantToolCall,
    updateAssistantToolCall,
    appendAssistantEditEvent,
    finalizeAssistantStreamingMessage,
    updateAssistantSessionProposal,
    updateCoverWorkbenchHistory,
    updateProject,
    activeWorkflowVolumeId,
    activeWorkflowVolume,
    setActiveWorkflowVolumeId,
    mergeKnowledgeDocuments,
    removeKnowledgeDocuments,
    deleteStoryStateBlock,
    deleteStoryStateItem,
    projectConstraints,
    upsertProjectConstraint,
    removeProjectConstraint,
    referenceWorks,
    upsertReferenceWork,
    removeReferenceWork,
    knowledgeDocuments,
    updateWorkflowDocument,
    updateWorkflowDocuments,
    appendWorkflowDocumentEntry,
    workflowDocuments,
    flushWorkspaceSync,
    persistWorkspace,
    updateChapter,
    updateChapterStatuses,
    updateChapterContent,
    reloadChapterFromDb,
    updateChapterSelection,
    updateChapterSummary,
    updateChapterTitle,
    snapshotCharacter,
    restoreCharacterVersion,
    toggleCharacterChapterLink,
    updateCharacter,
    updateCharacterRelationship,
    updateInspirationEntry,
    updateOrganization,
    updateOrganizationMembership,
    updateOutlineItem,
    updateOutlineVolume,
    updatePlotThread,
    updateWorldviewEntry,
    worldviewEntries,
    persistenceError,
    clearAssistantFocusTarget,
    clearThreadFocus,
    // ── AI 任务注册表 ──
    runningAiTasks,
    recentAiTasks,
    isAiTaskRunning,
    getAiTaskRun,
    runTrackedAiTask,
    getClientTaskId,
    dismissAiTask,
    cancelAiTask,
    minimizeAiTask,
    unminimizeAiTask,
    pauseAiTask,
    resumeAiTask,
    isAiTaskPaused,
    updateAiTaskProgress,
    registerManualTask,
    finalizeManualTask,
    startChapterStateSync,
    getChapterStateWarnings,
    dismissChapterStateWarnings,
    getChapterPostGenerationIssues,
    dismissChapterPostGenerationIssues
  }
})
