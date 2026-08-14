/**
 * 全局 AI 生成作品结果弹窗 store。
 *
 * 背景：番茄风向标（AI 生成新书选题）与拆书知识库（AI 按拆书风格生成作品）
 *       的结果展示弹窗与"选择初始化方式"弹窗，原本都挂在各自页面组件内部。
 *       一旦用户切到别的页面，组件卸载 → 弹窗状态丢失，后台跑完的任务结果
 *       就看不到了。
 *
 * 解法：把"结果弹窗 + 初始化方式弹窗"的显示状态、候选数据、选中状态、构建参数
 *       集中登记到本全局 store。由挂载在 App 根布局的 GlobalAiGenerateModal.vue
 *       统一渲染，这样无论用户当前在项目工作台还是其他任何页面，任务完成时都能
 *       全局弹出对应悬浮窗，后续"生成作品/生成选中作品"也能全局弹出初始化方式弹窗。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import {
  createProjectWorkspaceSeed,
  createProjectWorkspaceSeedFromSpiral,
  type ProjectBootstrapResult,
  type ProjectWorkspaceSeed,
  type SpiralBootstrapResult
} from '@/features/wizard/projectSeed'
import type { NovelLength } from '@/types/app'

/** AI 生成结果中的单个候选方案（番茄选题 / 拆书作品共用同构字段）。 */
export interface GlobalAiCandidate {
  /** 拆书来源书名，仅拆书作品有；番茄选题为空串。 */
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

/** 来源类型：fanqie = 番茄风向标新书选题；knowledge = 拆书知识库新作品方案。 */
export type GlobalAiSource = 'fanqie' | 'knowledge'

/** 初始化方式：deep = 深度生成；quick = 快速生成；off = 空白项目。 */
export type InitMethod = 'deep' | 'quick' | 'off'

export const useGlobalAiGenerateStore = defineStore('globalAiGenerate', () => {
  const appStore = useAppStore()

  /** 当前要展示的全局弹窗来源（null 表示无弹窗）。 */
  const activeSource = ref<GlobalAiSource | null>(null)
  /** 结果弹窗是否可见（展示 AI 生成的新书选题 / 新作品方案）。 */
  const resultVisible = ref(false)
  /** 初始化方式弹窗是否可见。 */
  const initVisible = ref(false)

  /** 当前来源下的全部候选（含番茄多批次合并结果）。 */
  const candidates = ref<GlobalAiCandidate[]>([])
  /** 结果弹窗中用户勾选的下标集合。 */
  const selectedIndexes = ref<number[]>([])
  /** 后台仍在运行的批次数量（番茄多批次场景，用于提示）。 */
  const runningCount = ref(0)

  /** 待构建的候选（从结果弹窗勾选后写入，供初始化方式弹窗使用）。 */
  const pendingSeeds = ref<GlobalAiCandidate[]>([])

  // ── 初始化方式弹窗参数 ──
  const initMethod = ref<InitMethod>('deep')
  const initLength = ref<NovelLength>('long')
  const buildLoading = ref(false)
  const buildRunningCount = ref(0)

  const selectedCount = computed(() => selectedIndexes.value.length)
  const hasSelected = computed(() => selectedIndexes.value.length > 0)

  /** 请求打开番茄风向标“AI 生成新书选题”输入配置弹窗（供全局结果弹窗“换一批”触发）。 */
  const fanqieGeneratorRequest = ref(0)

  /** 最近一次番茄风向标生成新书选题所用的上下文，供“换一批”自动复用重新生成。 */
  const lastFanqieContext = ref<Record<string, unknown> | null>(null)
  /** “换一批”自动重新生成的并发保护计数。 */
  const regenRunningCount = ref(0)

  /** 由番茄风向标页面在每次生成前写入上下文，供“换一批”复用。 */
  function cacheFanqieContext(context: Record<string, unknown>): void {
    lastFanqieContext.value = context
  }

  /**
   * 全局结果弹窗点击“换一批”：不重新弹出输入配置弹窗，
   * 而是复用最近一次上下文在后台自动重新生成一批新书选题，
   * 完成后仍在任何页面全局弹出新的“AI 生成的新书选题”结果弹窗。
   */
  async function regenerateFanqieSeeds(): Promise<void> {
    const context = lastFanqieContext.value
    if (!context || regenRunningCount.value > 0) return
    regenRunningCount.value += 1
    resultVisible.value = false
    const taskKey = `fanqie-seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const result = await appStore.runTrackedAiTask(
        {
          key: taskKey,
          kind: 'inspiration',
          label: 'AI 生成新书选题',
          description: '正在根据榜单风向设计新书选题方案',
          panel: 'fanqie'
        },
        () =>
          window.characterArc.generateAi(
            toIpcPayload({
              clientTaskId: appStore.getClientTaskId(),
              task: 'fanqie-seed',
              settings: appStore.appSettings,
              context
            })
          )
      )
      if (!result.success || !result.result) {
        throw new Error(result.error ?? 'AI 生成新书选题失败')
      }
      const entries = Array.isArray((result.result as Record<string, unknown>)?.entries)
        ? ((result.result as Record<string, unknown>).entries as Array<Record<string, unknown>>)
        : []
      if (entries.length === 0) {
        throw new Error('AI 未返回有效的选题方案')
      }
      const newCandidates: GlobalAiCandidate[] = entries.map((e) => ({
        sourceTitle: '',
        title: String(e.title ?? '未命名选题'),
        concept: String(e.concept ?? ''),
        genre: String(e.genre ?? ''),
        hook: String(e.hook ?? ''),
        protagonist: String(e.protagonist ?? ''),
        goldFinger: String(e.goldFinger ?? ''),
        first3Hooks: Array.isArray(e.first3Hooks) ? (e.first3Hooks as string[]).map(String) : [],
        outline: String(e.outline ?? '')
      }))
      // 无论用户当前在哪个页面，都全局弹出新的“AI 生成的新书选题”结果弹窗
      openResult('fanqie', newCandidates, { running: 0 })
    } catch {
      resultVisible.value = false
    } finally {
      regenRunningCount.value -= 1
    }
  }

  /** 触发打开番茄输入配置弹窗（每次自增，供页面 watch）。 */
  function requestOpenFanqieGenerator(): void {
    resultVisible.value = false
    fanqieGeneratorRequest.value += 1
  }

  /** 打开某来源的结果弹窗，并写入候选与默认全选。 */
  function openResult(source: GlobalAiSource, cands: GlobalAiCandidate[], opts: { running?: number } = {}): void {
    activeSource.value = source
    candidates.value = cands
    selectedIndexes.value = cands.map((_, i) => i)
    runningCount.value = opts.running ?? 0
    initVisible.value = false
    resultVisible.value = true
  }

  /** 关闭结果弹窗（不清理候选，便于再次打开）。 */
  function closeResult(): void {
    resultVisible.value = false
  }

  /** 番茄"换一批"：重置候选与选中，仅保留后台正在运行的批次提示。 */
  function resetResult(cands: GlobalAiCandidate[] = [], running = 0): void {
    candidates.value = cands
    selectedIndexes.value = cands.map((_, i) => i)
    runningCount.value = running
  }

  /** 打开初始化方式弹窗（基于已勾选的候选）。 */
  function openInit(picked: GlobalAiCandidate[], method: InitMethod = 'deep', length: NovelLength = 'long'): void {
    pendingSeeds.value = picked
    initMethod.value = method
    initLength.value = length
    buildLoading.value = false
    resultVisible.value = false
    initVisible.value = true
  }

  /** 关闭初始化方式弹窗。 */
  function closeInit(): void {
    initVisible.value = false
  }

  /** 关闭所有弹窗。 */
  function closeAll(): void {
    resultVisible.value = false
    initVisible.value = false
  }

  /** 构建单个候选的 ProjectWorkspaceSeed（深度/快速/空白），番茄与拆书共用。 */
  async function buildCandidateWorkspace(
    candidate: GlobalAiCandidate,
    method: InitMethod,
    novelLength: NovelLength
  ): Promise<ProjectWorkspaceSeed> {
    const premise = [candidate.concept, candidate.hook, candidate.outline].filter(Boolean).join('\n')
    const wizardValues = {
      title: candidate.title,
      genre: candidate.genre || '都市',
      novelLength,
      premise,
      shouldGenerate: method !== 'off'
    }

    if (method === 'deep') {
      const result = await window.characterArc.spiralBootstrap(
        toIpcPayload({
          settings: appStore.appSettings,
          projectTitle: candidate.title,
          projectGenre: candidate.genre || '都市',
          projectNovelLength: novelLength,
          projectPremise: premise
        })
      )
      if (!result.success || !result.result) {
        throw new Error(result.error ?? `「${candidate.title}」深度生成失败`)
      }
      return createProjectWorkspaceSeedFromSpiral(wizardValues, result.result as SpiralBootstrapResult)
    }

    if (method === 'quick') {
      const result = await window.characterArc.generateAi(
        toIpcPayload({
          task: 'project-bootstrap',
          settings: appStore.appSettings,
          context: {
            projectTitle: candidate.title,
            projectGenre: candidate.genre || '都市',
            projectNovelLength: novelLength,
            projectPremise: premise
          }
        })
      )
      if (!result.success || !result.result) {
        throw new Error(result.error ?? `「${candidate.title}」快速生成失败`)
      }
      return createProjectWorkspaceSeed(wizardValues, result.result as ProjectBootstrapResult)
    }

    // 空白项目：直接创建骨架
    return createProjectWorkspaceSeed(wizardValues)
  }

  /**
   * 用户选定初始化方式后，在后台自动为所有勾选的作品创建项目。
   * 全程在全局执行，不依赖页面组件存活，切页也能继续构建。
   */
  async function confirmInitAndBuild(): Promise<void> {
    if (buildLoading.value) return
    const seeds = pendingSeeds.value
    if (seeds.length === 0) return
    buildLoading.value = true
    initVisible.value = false

    const method = initMethod.value
    const novelLength = initLength.value
    const methodLabel = method === 'deep' ? '深度生成' : method === 'quick' ? '快速生成' : '空白项目'
    const source = activeSource.value
    const panel = source === 'fanqie' ? 'fanqie' : 'knowledge'
    const buildTaskKey = source === 'fanqie'
      ? `fanqie-build-works-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      : 'knowledge-build-works'

    buildRunningCount.value += 1
    try {
      await appStore.runTrackedAiTask(
        {
          key: buildTaskKey,
          kind: 'workflow',
          label: `创建 ${seeds.length} 个作品`,
          description: `${methodLabel} · 后台自动创建 ${seeds.length} 个新书项目`,
          panel,
          onCancel: () => {
            // 深度生成支持通过 IPC 取消
            void window.characterArc.cancelSpiralBootstrap()
          }
        },
        async () => {
          const workspaceSeeds: ProjectWorkspaceSeed[] = []
          // 逐个生成，每个完成后立即反馈进度
          for (let i = 0; i < seeds.length; i++) {
            const seed = seeds[i]
            const ws = await buildCandidateWorkspace(seed, method, novelLength)
            workspaceSeeds.push(ws)
            appStore.updateAiTaskProgress(buildTaskKey, Math.round(((i + 1) / seeds.length) * 100))
          }
          // 全部生成完成后批量创建项目
          appStore.batchCreateProjects(workspaceSeeds)
        }
      )
    } catch {
      // 构建失败反馈由 runTrackedAiTask 内部/全局进度面板处理；此处不重复弹错误
    } finally {
      buildRunningCount.value -= 1
      buildLoading.value = false
    }
  }

  return {
    activeSource,
    resultVisible,
    initVisible,
    candidates,
    selectedIndexes,
    selectedCount,
    hasSelected,
    runningCount,
    pendingSeeds,
    initMethod,
    initLength,
    buildLoading,
    buildRunningCount,
    openResult,
    closeResult,
    resetResult,
    openInit,
    closeInit,
    closeAll,
    confirmInitAndBuild,
    fanqieGeneratorRequest,
    requestOpenFanqieGenerator,
    cacheFanqieContext,
    regenerateFanqieSeeds,
    lastFanqieContext,
    regenRunningCount
  }
})
