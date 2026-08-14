import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject, jsonStringField } from './base'
import type { AiTaskResult, PromptGenerateResult, PromptGenerateEntry } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'

/**
 * 提示词库 AI 生成任务：按用户设定生成一批适合小说写作的提示词模板。
 *
 * 用户可在提示词库中点击「AI 生成」，设定生成数量、提示词要求（可选），
 * 或勾选随机生成。所有生成结果都是用于小说写作、创作场景的提示词，
 * 可直接保存进提示词库。
 */
const handler: TaskHandler = {
  name: 'prompt-generate',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)

    // 解析生成数量（1-20 之间做归一）
    const rawCount = Number(context.count ?? 5)
    const count = Number.isFinite(rawCount) ? Math.min(20, Math.max(1, Math.floor(rawCount))) : 5
    const requirement = String(context.requirement ?? '').trim()
    const random = Boolean(context.random)
    const genre = String(context.projectGenre ?? '').trim()
    const title = String(context.projectTitle ?? '').trim()

    const requirementBlock = requirement
      ? `\n用户补充要求（必须遵循）：\n${requirement}`
      : ''
    const randomHint = random
      ? '\n当前为随机生成模式：请自由发挥，随机选取小说写作的不同方向（如开篇、扩写、润色、对话、伏笔、节奏、角色塑造、剧情转折、氛围渲染等），避免与内置模板重复。'
      : ''
    const genreHint = genre ? `\n项目题材：${genre}` : ''
    const titleHint = title ? `\n项目标题：${title}` : ''

    return {
      system: `${capabilityPreamble.system}\n\n你是小说写作提示词生成专家。你的职责是设计高质量、可直接使用的写作提示词模板，供作家在写作智能体中套用。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 entries，entries 中每一项都必须包含 title、content、tags、remark。`,
      user: `${capabilityPreamble.user}\n\n请为小说写作场景生成一批写作提示词模板，每条都是面向"小说写作/创作"的提示词，与写小说密切相关，例如：段落扩写、文字润色、对话场景搭建、伏笔埋设、章节大纲推演、开篇黄金三章、节奏把控、氛围渲染、人物动机挖掘、剧情转折设计等。${titleHint}${genreHint}${requirementBlock}${randomHint}\n\n请生成 ${count} 条提示词。\n\n要求：\n1. entries 必须恰好返回 ${count} 条提示词\n2. 每条 title 是 4 到 12 字的简短标题\n3. content 是可直接使用的提示词正文，60 到 200 字，可适当使用 {{content}}、{{chapter}}、{{role}} 模板变量\n4. content 必须与小说写作相关，禁止生成与写作无关的内容\n5. tags 返回 2 到 4 个简短标签\n6. remark 是一句话说明该提示词的用途\n7. ${writingStyle}\n\n返回格式：{"entries":[{"title":"","content":"","tags":[""],"remark":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<PromptGenerateResult>
    const entries = Array.isArray(parsed.entries) ? parsed.entries.slice(0, 20).map((e) => {
      const entry = e as Partial<PromptGenerateEntry>
      const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 4) : []
      return {
        title: jsonStringField(entry.title, '未命名提示词'),
        content: jsonStringField(entry.content),
        tags,
        remark: jsonStringField(entry.remark)
      } as PromptGenerateEntry
    }) : []
    return { entries } as PromptGenerateResult
  },
  validate(result: AiTaskResult): boolean {
    const entries = (result as PromptGenerateResult).entries
    return entries.length > 0 && entries.every((entry) => entry.title.trim() && entry.content.trim())
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const entries = (result as PromptGenerateResult).entries
    if (!entries.length) return ['entries 不能为空，至少要返回 1 条提示词。']
    return entries.some((entry) => !entry.title.trim() || !entry.content.trim())
      ? ['每条提示词必须包含 title 和 content。']
      : []
  }
}
export default handler
