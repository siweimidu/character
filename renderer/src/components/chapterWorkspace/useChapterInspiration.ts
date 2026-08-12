import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { buildStyleContextWithBoundSkills } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const TASK_KEY = 'chapter-inspiration'

export const CHAPTER_INSPIRATION_FOCUSES = ['场景火花', '剧情转折', '人物动机'] as const
export type ChapterInspirationFocus = (typeof CHAPTER_INSPIRATION_FOCUSES)[number]

interface InspirationPackResult {
  entries?: Array<{
    type?: string
    title?: string
    content?: string
    tags?: string[]
  }>
}

export function useChapterInspiration(): {
  isGenerating: ComputedRef<boolean>
  generate: (focus: ChapterInspirationFocus) => Promise<{ ok: boolean; reason?: string; count?: number }>
} {
  const appStore = useAppStore()
  const isGenerating = computed(() => appStore.isAiTaskRunning(TASK_KEY))

  async function generate(focus: ChapterInspirationFocus): Promise<{ ok: boolean; reason?: string; count?: number }> {
    const chapter = appStore.selectedChapter
    if (!chapter) return { ok: false, reason: '请先选择一个章节' }
    if (isGenerating.value) return { ok: false, reason: '已在生成灵感' }

    try {
      const writingStyle = await buildStyleContextWithBoundSkills(appStore.currentProject)
      const result = await appStore.runTrackedAiTask(
        {
          key: TASK_KEY,
          kind: 'inspiration',
          label: 'AI 生成本章灵感',
          description: `正在为《${chapter.title}》生成「${focus}」灵感卡片`,
          panel: 'chapters'
        },
        () =>
          window.characterArc.generateAi(toIpcPayload({
            task: 'inspiration-pack',
            settings: appStore.appSettings,
            context: {
              projectTitle: appStore.currentProject?.title,
              projectGenre: appStore.currentProject?.genre,
              writingStyleLabel: writingStyle.label,
              writingStylePrompt: writingStyle.promptWithSkills,
              chapterTitle: chapter.title,
              chapterSummary: chapter.summary,
              chapterContent: getPlainTextFromEditorContent(chapter.content ?? ''),
              focusType: focus,
              existingInspirationTitles: appStore.inspirationEntries.map((entry) => entry.title),
              worldviewEntries: appStore.worldviewEntries,
              characters: appStore.characters,
              organizations: appStore.organizations,
              characterRelationships: appStore.characterRelationships,
              organizationMemberships: appStore.organizationMemberships,
              outlineItems: appStore.outlineItems
            }
          }))
      )

      if (!result.success || !result.result) {
        return { ok: false, reason: result.error ?? '本章灵感生成失败' }
      }

      const payload = result.result as InspirationPackResult
      const entries = Array.isArray(payload.entries) ? payload.entries : []
      if (!entries.length) {
        return { ok: false, reason: 'AI 没有返回有效灵感卡片' }
      }

      entries.forEach((entry, index) => {
        appStore.createInspirationEntry({
          type: entry.type ?? focus,
          title: entry.title ?? `${focus} ${index + 1}`,
          content: entry.content ?? 'AI 未返回有效灵感内容',
          tags: entry.tags ?? [],
          source: 'ai'
        })
      })

      return { ok: true, count: entries.length }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : '本章灵感生成失败' }
    }
  }

  return { isGenerating, generate }
}
