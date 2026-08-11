import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject, jsonStringField } from './base'
import type { AiTaskResult, CharacterCardFullResult } from '../shared-types'
import { formatStoryStateConstraint, resolveWritingStyleInstruction } from '../prompts/shared'
import { formatOrganizations, formatCharacterRelationships, formatOrganizationMemberships, formatWorldviewEntries } from '../prompts/format-helpers'

/** 检测模型返回的占位符 / 拒绝性内容 */
const REFUSAL_RE = /未定义|待补充|无法生成|信息不足|缺少.*(?:信息|档案|资料)|(?:not|cannot|unable)\s+(?:generate|provide|create)/i

function sanitizeField(value?: string): string {
  if (!value) return ''
  return REFUSAL_RE.test(value) ? '' : value
}

/**
 * 完整酒馆角色卡生成任务：根据设定要点一次性生成 ST V2 全部字段
 * （名称/定位/外貌/性格/背景/场景/开场白/对话示例/简介/标签）
 */
const handler: TaskHandler = {
  name: 'character-card-full',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'characters', 'relations', 'worldview', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)
    const worldview = formatWorldviewEntries(context.worldviewEntries)
    const userPrompt = String(context.userPrompt ?? '').trim()

    return {
      system: `${capabilityPreamble.system}\n\n你是小说角色设定助手。用户会给出角色设定要点，你需要据此自动填充整套人设（兼容酒馆角色卡 V2）。\n\n重要约束：\n- 你必须直接返回填充完毕的 JSON，不要询问用户任何问题\n- 即使上下文信息有限，也必须根据用户要点发挥创造力，生成完整、有质感的角色设定\n- 绝不允许返回占位内容（如"未定义""待补充""无法生成""信息不足"等）\n- 请只返回 JSON 对象，不要返回 Markdown 或任何解释文字${formatStoryStateConstraint(context)}`,
      user: `${capabilityPreamble.user}\n\n用户给出的角色设定要点：\n${userPrompt || '（未提供，请依据项目题材自主创作一个鲜明角色）'}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n相关世界观：\n${worldview || '暂无'}\n\n已有组织：\n${organizations || '暂无'}\n\n已有角色关系：\n${relationships || '暂无'}\n\n已有成员归属：\n${memberships || '暂无'}\n\n要求：\n1. name：不与已有角色重名\n2. role：短语概括角色定位\n3. appearance：外貌特征，包含五官、体态、服饰气质，40-120字\n4. personality：性格特质，含核心性格与内在矛盾，40-120字\n5. background：背景故事，含出身、经历与关键转折，100-240字\n6. scenario：角色登场时的初始场景设定，40-100字\n7. greeting：角色的开场白（第一句对话），语气符合人设，20-60字\n8. dialogueExamples：给出2-3组「用户-角色」对话示例，用格式 user:...（换行）char:... 分行\n9. description：80-160字，按"核心定位 + 反差细节 + 动机逻辑"组织\n10. tags：2-4个简短标签数组\n11. 新角色要能自然嵌入现有关系网络\n12. ${writingStyle}\n\n返回格式（所有值必须填充实质内容，不允许为空或占位符）：{"name":"...","role":"...","appearance":"...","personality":"...","background":"...","scenario":"...","greeting":"...","dialogueExamples":"...","description":"...","tags":["...","..."]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<CharacterCardFullResult>
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6) : []
    return {
      name: sanitizeField(jsonStringField(parsed.name)),
      role: sanitizeField(jsonStringField(parsed.role)),
      appearance: sanitizeField(jsonStringField(parsed.appearance)),
      personality: sanitizeField(jsonStringField(parsed.personality)),
      background: sanitizeField(jsonStringField(parsed.background)),
      scenario: sanitizeField(jsonStringField(parsed.scenario)),
      greeting: sanitizeField(jsonStringField(parsed.greeting)),
      dialogueExamples: sanitizeField(jsonStringField(parsed.dialogueExamples)),
      description: sanitizeField(jsonStringField(parsed.description)),
      tags: tags.filter((t) => !REFUSAL_RE.test(t))
    } as CharacterCardFullResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as CharacterCardFullResult
    return Boolean(
      r.name?.trim() &&
      r.role?.trim() &&
      r.appearance?.trim() &&
      r.personality?.trim() &&
      r.background?.trim() &&
      r.scenario?.trim() &&
      r.greeting?.trim() &&
      r.description?.trim() &&
      r.tags?.length >= 2 &&
      !REFUSAL_RE.test(r.name) &&
      !REFUSAL_RE.test(r.description)
    )
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const r = result as CharacterCardFullResult
    const errors: string[] = []
    const required = [
      ['name', 'name'],
      ['role', 'role'],
      ['appearance', 'appearance'],
      ['personality', 'personality'],
      ['background', 'background'],
      ['scenario', 'scenario'],
      ['greeting', 'greeting'],
      ['description', 'description']
    ] as const
    for (const [key, label] of required) {
      if (!r[key]?.trim()) errors.push(`缺少 ${label}。`)
    }
    if (!r.tags || r.tags.length < 2) errors.push('tags 至少需要 2 项。')
    return errors
  }
}
export default handler
