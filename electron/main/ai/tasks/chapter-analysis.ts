import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, ChapterAnalysisResult } from '../shared-types'
import { formatWorldviewEntries, formatCharacters, formatOrganizations, formatCharacterRelationships, formatOrganizationMemberships, formatOutlineItems } from '../prompts/format-helpers'

/**
 * 将未知值标准化为字符串数组，最多取前 5 项
 * @param value - 待标准化的值
 * @param fallback - 值无效时的默认数组
 * @returns 字符串数组
 */
function toList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const normalized = value.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
  return normalized.length ? normalized : fallback
}

/** 章节分析任务：对当前章节进行写作质量分析并输出优化建议 */
const handler: TaskHandler = {
  name: 'chapter-analysis',
  outputType: 'json',
  defaultCapabilities: ['settings', 'chapters', 'analysis', 'worldview', 'characters', 'relations', 'outline', 'versioning'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    return {
      system: `${capabilityPreamble.system}\n\n你是小说章节分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、pacing、tension、continuity、highlights、risks、revisionActions。`,
      user: `${capabilityPreamble.user}\n\n请分析当前章节的写作质量与可优化点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节实际字数：${String(context.chapterWordCount ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n相关世界观：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n相关组织：\n${formatOrganizations(context.organizations) || '暂无'}\n\n角色关系：\n${formatCharacterRelationships(context.characterRelationships, context.characters) || '暂无'}\n\n成员归属：\n${formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters) || '暂无'}\n\n相关大纲：\n${formatOutlineItems(context.outlineItems) || '暂无'}\n\n要求：\n1. overview 用 1 到 2 句话概括当前章节完成度、情绪和主要问题\n2. pacing / tension / continuity 都用一句中文短评\n3. highlights 返回 2 到 4 条\n4. risks 返回 2 到 4 条\n5. revisionActions 返回 3 到 5 条可执行的修改建议\n6. 输出务必紧贴当前正文\n\n返回格式：{"overview":"","pacing":"","tension":"","continuity":"","highlights":[""],"risks":[""],"revisionActions":[""]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<ChapterAnalysisResult>
    return {
      overview: parsed.overview?.trim() || '这一章已经形成基础场景与推进，但还需要进一步打磨。',
      pacing: parsed.pacing?.trim() || '节奏判断暂不稳定。',
      tension: parsed.tension?.trim() || '张力表达仍有提升空间。',
      continuity: parsed.continuity?.trim() || '连续性基本成立。',
      highlights: toList(parsed.highlights, ['章节已经建立了基本情境。']),
      risks: toList(parsed.risks, ['当前分析未提取到明确风险。']),
      revisionActions: toList(parsed.revisionActions, ['先挑一段关键正文重写。'])
    } as ChapterAnalysisResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as ChapterAnalysisResult
    return Boolean(r.overview?.trim() && r.highlights.length > 0 && r.risks.length > 0 && r.revisionActions.length > 0)
  }
}
export default handler
