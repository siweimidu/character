import type { AiTaskPayload, AiTaskKnowledgeContext } from '../shared-types'
import type { SkillSelection } from '../skills/types'
import type { PromptBuildInput } from '../tasks/base'
import type { PromptCapabilityId } from '../prompts/capability'
import { buildCapabilityContext, getDefaultCapabilities } from '../prompts/capability'
import { formatRetrievedKnowledge, formatMountedSkills } from '../prompts/shared'

/**
 * 根据任务、技能、知识上下文构建提示词输入对象
 * @param task - AI 任务载荷
 * @param skills - 已选择的技能列表
 * @param knowledgeContext - 可选的知识检索上下文
 * @param extraCapabilities - 可选的额外能力标识
 * @returns 可直接传入任务处理器 buildPrompt 的输入对象
 */
export function buildPromptInput(
  task: AiTaskPayload,
  skills: SkillSelection[],
  knowledgeContext?: AiTaskKnowledgeContext,
  extraCapabilities?: PromptCapabilityId[]
): PromptBuildInput {
  const capabilities = resolveCapabilities(task, extraCapabilities)
  const capabilityPreamble = buildCapabilityContext(task.task, capabilities)
  const skillsBlock = formatMountedSkills(skills)
  const knowledgeBlock = formatRetrievedKnowledge(knowledgeContext?.usedKnowledge)

  return {
    context: task.context,
    skills,
    knowledgeContext,
    capabilityPreamble,
    skillsBlock,
    knowledgeBlock
  }
}

/** 根据任务类型和上下文字段，解析出需要启用的提示词能力列表 */
function resolveCapabilities(
  task: AiTaskPayload,
  extra?: PromptCapabilityId[]
): PromptCapabilityId[] {
  const defaults = getDefaultCapabilities(task.task)
  const capabilityIds = new Set<PromptCapabilityId>(defaults)

  if (extra) {
    for (const id of extra) capabilityIds.add(id)
  }

  const context = task.context ?? {}
  if (hasContextHint(context, 'workflowDocuments', 'requestedDocuments', 'stageId')) capabilityIds.add('workflow')
  if (hasContextHint(context, 'worldviewEntries', 'worldviewTitles')) capabilityIds.add('worldview')
  if (hasContextHint(context, 'characters', 'characterNames')) capabilityIds.add('characters')
  if (hasContextHint(context, 'organizations', 'characterRelationships', 'organizationMemberships')) capabilityIds.add('relations')
  if (hasContextHint(context, 'inspirationEntries', 'existingInspirationTitles')) capabilityIds.add('inspiration')
  if (hasContextHint(context, 'outlineItems', 'currentVolumeOutlineItems', 'outlineTitles', 'currentOutlineItem')) capabilityIds.add('outline')
  if (hasContextHint(context, 'chapterContent', 'chapterTitle', 'relatedChapters')) capabilityIds.add('chapters')
  if (Boolean(String(context.writingStyleLabel ?? '').trim() || String(context.writingStylePrompt ?? '').trim())) capabilityIds.add('writing-style')
  if (Array.isArray(context.projectSkills) && context.projectSkills.length > 0) capabilityIds.add('project-skills')

  return Array.from(capabilityIds)
}

/** 判断上下文中是否存在指定键的有效值（非空数组、字符串或对象） */
function hasContextHint(context: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => {
    const value = context[key]
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' || typeof value === 'object'
  })
}
