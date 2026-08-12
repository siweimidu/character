import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AiTaskKind } from '@/features/ai/taskRegistry'

export type CatalogBatchMode = 'character' | 'organization' | 'relationship' | 'membership' | 'worldview' | 'inspiration'
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

/** 批量并行度：同时并发不超过 3 个 AI 批次请求，避免打爆单一 provider 的请求配额 */
const BATCH_CONCURRENCY = 3

/** 灵感模式专用并发度：灵感生成是轻量任务，可安全提高到 5 并发以显著提升速度 */
const INSPIRATION_CONCURRENCY = 5

/** 单批最大条目数（与后端 catalog-batch 任务单批上限保持一致） */
const BATCH_SIZE = 10

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
    const total = Math.max(1, Math.min(100, Math.floor(options.count)))
    const keyField = options.keyField
    const knownKeys = new Set((options.existingKeys ?? []).map((key) => key.trim().toLowerCase()).filter(Boolean))
    const taskKey = `catalog-batch:${options.mode}`
    const allTargets = Array.isArray(options.context.targets) ? options.context.targets : null

    // 预先规划各批次：每个批次拿到固定的条目数与目标切片，互不依赖，可安全并行。
    const batchCounts: number[] = []
    let remaining = total
    while (remaining > 0) {
      const count = Math.min(BATCH_SIZE, remaining)
      batchCounts.push(count)
      remaining -= count
    }

    let finishedBatches = 0
    const effectiveConcurrency = options.mode === 'inspiration' ? INSPIRATION_CONCURRENCY : BATCH_CONCURRENCY
    const rawResults = await runBoundedConcurrency(
      batchCounts.map((batchCount, batchIndex) => {
        // 各并发批次使用不同的跟踪 key，避免 runTrackedAiTask 同 key 互斥导致并行失败。
        // 首批发改沿用规范 key，保证面板的 isAiTaskRunning(catalog-batch:xxx) 加载态生效。
        const runKey = batchIndex === 0 ? taskKey : `${taskKey}#${batchIndex + 1}`
        return async () => {
          const batchContext = allTargets
            ? {
                ...options.context,
                targets: allTargets.slice(batchIndex * BATCH_SIZE, batchIndex * BATCH_SIZE + batchCount)
              }
            : options.context
          const description = `正在生成 ${batchIndex * BATCH_SIZE + 1}-${batchIndex * BATCH_SIZE + batchCount} / ${total}`
          const response = await appStore.runTrackedAiTask(
            {
              key: runKey,
              kind: options.kind,
              label: options.label,
              description,
              panel: options.panel,
            },
            () => window.characterArc.generateAi(toIpcPayload({
              task: 'catalog-batch',
              clientKey: runKey,
              settings: appStore.appSettings,
              context: {
                ...batchContext,
                projectId: appStore.currentProject?.id,
                mode: options.mode,
                count: batchCount,
                existingNames: [...knownKeys]
              }
            }))
          )

          if (!response.success || !response.result) {
            throw new Error(response.error ?? `${options.label}失败`)
          }
          return (response.result as { entries?: CatalogBatchEntry[] }).entries ?? []
        }
      }),
      effectiveConcurrency,
      // 每个批次完成即上报一次进度（按完成批次数估算），保持进度条实时推进。
      () => {
        finishedBatches += 1
        const completed = Math.min(total, finishedBatches * BATCH_SIZE)
        options.onProgress?.(completed, total)
      }
    )

    // 全部批次完成后统一去重，保持最终结果顺序稳定。
    const entries: CatalogBatchEntry[] = []
    for (const resultEntries of rawResults) {
      for (const entry of resultEntries) {
        if (entries.length >= total) break
        if (keyField) {
          const key = String(entry[keyField] ?? '').trim().toLowerCase()
          if (!key || knownKeys.has(key)) continue
          knownKeys.add(key)
        }
        entries.push(entry)
      }
    }
    options.onProgress?.(entries.length, total)

    return entries
  }

  return { generateCatalogBatch }
}
