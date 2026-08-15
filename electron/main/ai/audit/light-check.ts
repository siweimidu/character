import type { StoryStateContext, CharacterState } from '../../story-state-store'
import type { StateDelta } from '../../story-state-store'

/** 轻量检查发现的单条违规记录 */
export interface LightCheckViolation {
  type: 'location_mismatch' | 'item_not_owned' | 'timeline_break' | 'rule_violation' | 'state_conflict'
  severity: 'error' | 'warning'
  message: string
}

/** 轻量检查的汇总结果 */
export interface LightCheckResult {
  passed: boolean
  violations: LightCheckViolation[]
}

/**
 * 执行轻量一致性检查，扫描章节内容与状态 delta 中的潜在问题
 * @param chapterContent - 章节正文文本
 * @param stateBefore - 执行 delta 前的完整故事状态
 * @param delta - 本章产生的状态变更（null 表示无变更）
 * @returns 检查结果，包含是否通过及违规列表
 */
export function runLightCheck(
  chapterContent: string,
  stateBefore: StoryStateContext,
  delta: StateDelta | null
): LightCheckResult {
  const violations: LightCheckViolation[] = []

  if (!delta) {
    return { passed: true, violations }
  }

  checkItemConsistency(stateBefore.characterStates, delta, violations)
  checkLocationConsistency(stateBefore.characterStates, delta, violations)
  checkWorldRuleViolations(chapterContent, stateBefore.worldRules, violations)
  checkStateConflicts(stateBefore.characterStates, delta, violations)

  return {
    passed: violations.filter((v) => v.severity === 'error').length === 0,
    violations
  }
}

/** 检查物品移除是否与角色库存一致 */
function checkItemConsistency(
  characterStates: CharacterState[],
  delta: StateDelta,
  violations: LightCheckViolation[]
): void {
  for (const charUpdate of delta.characters_updated) {
    const removed = charUpdate.changes.inventory_delta?.removed ?? []
    if (!removed.length) continue

    const charState = characterStates.find((c) => c.characterId === charUpdate.character_id)
    if (!charState) continue

    for (const item of removed) {
      if (!charState.inventory.includes(item)) {
        violations.push({
          type: 'item_not_owned',
          severity: 'warning',
          message: `角色「${charUpdate.character_id}」移除了物品「${item}」，但状态库中未记录该物品`
        })
      }
    }
  }
}

/** 检查角色位置变更的 from 值是否与状态库一致 */
function checkLocationConsistency(
  characterStates: CharacterState[],
  delta: StateDelta,
  violations: LightCheckViolation[]
): void {
  for (const charUpdate of delta.characters_updated) {
    const locationChange = charUpdate.changes.location
    if (!locationChange) continue

    const charState = characterStates.find((c) => c.characterId === charUpdate.character_id)
    if (!charState) continue

    if (charState.location && locationChange.from && charState.location !== locationChange.from) {
      violations.push({
        type: 'location_mismatch',
        severity: 'warning',
        message: `角色「${charUpdate.character_id}」位置不一致：状态库记录在「${charState.location}」，但 delta 声称从「${locationChange.from}」移动`
      })
    }
  }
}

/** 通过关键词匹配检测正文是否可能违反强制世界规则 */
function checkWorldRuleViolations(
  content: string,
  worldRules: StoryStateContext['worldRules'],
  violations: LightCheckViolation[]
): void {
  const contentLower = content.toLowerCase()

  for (const rule of worldRules) {
    if (!rule.mustComply) continue

    const ruleKeywords = extractRuleKeywords(rule.ruleContent)
    if (!ruleKeywords.length) continue

    const isConstraintRule = /[不禁]|无法|只能|必须/.test(rule.ruleContent)
    const matchedKeywords = ruleKeywords.filter((kw) => contentLower.includes(kw.toLowerCase()))
    const threshold = isConstraintRule ? 2 : 3

    if (matchedKeywords.length >= threshold) {
      violations.push({
        type: 'rule_violation',
        severity: 'warning',
        message: `可能违反世界规则「${rule.ruleContent}」（第${rule.establishedChapter}章确立）— 正文中出现相关关键词`
      })
    }
  }
}

/** 检测昏迷/死亡角色被报告有主动行为变更但未恢复状态的冲突 */
function checkStateConflicts(
  characterStates: CharacterState[],
  delta: StateDelta,
  violations: LightCheckViolation[]
): void {
  for (const charUpdate of delta.characters_updated) {
    const charState = characterStates.find((c) => c.characterId === charUpdate.character_id)
    if (!charState) continue

    if (charState.physicalState.includes('昏迷') || charState.physicalState.includes('死亡')) {
      const hasActiveChanges = charUpdate.changes.goals_update ||
        charUpdate.changes.arc_progression ||
        charUpdate.changes.power_level
      if (hasActiveChanges && !charUpdate.changes.physical_state) {
        violations.push({
          type: 'state_conflict',
          severity: 'warning',
          message: `角色「${charUpdate.character_id}」当前状态为「${charState.physicalState}」，但 delta 报告了主动行为变更且未恢复状态`
        })
      }
    }
  }
}

/** 从规则文本中提取有意义的关键词（去除虚词和标点，最多 8 个） */
function extractRuleKeywords(ruleContent: string): string[] {
  return ruleContent
    .replace(/[，。、；：""''（）【】！？…—·「」『』]/g, ' ')
    .replace(/(?:不能|不可|无法|不得|禁止|不会|不要|必须|只能|可以|应该|需要|的|了|是|在|有|和|与|或|而|但|也|都|就|才|又|被|把|让|给|对|从|向|到|以|为|于|之)/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
}
