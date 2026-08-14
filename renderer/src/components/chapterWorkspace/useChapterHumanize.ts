import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { buildChapterAssistantContext, buildOutlineItemContext } from '@/features/ai/chapterAssistantContext'
import { getResolvedChapterAssistantTemplates } from '@/features/ai/chapterAssistantOptions'
import { getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const TASK_KEY = 'chapter-humanize'
const ACTION_ID = 'humanize-ai'

export function useChapterHumanize(): {
  isRunning: ComputedRef<boolean>
  hasSelection: ComputedRef<boolean>
  run: () => Promise<{ ok: boolean; reason?: string }>
} {
  const appStore = useAppStore()
  const isRunning = computed(() => appStore.isAiTaskRunning(TASK_KEY))
  const hasSelection = computed(() =>
    Boolean(
      appStore.currentChapterSelection?.chapterId === appStore.selectedChapter?.id
      && appStore.currentChapterSelection?.text.trim()
    )
  )

  async function run(): Promise<{ ok: boolean; reason?: string }> {
    const chapter = appStore.selectedChapter
    if (!chapter) return { ok: false, reason: '请先选择一个章节' }
    if (isRunning.value) return { ok: false, reason: '已在运行降低 AI 感' }

    const selectedText = appStore.currentChapterSelection?.text.trim() ?? ''
    if (!selectedText) return { ok: false, reason: '请先在正文中选中要处理的段落' }

    const action = getResolvedChapterAssistantTemplates(appStore.currentProject).find((t) => t.id === ACTION_ID)
    if (!action) return { ok: false, reason: '未找到降低 AI 感模板' }

    try {
      const response = await appStore.runTrackedAiTask(
        {
          key: TASK_KEY,
          kind: 'chapter-assistant',
          label: '降低 AI 感润色',
          description: '正在对选中文本做人化改写',
          panel: 'chapters',
        },
        async () => {
          const projectSkills = await loadEnabledProjectSkillsContext(appStore.currentProject, 'draft')
          const sameVolume = appStore.chapters.filter((item) => item.volumeId === chapter.volumeId)
          const volumeOutlineItems = appStore.outlineItems.filter((item) => item.volumeId === chapter.volumeId)
          const currentOutlineItem = chapter.outlineItemId
            ? volumeOutlineItems.find((item) => item.id === chapter.outlineItemId)
            : volumeOutlineItems.find((item) => item.title.trim() === chapter.title.trim())
          const context = buildChapterAssistantContext({
            project: appStore.currentProject,
            chapter,
            chapterVolume: appStore.selectedChapterVolume,
            relatedChapters: sameVolume
              .filter((item) => item.id !== chapter.id)
              .slice(0, 2)
              .map((item) => ({
                title: item.title,
                summary: item.summary,
                preview: getChapterPreviewText(item.content, '该章节暂无正文')
              })),
            volumeChapterSummaries: sameVolume
              .filter((item) => item.id !== chapter.id)
              .map((item) => ({ title: item.title, summary: item.summary })),
            novelOpenerSummary:
              appStore.chapters[0] && appStore.chapters[0].id !== chapter.id
                ? { title: appStore.chapters[0].title, summary: appStore.chapters[0].summary }
                : undefined,
            recentMessages: [],
            worldviewEntries: appStore.worldviewEntries,
            characters: appStore.characters,
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            inspirationEntries: appStore.inspirationEntries,
            outlineItems: appStore.outlineItems,
            plotThreads: appStore.plotThreads,
            workflowDocuments: appStore.workflowDocuments,
            knowledgeDocuments: appStore.knowledgeDocuments,
            currentOutlineItem: buildOutlineItemContext(currentOutlineItem, {
              characters: appStore.characters,
              organizations: appStore.organizations,
              worldviewEntries: appStore.worldviewEntries
            }),
            selectedText,
            responseMode: action.mode,
            responseLength: action.length,
            quickAction: action.label,
            userPrompt: action.prompt,
            chapterContent: getPlainTextFromEditorContent(chapter.content ?? ''),
            projectSkills
          })
          return window.characterArc.generateAi(toIpcPayload({
            clientTaskId: appStore.getClientTaskId(),
            task: 'chapter-assistant',
            settings: appStore.appSettings,
            context
          }))
        }
      )

      const revisedContent = String(
        (response.result as { content?: string } | undefined)?.content ?? ''
      ).trim()
      if (!response.success || !revisedContent) {
        return { ok: false, reason: response.error ?? 'AI 未返回可用的去 AI 味结果' }
      }

      const inserted = appStore.insertIntoChapter(revisedContent, 'replace-selection')
      if (!inserted) return { ok: false, reason: '写入正文失败' }
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : '降低 AI 感失败' }
    }
  }

  return { isRunning, hasSelection, run }
}
