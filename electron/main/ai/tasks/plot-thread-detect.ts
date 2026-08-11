import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, PlotThreadDetectResult, PlotThreadDetectEntry } from '../shared-types'

/** 伏笔检测任务：从章节正文中识别伏笔、悬念和潜在剧情钩子 */
const handler: TaskHandler = {
  name: 'plot-thread-detect',
  outputType: 'json',
  defaultCapabilities: ['settings', 'chapters', 'analysis'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const existingThreads = Array.isArray(context.existingThreads) ? context.existingThreads : []
    const existingList = existingThreads.length ? existingThreads.map((t: unknown) => `- ${String(t)}`).join('\n') : '（暂无）'
    return {
      system: `${capabilityPreamble.system}\n\n你是专业小说编辑，擅长识别正文中的伏笔、未解悬念和潜在剧情钩子。请只返回 JSON 对象，不要返回 Markdown 或多余文字。字段必须包含 entries 数组。`,
      user: `${capabilityPreamble.user}\n\n请分析以下章节正文，识别其中明确埋下或潜在的伏笔与悬念。\n\n章节标题：${String(context.chapterTitle ?? '')}\n\n正文内容：\n${String(context.chapterContent ?? '')}\n\n已有线索（请勿重复）：\n${existingList}\n\n要求：\n1. 只识别正文中真实存在的伏笔或悬念\n2. 每条线索给出简洁标题（≤20字）、详细描述（≤80字）和 1-3 个关联标签\n3. 最多返回 6 条\n4. 按重要程度从高到低排列\n\n返回格式：{"entries":[{"title":"","description":"","tags":[]}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<PlotThreadDetectResult>
    const entries = Array.isArray(parsed.entries) ? parsed.entries.slice(0, 6).map((e) => {
      const entry = e as Partial<PlotThreadDetectEntry>
      const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 3) : []
      return { title: entry.title?.trim() || '未命名伏笔', description: entry.description?.trim() || '暂无描述', tags }
    }) : []
    return { entries } as PlotThreadDetectResult
  },
  validate(result: AiTaskResult): boolean {
    return (result as PlotThreadDetectResult).entries.length > 0
  }
}
export default handler
