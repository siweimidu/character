import type { AiTaskResult, CatalogBatchResult } from '../shared-types'
import { formatStoryStateConstraint, resolveWritingStyleInstruction } from '../prompts/shared'
import { extractJsonObject, jsonStringField, type PromptBuildInput, type TaskHandler } from './base'
import { normalizeWorldviewType } from './worldview-type'

type CatalogMode = 'character' | 'organization' | 'relationship' | 'membership' | 'worldview' | 'inspiration' | 'plot-thread'

const modeRules: Record<CatalogMode, string> = {
  character: '每项字段：name、role、description（80-160字）、tags（2-4项）。角色不能与已有角色重名，并应能嵌入现有关系网。',
  organization: '每项字段：name、type、description（80-160字）、motto。组织不能与已有组织重名。',
  relationship: 'targets 中每个对象生成且仅生成一项。字段：targetIndex（原样返回）、type、description（80-160字）、intensity（0-100）。',
  membership: 'targets 中每个角色生成且仅生成一项。字段：targetIndex（原样返回）、organizationName（必须从已有组织中选择）、role、notes（80-160字）。',
  worldview: '每项字段：type、title、content（80-180字）。type 必须严格使用 requestedTypes 中的中文分类原文，不得翻译成英文；各类型尽量均匀分布。',
  inspiration: '每项字段：type、title、content（60-140字）、tags（2-4项）。type 只能从 requestedTypes 中选择，各类型尽量均匀分布。\n\n灵感质量要求：\n- 标题要有故事感，能立刻激发画面感或冲突感，避免平淡概括。\n- content 要写出具体的场景画面/情绪冲突/人物动作/台词，而不仅是抽象概念。\n- 各条目之间要彼此有区分度，避免内容同质化。\n- 若为「伏笔」类型：伏笔要隐晦而有戏剧张力，设计成后续可回收的悬念，不能直接剧透。\n- 若为「场景火花」类型：给出具体到时间/地点/氛围的片段，可包含关键台词。\n- 若为「标题灵感」类型：标题要新颖、抓眼球，兼顾市场感与作品气质。\n- 若为「伏笔」类型：不得与「已有伏笔线索」重复或高度相似。',
  'plot-thread': '每项字段：title、description、tags。title ≤ 20 字，description 40 到 120 字，tags 返回 1 到 3 个关联标签（角色名、地点、物品等）。线索必须锚定在相关角色/世界观/大纲之上，与已有线索形成伏笔—回收的呼应，覆盖不同维度（至少包含一个与身份/身世相关的悬念、一个与势力冲突相关的悬念），尽量埋设中长期钩子。'
}

function normalizeEntry(source: unknown): Record<string, unknown> {
  const entry = source && typeof source === 'object' ? source as Record<string, unknown> : {}
  const normalized: Record<string, unknown> = {}
  for (const key of ['name', 'type', 'title', 'content', 'description', 'motto', 'role', 'notes', 'organizationName'] as const) {
    const value = jsonStringField(entry[key])
    if (value) normalized[key] = value
  }
  if (Array.isArray(entry.tags)) {
    normalized.tags = entry.tags
      .map((tag) => {
        if (tag && typeof tag === 'object') {
          return jsonStringField((tag as Record<string, unknown>).label)
        }
        return jsonStringField(tag)
      })
      .filter((tag) => tag && tag !== '[object Object]')
      .slice(0, 4)
  }
  if (entry.targetIndex != null && Number.isFinite(Number(entry.targetIndex))) {
    normalized.targetIndex = Math.max(0, Math.floor(Number(entry.targetIndex)))
  }
  if (entry.intensity != null && Number.isFinite(Number(entry.intensity))) {
    normalized.intensity = Math.max(0, Math.min(100, Math.round(Number(entry.intensity))))
  }
  return normalized
}

