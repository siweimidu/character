import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const TASK_KEY = 'chapter-summary'

export function useChapterSummary(): {
  isGenerating: ComputedRef<boolean>
  generate: () => Promise<{ ok: boolean; reason?: string; summary?: string }>
} {
  const appStore = useAppStore()
  const isGenerating = computed(() => appStore.isAiTaskRunning(TASK_KEY))

  async function generate(): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const chapter = appStore.selectedChapter
    if (!chapter) return { ok: false, reason: '请先选择一个章节' }
    if (isGenerating.value) return { ok: false, reason: '已在生成摘要' }

    const plainContent = getPlainTextFromEditorContent(chapter.content ?? '').trim()
    if (!plainContent) return { ok: false, reason: '当前章节没有正文内容，无法生成摘要' }

    try {
      const result = await appStore.runTrackedAiTask(
        {
          key: TASK_KEY,
          kind: 'chapter-summary',
          label: 'AI 生成章节摘要',
          description: `为《${chapter.title}》提炼摘要`,
          panel: 'chapters',
        },
        () =>
          window.characterArc.generateAi(toIpcPayload({
            clientTaskId: appStore.getClientTaskId(),
            task: 'chapter-summarize',
            settings: appStore.appSettings,
            context: {
              chapterTitle: chapter.title,
              chapterContent: plainContent
            }
          }))
      )

      if (!result.success) {
        return { ok: false, reason: result.error ?? 'AI 摘要生成失败' }
      }

      const summaryText = String(
        result.result && typeof result.result === 'object'
          ? (result.result as Record<string, unknown>).content ?? ''
          : ''
      ).trim()

      if (!summaryText) {
        return { ok: false, reason: 'AI 返回了空摘要' }
      }

      appStore.updateChapter(chapter.id, { summary: summaryText })
      return { ok: true, summary: summaryText }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'AI 摘要生成失败' }
    }
  }

  return { isGenerating, generate }
}
