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
 * 完整酒馆角色卡生成任务：根据设定要点生成选中的角色卡字段
 * 用户可自由勾选需要生成的字段（名称/定位/外貌/性格/背景/场景/开场白/对话示例/简介/标签），默认全部勾选
 */

/** 可用字段定义：key + 显示名 + 生成指引 */
const FIELD_SPECS: Array<{ key: keyof CharacterCardFullResult; label: string; instruction: string }> = [
  { key: 'name', label: 'name', instruction: 'name：不与已有角色重名' },
  { key: 'role', label: 'role', instruction: 'role：短语概括角色定位' },
  { key: 'appearance', label: 'appearance', instruction: 'appearance：外貌特征，包含五官、体态、服饰气质，40-120字' },
  { key: 'personality', label: 'personality', instruction: 'personality：性格特质，含核心性格与内在矛盾，40-120字' },
  { key: 'background', label: 'background', instruction: 'background：背景故事，含出身、经历与关键转折，100-240字' },
  { key: 'scenario', label: 'scenario', instruction: 'scenario：角色登场时的初始场景设定，40-100字' },
  { key: 'greeting', label: 'greeting', instruction: 'greeting：角色的开场白（第一句对话），语气符合人设，20-60字' },
  { key: 'dialogueExamples', label: 'dialogueExamples', instruction: 'dialogueExamples：给出2-3组「用户-角色」对话示例，用格式 user:...（换行）char:... 分行' },
  { key: 'description', label: 'description', instruction: 'description：80-160字，按"核心定位 + 反差细节 + 动机逻辑"组织' },
  { key: 'tags', label: 'tags', instruction: 'tags：2-4个简短标签数组' }
]

/** 默认全部勾选 */
const ALL_KEYS = FIELD_SPECS.map((spec) => spec.key) as Array<keyof CharacterCardFullResult>

