import { ref } from 'vue'
import type { Ref } from 'vue'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const TASK_KEY = 'plot-thread-detect'

export interface DetectedThread {
  title: string
  description: string
  tags: string[]
  selected: boolean
}

export function useChapterThreadDetect(): {
  detected: Ref<DetectedThread[]>
  modalVisible: Ref<boolean>
  isDetecting: Ref<boolean>
  detectChapterId: Ref<string | null>
  start: () => Promise<{ ok: boolean; reason?: string }>
  confirmAdd: () => number
  closeModal: () => void
} {
  const appStore = useAppStore()

  const detected = ref<DetectedThread[]>([])
  const modalVisible = ref(false)
  const detectChapterId = ref<string | null>(null)

  const isDetecting = ref(false)

  async function start(): Promise<{ ok: boolean; reason?: string }> {
    const chapter = appStore.selectedChapter
    if (!chapter) return { ok: false, reason: '请先选择一个章节' }
    if (isDetecting.value || appStore.isAiTaskRunning(TASK_KEY)) {
      return { ok: false, reason: '已在识别中' }
    }

    const plainText = getPlainTextFromEditorContent(chapter.content ?? '').trim()
    if (!plainText) return { ok: false, reason: '章节暂无正文，无法识别伏笔' }

    detectChapterId.value = chapter.id
    isDetecting.value = true

    try {
      const existingThreads = appStore.plotThreads
        .filter((t) => t.status === 'pending')
        .map((t) => t.title)

      const result = await appStore.runTrackedAiTask(
        {
          key: TASK_KEY,
          kind: 'plot-thread',
          label: 'AI 识别伏笔',
          description: `扫描《${chapter.title || '未命名章节'}》的潜在伏笔`,
          panel: 'chapters'
        },
        () =>
          window.characterArc.generateAi(toIpcPayload({
            task: 'plot-thread-detect',
            settings: appStore.appSettings,
            context: {
              chapterTitle: chapter.title || '未命名章节',
              chapterContent: plainText.slice(0, 6000),
              existingThreads
            }
          }))
      )

      if (!result.success) {
        return { ok: false, reason: result.error ?? 'AI 识别伏笔失败' }
      }

      const entries = Array.isArray((result.result as Record<string, unknown>)?.entries)
        ? ((result.result as Record<string, unknown>).entries as Array<Record<string, unknown>>)
        : []

      if (entries.length === 0) {
        return { ok: false, reason: 'AI 未在本章识别到明确伏笔' }
      }

      detected.value = entries.map((e) => ({
        title: String(e.title ?? '未命名伏笔'),
        description: String(e.description ?? '暂无描述'),
        tags: Array.isArray(e.tags) ? (e.tags as string[]).map(String) : [],
        selected: true
      }))
      modalVisible.value = true
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'AI 识别伏笔失败' }
    } finally {
      isDetecting.value = false
    }
  }

  function confirmAdd(): number {
    const chapterId = detectChapterId.value ?? ''
    const toAdd = detected.value.filter((t) => t.selected)
    if (!toAdd.length) return 0

    toAdd.forEach((t) => {
      appStore.createPlotThread({
        title: t.title,
        description: t.description,
        openedInChapterId: chapterId,
        status: 'pending',
        tags: t.tags
      })
    })
    modalVisible.value = false
    return toAdd.length
  }

  function closeModal(): void {
    modalVisible.value = false
  }

  return {
    detected,
    modalVisible,
    isDetecting,
    detectChapterId,
    start,
    confirmAdd,
    closeModal
  }
}
