import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, PlotThreadDetectResult, PlotThreadDetectEntry } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import {
  formatWorldviewEntries,
  formatCharacters,
  formatOrganizations,
  formatCharacterRelationships,
  formatOpenPlotThreads,
  formatOutlineItems
} from '../prompts/format-helpers'

/** 伏笔批量生成任务：基于当前大纲/角色/世界观/已有线索，批量补充 3-6 条新伏笔与悬念 */
const handler: TaskHandler = {
  name: 'plot-thread-batch',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'outline', 'worldview', 'characters', 'relations', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const focus = String(context.focus ?? '').trim()
    // 支持批量生成数量设置（不再设硬上限，仅做合理上限兜底避免单次输出过大）
    const count = Math.max(1, Math.min(50, Number(context.count) || 5))
    return {
      system: `${capabilityPreamble.system}\n\n你是专业小说伏笔与悬念规划师。请基于当前项目已有大纲、角色、世界观和关系，批量设计相互衔接的伏笔与悬念。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 entries，entries 中每项都必须包含 title、description、tags。`,
      user: `${capabilityPreamble.user}\n\n请为当前小说项目批量设计伏笔、悬念、未解之局，直接可写入"伏笔线索"列表。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n\n重点方向（若为空则由你根据项目自行选择最合适的延展方向）：${focus || '延续当前大纲与已有人物的自然走向'}\n\n相关世界观：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n相关组织：\n${formatOrganizations(context.organizations) || '暂无'}\n\n角色关系：\n${formatCharacterRelationships(context.characterRelationships, context.characters) || '暂无'}\n\n当前大纲：\n${formatOutlineItems(context.outlineItems) || '暂无'}\n\n已有线索（请勿重复，且新线索要与它们形成呼应或延展）：\n${formatOpenPlotThreads(context.existingThreads) || '（暂无）'}\n\n要求：\n1. entries 返回 ${count} 条线索（精确 ${count} 条），按重要程度从高到低排列\n2. 每条 title ≤ 20 字，description 40 到 120 字，tags 返回 1 到 3 个关联标签（角色名、地点、物品等）\n3. 线索必须锚定在上面的角色、世界观或大纲之上，不能凭空出现\n4. 线索之间、与已有线索之间要能形成伏笔—回收的呼应，避免散点\n5. 覆盖不同维度：至少包含一个与"身份/身世"相关的悬念、一个与"势力冲突"相关的悬念\n6. 尽量埋设中长期钩子，为后续分卷留出展开空间\n7. ${writingStyle}\n\n返回格式：{"entries":[{"title":"","description":"","tags":[""]}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<PlotThreadDetectResult>
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.slice(0, 50).map((e) => {
          const entry = e as Partial<PlotThreadDetectEntry>
          const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 3) : []
          return { title: entry.title?.trim() || '未命名伏笔', description: entry.description?.trim() || '暂无描述', tags }
        })
      : []
    return { entries } as PlotThreadDetectResult
  },
  validate(result: AiTaskResult): boolean {
    return (result as PlotThreadDetectResult).entries.length > 0
  }
}
export default handler
