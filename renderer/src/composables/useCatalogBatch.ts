import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AiTaskKind } from '@/features/ai/taskRegistry'

export type CatalogBatchMode = 'character' | 'organization' | 'relationship' | 'membership' | 'worldview' | 'inspiration' | 'plot-thread'
export type CatalogBatchEntry = Record<string, unknown>

export function normalizeCatalogTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((tag) => {
      if (tag && typeof tag === 'object') {
        return String((tag as Record<string, unknown>).label ?? '').trim()
      }
      return String(tag ?? '').trim()
    })
    .filter((tag) => tag && tag !== '[object Object]')
    .slice(0, 4)
}

interface CatalogBatchOptions {
  mode: CatalogBatchMode
  count: number
  label: string
  panel: string
  kind: AiTaskKind
  context: Record<string, unknown>
  existingKeys?: string[]
  keyField?: 'name' | 'title'
  onProgress?: (completed: number, total: number) => void
}

/** 批量并行度下限：同时并发至少多少个 AI 批次请求。 */
const BATCH_CONCURRENCY_MIN = 3
/** 批量并行度上限：避免一次性打爆单一 provider 的请求配额。并发越高提速越快，适度放宽到 8。 */
const BATCH_CONCURRENCY_MAX = 8

/** 单批最大条目数（与后端 catalog-batch 任务单批上限保持一致） */
const BATCH_SIZE = 10

/**
 * 按批次数量自适应并发度：任务越多并发越高，显著缩短整体耗时；
 * 但收敛到上限，避免打爆 provider 请求配额或本地出口带宽。
 */
function resolveConcurrency(batchCount: number): number {
  if (batchCount <= 1) return 1
  // 系数 0.8 让并发随批次更快爬升：8 批即达 7、10 批即封顶 8，提速明显。
  return Math.max(BATCH_CONCURRENCY_MIN, Math.min(BATCH_CONCURRENCY_MAX, Math.ceil(batchCount * 0.8)))
}

/**
 * 批量生成的取消控制器表（按 mode 索引）。
 * 用户点击"叉号"中断时，会 abort 对应控制器的信号并主动向主进程取消运行中的请求。
 */
const batchAbortControllers = new Map<string, AbortController>()
/** 各模式已启动批次的主进程 clientTaskId 集合，用于中断时主动取消底层请求。 */
const batchClientIds = new Map<string, Set<string>>()

/** 取消某个模式的批量生成任务（用于对话框"叉号=中断"）。 */
export function cancelCatalogBatch(mode: CatalogBatchMode): void {
  const controller = batchAbortControllers.get(mode)
  if (controller) controller.abort()
  // 主动向主进程取消所有已启动批次的底层请求，让 AI 生成立刻停止。
  const clientIds = batchClientIds.get(mode)
  if (clientIds) {
    clientIds.forEach((id) => {
      if (id) void window.characterArc.cancelAiTask(id).catch(() => {})
    })
  }
}

