import type { AiTaskResult, PremiseGenerateResult } from '../shared-types'
import type { PromptBuildInput, TaskHandler } from './base'
import { extractJsonObject, jsonStringField } from './base'

const handler: TaskHandler = {
  name: 'premise-generate',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const projectTitle = String(context.projectTitle ?? '').trim() || '未命名作品'
    const projectGenre = String(context.projectGenre ?? '').trim() || '未指定'
    const novelLengthLabel = String(context.projectNovelLengthLabel ?? '').trim() || '长篇'

    return {
      system: `${capabilityPreamble.system}\n\n你是资深小说策划编辑。你的任务是根据作品标题、题材和目标篇幅，从零创作一段既能直接展示给读者、又能作为后续角色、世界观和大纲生成依据的故事简介。简介必须有创意、有吸引力，且贴合所选题材与篇幅。只返回 JSON，不要输出 Markdown、标题、分析、修改说明或额外建议。`,
      user: `${capabilityPreamble.user}\n\n作品标题：${projectTitle}\n作品题材：${projectGenre}\n目标篇幅：${novelLengthLabel}\n\n创作要求：\n1. 围绕标题《${projectTitle}》展开，设计一个贴合「${projectGenre}」题材、有吸引力的故事设定：主角、其身份与处境、时代或世界背景、触发事件、核心目标、主要阻力与代价，以及明确的故事走向\n2. 简介要让人一读就想看正文：用具体、自然、有画面感的中文，避免堆砌形容词、广告口号和"这是一个关于""命运的齿轮"等套话\n3. 短篇应聚焦单一核心冲突和可闭环目标；长篇应保留角色成长空间、持续性矛盾和可扩展主线，但不要凭空堆砌支线\n4. 输出 2-4 个连贯自然段，通常控制在 150-400 字\n5. 不添加标题、书名号、标签、列表或创作说明，只输出可直接保存的简介正文\n\n返回格式：{"premise":"创作完成的小说简介"}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    return {
      premise: jsonStringField(parsed.premise)
    } as PremiseGenerateResult
  },
  validate(result: AiTaskResult): boolean {
    const premise = (result as PremiseGenerateResult).premise?.trim() ?? ''
    return premise.length > 0 && premise.length <= 800
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const premise = (result as PremiseGenerateResult).premise?.trim() ?? ''
    if (!premise) return ['缺少 premise。']
    if (premise.length > 800) return ['premise 不能超过 800 字。']
    return []
  }
}

export default handler