const handler: TaskHandler = {
  name: 'catalog-batch',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const requestedMode = String(context.mode ?? 'character') as CatalogMode
    const mode = requestedMode in modeRules ? requestedMode : 'character'
    const count = Math.max(1, Math.min(10, Number(context.count) || 1))
    const style = resolveWritingStyleInstruction(context)
    // 伏笔模式特有的重点方向与已有线索，避免与已有线索重复并保持前后呼应
    const focus = mode === 'plot-thread' ? String(context.focus ?? '').trim() : ''
    const plotThreadHint = mode === 'plot-thread'
      ? `\n伏笔重点方向（若为空则由你根据项目自行选择最合适的延展方向）：${focus || '延续当前大纲与已有人物的自然走向'}\n已有伏笔线索（新线索要与它们形成呼应或延展，避免重复）：${JSON.stringify(context.existingThreads ?? context.existingNames ?? []) || '（暂无）'}`
      : ''
    return {
      system: `${capabilityPreamble.system}\n\n你是小说项目的批量结构化资料生成器。只返回 JSON 对象，不要 Markdown、解释或提问。必须返回格式 {"entries":[...]}。${formatStoryStateConstraint(context)}`,
      user: `${capabilityPreamble.user}\n\n生成模式：${mode}\n本批数量：${count}\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n补充要求：${String(context.userPrompt ?? '') || '无'}\n指定类型：${JSON.stringify(context.requestedTypes ?? [])}\n主角色：${JSON.stringify(context.mainCharacter ?? null)}\n关系方向：${String(context.relationshipDirection ?? '')}\n待处理目标：${JSON.stringify(context.targets ?? [])}\n已有标题或名称（严格避重）：${JSON.stringify(context.existingNames ?? [])}${plotThreadHint}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节内容（已选片段）：${String(context.chapterContent ?? '')?.slice(0, 1200)}\n相关世界观：${JSON.stringify(context.worldviewEntries ?? [])}\n相关角色：${JSON.stringify(context.characters ?? [])}\n相关组织：${JSON.stringify(context.organizations ?? [])}\n已有角色关系：${JSON.stringify(context.characterRelationships ?? [])}\n已有组织归属：${JSON.stringify(context.organizationMemberships ?? [])}\n相关大纲：${JSON.stringify(context.outlineItems ?? [])}\n已有伏笔线索：${JSON.stringify(context.plotThreads ?? [])}\n\n本模式规则：${modeRules[mode]}\n通用要求：\n1. entries 必须恰好返回 ${count} 项，一项不能多、一项不能少，务必逐条核对数量后再输出；内容要彼此有区分度。\n2. 不得返回待补充、未定义、信息不足等占位内容；不得重复已有标题或名称。\n3. ${style}\n4. relationship 和 membership 模式必须严格按 targets 顺序返回，并保留 targetIndex。\n5. 灵感模式需紧扣当前章节上下文，生成与章节场景、人物情绪、剧情走向紧密关联的灵感。\n\n现在只返回 JSON。`
    }
  },
  normalize(raw: string, context?: Record<string, unknown>): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const isWorldview = context?.mode === 'worldview'
    const requestedTypes = Array.isArray(context?.requestedTypes)
      ? context.requestedTypes.map((value) => String(value).trim()).filter(Boolean)
      : []
    const fallbackType = requestedTypes[0] ?? '地理'
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.slice(0, 10).map((entry) => {
          const normalized = normalizeEntry(entry)
          if (isWorldview) normalized.type = normalizeWorldviewType(normalized.type, fallbackType)
          return normalized
        })
      : []
    return { entries } as CatalogBatchResult
  },
  validate(result: AiTaskResult): boolean {
    const entries = (result as CatalogBatchResult).entries
    return entries.length > 0 && entries.every((entry) => Object.keys(entry).length >= 2)
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const entries = (result as CatalogBatchResult).entries
    return entries.length ? ['entries 中存在字段不完整的条目。'] : ['entries 不能为空。']
  },
  resolveMaxTokens(input: PromptBuildInput): number {
    const count = Math.max(1, Math.min(10, Number(input.context.count) || 1))
    return Math.min(7000, 1200 + count * 550)
  }
}

export default handler