export function useCatalogBatch() {
  const appStore = useAppStore()

  /**
   * 以受限并发的方式并行执行一批异步任务，显著缩短多批次总耗时。
   * 每完成一个任务会回调 onTaskDone(index)，供调用方实时上报进度。
   */
  async function runBoundedConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    concurrency: number,
    onTaskDone?: (finishedIndex: number) => void
  ): Promise<T[]> {
    const results: T[] = new Array(tasks.length)
    let cursor = 0
    async function worker(): Promise<void> {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= tasks.length) return
        results[index] = await tasks[index]()
        onTaskDone?.(index)
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
    await Promise.all(workers)
    return results
  }

  async function generateCatalogBatch(options: CatalogBatchOptions): Promise<CatalogBatchEntry[]> {
    // 总数量不再设硬上限：仅在用户输入异常时做下限兜底，支持任意批量生成规模
    const total = Math.max(1, Math.floor(options.count))
    const keyField = options.keyField
    const knownKeys = new Set((options.existingKeys ?? []).map((key) => key.trim().toLowerCase()).filter(Boolean))
    const taskKey = `catalog-batch:${options.mode}`
    const allTargets = Array.isArray(options.context.targets) ? options.context.targets : null

    // 注册本模式的取消控制器，供对话框"叉号=中断"时 abort。
    const controller = new AbortController()
    batchAbortControllers.set(options.mode, controller)
    const signal = controller.signal
    // 记录已启动批次的主进程 clientTaskId，用于中断时主动取消底层请求。
    const runningClientIds = new Set<string>()
    batchClientIds.set(options.mode, runningClientIds)

    // 每次启动一个批次并返回该批新增的、去重后仍未被占用的条目。
    // 使用递增的跟踪 key，避免 runTrackedAiTask 同 key 互斥导致并行失败；
    // 首批发沿用规范 key，保证面板的 isAiTaskRunning(catalog-batch:xxx) 加载态生效。
    let runSeq = 0
    const nextRunKey = (): string => {
      runSeq += 1
      return runSeq === 1 ? taskKey : `${taskKey}#${runSeq}`
    }

    // 全局已确认占用的唯一 key（既有 + 本次已产出），用于跨批次避重。
    const usedKeys = new Set(knownKeys)

    async function runOneBatch(batchCount: number, runKey: string, description: string): Promise<CatalogBatchEntry[]> {
      if (signal.aborted) throw new Error('任务已中断。')
      const batchContext = allTargets
        ? {
            ...options.context,
            targets: allTargets.slice(0, batchCount)
          }
        : options.context
      const response = await appStore.runTrackedAiTask(
        {
          key: runKey,
          kind: options.kind,
          label: options.label,
          description,
          panel: options.panel,
        },
        () => {
          const clientTaskId = appStore.getClientTaskId()
          if (clientTaskId) runningClientIds.add(clientTaskId)
          return window.characterArc.generateAi(toIpcPayload({
            task: 'catalog-batch',
            clientTaskId: appStore.getClientTaskId(),
            clientKey: runKey,
            settings: appStore.appSettings,
            context: {
              ...batchContext,
              projectId: appStore.currentProject?.id,
              mode: options.mode,
              count: batchCount,
              existingNames: [...usedKeys]
            }
          }))
        }
      )

      if (!response.success || !response.result) {
        throw new Error(response.error ?? `${options.label}失败`)
      }
      return (response.result as { entries?: CatalogBatchEntry[] }).entries ?? []
    }

    // 收集所有已确认生成的条目（跨批次去重后按顺序追加）。
    const entries: CatalogBatchEntry[] = []

    // 消化一批返回的原始条目：按唯一 key 去重后追加到结果，直到达到总量。
    function absorb(resultEntries: CatalogBatchEntry[]): void {
      for (const entry of resultEntries) {
        if (entries.length >= total) break
        if (keyField) {
          const key = String(entry[keyField] ?? '').trim().toLowerCase()
          if (!key || usedKeys.has(key)) continue
          usedKeys.add(key)
        }
        entries.push(entry)
      }
    }

    async function runBatches(): Promise<CatalogBatchEntry[]> {
      // 预先规划各批次：每个批次拿到固定的条目数，互不依赖，可安全并行。
      const initialBatchCounts: number[] = []
      let remaining = total
      while (remaining > 0) {
        const count = Math.min(BATCH_SIZE, remaining)
        initialBatchCounts.push(count)
        remaining -= count
      }

      // 记录已启动过的批次 key，用于统一刷新进度。
      const launchedRunKeys: string[] = []

      // 并行执行第一批规划的所有批次。
      await runBoundedConcurrency(
        initialBatchCounts.map((batchCount, batchIndex) => {
          const runKey = nextRunKey()
          launchedRunKeys.push(runKey)
          const description = `正在生成 ${batchIndex * BATCH_SIZE + 1}-${batchIndex * BATCH_SIZE + batchCount} / ${total}`
          return async () => {
            const batchEntries = await runOneBatch(batchCount, runKey, description)
            absorb(batchEntries)
            // 每个批次完成即上报一次进度，保持进度条实时推进。
            const percent = Math.round((Math.min(entries.length, total) / total) * 100)
            options.onProgress?.(Math.min(entries.length, total), total)
            launchedRunKeys.forEach((key) => {
              const run = appStore.getAiTaskRun(key)
              if (run && run.stage === 'running') {
                appStore.updateAiTaskProgress(key, percent)
              }
            })
          }
        }),
        resolveConcurrency(initialBatchCounts.length)
      )

      // 若首批产出（去重后）仍不足总量，则自动补充生成直到凑齐精确数量。
      // 限制最大补充轮次，避免 AI 持续产出重复/空条时无限循环。
      const MAX_BACKFILL_ROUNDS = 6
      let backfillRound = 0
      while (entries.length < total && backfillRound < MAX_BACKFILL_ROUNDS) {
        backfillRound += 1
        const shortfall = total - entries.length
        const batchCount = Math.min(BATCH_SIZE, shortfall)
        const runKey = nextRunKey()
        launchedRunKeys.push(runKey)
        const description = `正在补齐生成 ${entries.length + 1}-${total} / ${total}`
        const batchEntries = await runOneBatch(batchCount, runKey, description)
        absorb(batchEntries)
        options.onProgress?.(Math.min(entries.length, total), total)
        // 让进度面板里的已运行批次统一收敛到当前进度
        launchedRunKeys.forEach((key) => {
          const run = appStore.getAiTaskRun(key)
          if (run && run.stage === 'running') {
            appStore.updateAiTaskProgress(key, Math.round((Math.min(entries.length, total) / total) * 100))
          }
        })
      }

      options.onProgress?.(entries.length, total)

      return entries
    }

    try {
      return await runBatches()
    } finally {
      // 任务结束（无论成功、失败或被中断）都要清理控制器，避免影响下一次生成。
      batchAbortControllers.delete(options.mode)
      batchClientIds.delete(options.mode)
    }
  }

  return { generateCatalogBatch }
}
