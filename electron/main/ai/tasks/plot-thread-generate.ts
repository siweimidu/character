import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, PlotThreadDetectResult, PlotThreadDetectEntry } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { formatOpenPlotThreads, formatCharacters, formatWorldviewEntries } from '../prompts/format-helpers'

/** 单条伏笔生成任务：基于当前章节正文与项目设定，为"新建伏笔"弹窗生成一条可直接入库的伏笔 */
const handler: TaskHandler = {
  name: 'plot-thread-generate',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'chapters', 'worldview', 'characters', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const chapterContent = String(context.chapterContent ?? '').trim()
    const chapterTitle = String(context.chapterTitle ?? '')
    const hint = String(context.hint ?? '').trim()

    return {
      system: `${capabilityPreamble.system}\n\n你是专业小说伏笔与悬念规划师。请为当前章节埋设一条与正文自然衔接、能持续推进剧情的中长期伏笔。请只返回 JSON 对象，不要返回 Markdown。返回单个条目：{"title":"","description":"","tags":[]}`,
      user: `${capabilityPreamble.user}\n\n请为以下小说章节设计一条可直接写入"伏笔线索"的新伏笔/悬念。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n\n章节标题：${chapterTitle}\n\n当前章节正文：\n${chapterContent || '（暂无正文，可基于项目设定与大纲设计伏笔）'}\n\n用户补充方向（若有，请优先遵循）：${hint || '（无）'}\n\n已有线索（请勿重复，且新线索要与它们形成呼应或延展）：\n${formatOpenPlotThreads(context.existingThreads) || '（暂无）'}\n\n相关世界观：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n要求：\n1. 只返回 1 条伏笔，title ≤ 20 字，description 40 到 100 字，tags 返回 1 到 3 个关联标签\n2. 伏笔必须锚定在章节正文或上述角色/世界观之上，不能凭空出现\n3. 与已有线索避免重复，尽量埋设中长期钩子\n4. 为后续章节留下回收空间\n5. ${writingStyle}\n\n返回格式：{"title":"","description":"","tags":[]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<PlotThreadDetectEntry>
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 3) : []
    const entry: PlotThreadDetectEntry = {
      title: String(parsed.title ?? '').trim() || '未命名伏笔',
      description: String(parsed.description ?? '').trim() || '暂无描述',
      tags
    }
    return { entries: [entry] } as PlotThreadDetectResult
  },
  validate(result: AiTaskResult): boolean {
    return (result as PlotThreadDetectResult).entries.length > 0
  }
}
export default handler