/** 解析用户传入的 selectedFields，默认全部字段 */
function resolveSelectedFields(context: Record<string, unknown>): Set<keyof CharacterCardFullResult> {
  const raw = context.selectedFields
  if (!Array.isArray(raw) || raw.length === 0) {
    return new Set(ALL_KEYS)
  }
  const selected = new Set(raw.map((v) => String(v)) as Array<keyof CharacterCardFullResult>)
  // 至少保留 name，name 是必须的
  if (!selected.has('name')) {
    selected.add('name')
  }
  return selected
}

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

    const selected = resolveSelectedFields(context)
    const selectedSpecs = FIELD_SPECS.filter((spec) => selected.has(spec.key))
    const fieldInstructions = selectedSpecs
      .map((spec, index) => `${index + 1}. ${spec.instruction}`)
      .join('\n')
    // 构建返回 JSON 的字段占位提示
    const jsonFields = selectedSpecs
      .map((spec) => {
        const placeholder = spec.key === 'tags' ? '["...","..."]' : '...'
        return `"${spec.key}":${placeholder}`
      })
      .join(',')

    return {
      system: `${capabilityPreamble.system}\n\n你是小说角色设定助手。用户会给出角色设定要点，你需要据此自动填充选中的人设字段（兼容酒馆角色卡 V2）。\n\n重要约束：\n- 你必须直接返回填充完毕的 JSON，不要询问用户任何问题\n- 即使上下文信息有限，也必须根据用户要点发挥创造力，生成完整、有质感的角色设定\n- 绝不允许返回占位内容（如"未定义""待补充""无法生成""信息不足"等）\n- 请只返回 JSON 对象，不要返回 Markdown 或任何解释文字${formatStoryStateConstraint(context)}`,
      user: `${capabilityPreamble.user}\n\n用户给出的角色设定要点：\n${userPrompt || '（未提供，请依据项目题材自主创作一个鲜明角色）'}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n相关世界观：\n${worldview || '暂无'}\n\n已有组织：\n${organizations || '暂无'}\n\n已有角色关系：\n${relationships || '暂无'}\n\n已有成员归属：\n${memberships || '暂无'}\n\n本次需要生成的字段：\n${fieldInstructions}\n\n附加要求：\n- 新角色要能自然嵌入现有关系网络\n- ${writingStyle}\n\n返回格式（只包含上面列出的字段，值必须填充实质内容，不允许为空或占位符）：\n{${jsonFields}}`
    }
  },
  normalize(raw: string, context?: Record<string, unknown>): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<CharacterCardFullResult>
    const selected = resolveSelectedFields(context ?? {})

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
      : []

    const result: CharacterCardFullResult = {
      name: '',
      role: '',
      appearance: '',
      personality: '',
      background: '',
      scenario: '',
      greeting: '',
      dialogueExamples: '',
      description: '',
      tags: []
    }

    if (selected.has('name')) result.name = sanitizeField(jsonStringField(parsed.name))
    if (selected.has('role')) result.role = sanitizeField(jsonStringField(parsed.role))
    if (selected.has('appearance')) result.appearance = sanitizeField(jsonStringField(parsed.appearance))
    if (selected.has('personality')) result.personality = sanitizeField(jsonStringField(parsed.personality))
    if (selected.has('background')) result.background = sanitizeField(jsonStringField(parsed.background))
    if (selected.has('scenario')) result.scenario = sanitizeField(jsonStringField(parsed.scenario))
    if (selected.has('greeting')) result.greeting = sanitizeField(jsonStringField(parsed.greeting))
    if (selected.has('dialogueExamples')) result.dialogueExamples = sanitizeField(jsonStringField(parsed.dialogueExamples))
    if (selected.has('description')) result.description = sanitizeField(jsonStringField(parsed.description))
    if (selected.has('tags')) result.tags = tags.filter((t) => !REFUSAL_RE.test(t))

    return result
  },
  validate(result: AiTaskResult): boolean {
    const r = result as CharacterCardFullResult
    // 校验逻辑：name 始终必须；其余字段只要非空即校验基础内容
    if (!r.name?.trim() || REFUSAL_RE.test(r.name)) return false
    if (r.role?.trim() && REFUSAL_RE.test(r.role)) return false
    if (r.appearance?.trim() && REFUSAL_RE.test(r.appearance)) return false
    if (r.personality?.trim() && REFUSAL_RE.test(r.personality)) return false
    if (r.background?.trim() && REFUSAL_RE.test(r.background)) return false
    if (r.scenario?.trim() && REFUSAL_RE.test(r.scenario)) return false
    if (r.greeting?.trim() && REFUSAL_RE.test(r.greeting)) return false
    if (r.dialogueExamples?.trim() && REFUSAL_RE.test(r.dialogueExamples)) return false
    if (r.description?.trim() && REFUSAL_RE.test(r.description)) return false
    return true
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const r = result as CharacterCardFullResult
    const errors: string[] = []
    if (!r.name?.trim()) errors.push('缺少 name。')
    if (REFUSAL_RE.test(r.name)) errors.push('name 为占位内容。')
    if (r.role?.trim() && REFUSAL_RE.test(r.role)) errors.push('role 为占位内容。')
    if (r.appearance?.trim() && REFUSAL_RE.test(r.appearance)) errors.push('appearance 为占位内容。')
    if (r.personality?.trim() && REFUSAL_RE.test(r.personality)) errors.push('personality 为占位内容。')
    if (r.background?.trim() && REFUSAL_RE.test(r.background)) errors.push('background 为占位内容。')
    if (r.scenario?.trim() && REFUSAL_RE.test(r.scenario)) errors.push('scenario 为占位内容。')
    if (r.greeting?.trim() && REFUSAL_RE.test(r.greeting)) errors.push('greeting 为占位内容。')
    if (r.dialogueExamples?.trim() && REFUSAL_RE.test(r.dialogueExamples)) errors.push('dialogueExamples 为占位内容。')
    if (r.description?.trim() && REFUSAL_RE.test(r.description)) errors.push('description 为占位内容。')
    return errors
  }
}
export default handler
