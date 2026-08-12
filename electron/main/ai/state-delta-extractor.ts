import type { StateDelta } from '../story-state-store'

/**
 * 从 AI 输出中提取状态变更的解析结果。
 */
export interface DeltaExtractionResult {
  /** 解析出的状态变更，未检测到 YAML 块时为 null */
  delta: StateDelta | null
  /** 章节正文部分（YAML 块之前的内容） */
  chapterContent: string
  /** 解析过程中的警告信息 */
  warnings: string[]
}

/**
 * 从 AI 输出中分离章节正文与 state_delta YAML 块，并解析状态变更。
 *
 * @param rawOutput - AI 的完整输出文本
 * @returns 解析结果，含 delta、正文和警告
 */
export function extractStateDeltaFromOutput(rawOutput: string): DeltaExtractionResult {
  const warnings: string[] = []

  const { chapterContent, yamlBlock } = splitOutputSections(rawOutput)

  if (!yamlBlock) {
    return { delta: null, chapterContent: chapterContent || rawOutput, warnings: ['未检测到 state_delta YAML 块'] }
  }

  const delta = parseStateDeltaYaml(yamlBlock, warnings)
  return { delta, chapterContent, warnings }
}

/** 将 AI 输出按 state_delta 标记拆分为章节正文和 YAML 块两部分。 */
function splitOutputSections(raw: string): { chapterContent: string; yamlBlock: string | null } {
  const markers = [
    /^state_delta:\s*$/m,
    /^```ya?ml\s*\n\s*state_delta:/m,
    /\nstate_delta:\s*\n/
  ]

  for (const marker of markers) {
    const match = raw.match(marker)
    if (match && match.index != null) {
      const chapterContent = raw.slice(0, match.index).trim()
      let yamlBlock = raw.slice(match.index).trim()

      if (yamlBlock.startsWith('```')) {
        const endFence = yamlBlock.indexOf('```', 3)
        if (endFence > 0) {
          yamlBlock = yamlBlock.slice(yamlBlock.indexOf('\n') + 1, endFence).trim()
        }
      }

      return { chapterContent, yamlBlock }
    }
  }

  return { chapterContent: raw, yamlBlock: null }
}

/** 将 YAML 文本解析为 StateDelta 结构，解析失败时返回 null 并记录警告。 */
function parseStateDeltaYaml(yaml: string, warnings: string[]): StateDelta | null {
  try {
    const delta: StateDelta = {
      characters_updated: [],
      relationships_delta: [],
      foreshadowing_delta: { planted: [], advanced: [], resolved: [] },
      timeline: { story_time_elapsed: '', current_story_date: '', events: [] }
    }

    delta.characters_updated = parseCharactersUpdated(yaml, warnings)
    delta.relationships_delta = parseRelationshipsDelta(yaml, warnings)
    delta.foreshadowing_delta = parseForeshadowingDelta(yaml, warnings)
    delta.timeline = parseTimeline(yaml, warnings)

    const hasContent = delta.characters_updated.length > 0
      || delta.relationships_delta.length > 0
      || delta.foreshadowing_delta.planted.length > 0
      || delta.foreshadowing_delta.advanced.length > 0
      || delta.foreshadowing_delta.resolved.length > 0
      || delta.timeline.events.length > 0

    if (!hasContent) {
      warnings.push('state_delta 解析结果为空，可能格式不符合预期')
      return null
    }

    return delta
  } catch (e) {
    warnings.push(`state_delta 解析失败: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** 从 YAML 中解析 characters_updated 块，提取每个角色的状态变更。 */
function parseCharactersUpdated(yaml: string, _warnings: string[]): StateDelta['characters_updated'] {
  const results: StateDelta['characters_updated'] = []
  const charBlockRegex = /- character_id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n- character_id:|\nrelationships_delta:|\nforeshadowing_delta:|\ntimeline:|\n[a-z]|$)/g

  let match: RegExpExecArray | null
  while ((match = charBlockRegex.exec(yaml)) !== null) {
    const charId = match[1].trim()
    const block = match[2]

    const changes: StateDelta['characters_updated'][0]['changes'] = {}

    const locationTo = extractValue(block, 'to')
    const locationFrom = extractValue(block, 'from')
    if (locationTo) {
      changes.location = { from: locationFrom || '', to: locationTo }
    }

    const physicalState = extractValue(block, 'physical_state')
    if (physicalState) changes.physical_state = physicalState

    const mentalState = extractValue(block, 'mental_state')
    if (mentalState) changes.mental_state = mentalState

    const arcProgression = extractValue(block, 'arc_progression')
    if (arcProgression) changes.arc_progression = arcProgression

    const powerLevel = extractValue(block, 'power_level')
    if (powerLevel) changes.power_level = powerLevel

    // 注意：inventory_delta 与 goals_update 各自都含 `added` 字段。若直接对整个
    // character 块用 extractList(block, 'added')，`indexOf` 只会命中第一个 `added:`，
    // 导致 goals_update.added 误取到 inventory_delta.added（或反之），取决于字段顺序。
    // 因此必须先把每个子块（inventory_delta / goals_update）切出来，再在子块内取值。
    const inventorySection = extractSection(block, 'inventory_delta')
    const inventoryAdded = inventorySection ? extractList(inventorySection, 'added') : []
    const inventoryRemoved = inventorySection ? extractList(inventorySection, 'removed') : []
    if (inventoryAdded.length || inventoryRemoved.length) {
      changes.inventory_delta = { added: inventoryAdded, removed: inventoryRemoved }
    }

    const newKnowledge = extractList(block, 'new_knowledge')
    if (newKnowledge.length) changes.new_knowledge = newKnowledge

    const goalsSection = extractSection(block, 'goals_update')
    const completedGoals = goalsSection ? extractList(goalsSection, 'completed') : []
    const addedGoals = goalsSection ? extractList(goalsSection, 'added') : []
    if (completedGoals.length || addedGoals.length) {
      changes.goals_update = { completed: completedGoals, added: addedGoals }
    }

    if (Object.keys(changes).length > 0) {
      results.push({ character_id: charId, changes })
    }
  }

  return results
}

/** 从 YAML 中解析 relationships_delta 块，提取关系状态变化。 */
function parseRelationshipsDelta(yaml: string, _warnings: string[]): StateDelta['relationships_delta'] {
  const results: StateDelta['relationships_delta'] = []
  const section = extractSection(yaml, 'relationships_delta')
  if (!section) return results

  const relBlockRegex = /- relationship_id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n- relationship_id:|$)/g
  let match: RegExpExecArray | null
  while ((match = relBlockRegex.exec(section)) !== null) {
    const relId = match[1].trim()
    const block = match[2]

    const statusTo = extractValue(block, 'to')
    const statusFrom = extractValue(block, 'from')
    const pivotEvent = extractValue(block, 'pivot_event')
    const tensionPoints = extractList(block, 'new_tension_points')

    results.push({
      relationship_id: relId,
      status_change: statusTo ? { from: statusFrom || '', to: statusTo, pivot_event: pivotEvent || '' } : undefined,
      new_tension_points: tensionPoints.length ? tensionPoints : undefined
    })
  }

  return results
}

/** 从 YAML 中解析 foreshadowing_delta 块（埋设 / 推进 / 回收伏笔）。 */
function parseForeshadowingDelta(yaml: string, _warnings: string[]): StateDelta['foreshadowing_delta'] {
  const result: StateDelta['foreshadowing_delta'] = { planted: [], advanced: [], resolved: [] }

  const section = extractSection(yaml, 'foreshadowing_delta')
  if (!section) return result

  const plantedSection = extractSection(section, 'planted')
  if (plantedSection) {
    const itemRegex = /- id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n\s*- id:|$)/g
    let match: RegExpExecArray | null
    while ((match = itemRegex.exec(plantedSection)) !== null) {
      result.planted.push({
        id: match[1].trim(),
        type: extractValue(match[2], 'type') || '暗线',
        description: extractValue(match[2], 'description') || '',
        method: extractValue(match[2], 'method') || '',
        payoff_chapter: extractNumber(match[2], 'payoff_chapter')
      })
    }
  }

  const advancedSection = extractSection(section, 'advanced')
  if (advancedSection) {
    const itemRegex = /- id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n\s*- id:|$)/g
    let match: RegExpExecArray | null
    while ((match = itemRegex.exec(advancedSection)) !== null) {
      result.advanced.push({
        id: match[1].trim(),
        clue: extractValue(match[2], 'clue') || '',
        method: extractValue(match[2], 'method') || ''
      })
    }
  }

  const resolvedSection = extractSection(section, 'resolved')
  if (resolvedSection) {
    const itemRegex = /- id:\s*["']?([^"'\n]+)["']?\s*\n([\s\S]*?)(?=\n\s*- id:|$)/g
    let match: RegExpExecArray | null
    while ((match = itemRegex.exec(resolvedSection)) !== null) {
      result.resolved.push({
        id: match[1].trim(),
        method: extractValue(match[2], 'method') || '',
        impact: extractValue(match[2], 'impact') || ''
      })
    }
  }

  return result
}

/** 从 YAML 中解析 timeline 块（故事时间流逝与事件）。 */
function parseTimeline(yaml: string, _warnings: string[]): StateDelta['timeline'] {
  const section = extractSection(yaml, 'timeline')
  if (!section) return { story_time_elapsed: '', current_story_date: '', events: [] }

  return {
    story_time_elapsed: extractValue(section, 'story_time_elapsed') || '',
    current_story_date: extractValue(section, 'current_story_date') || '',
    events: extractList(section, 'events'),
    world_state_changes: extractList(section, 'world_state_changes')
  }
}

// ==================== YAML Parsing Helpers ====================

/** 从 YAML 块中提取单个 key 的值（单行，去除引号）。 */
function extractValue(block: string, key: string): string | null {
  const regex = new RegExp(`${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm')
  const match = block.match(regex)
  return match ? match[1].trim() : null
}

/** 从 YAML 块中提取数值型字段，无法解析时返回 undefined。 */
function extractNumber(block: string, key: string): number | undefined {
  const val = extractValue(block, key)
  if (!val) return undefined
  const num = parseInt(val, 10)
  return isNaN(num) ? undefined : num
}

/** 从 YAML 块中提取列表字段，支持内联 `[...]` 和 `- item` 两种格式。 */
function extractList(block: string, key: string): string[] {
  const sectionStart = block.indexOf(`${key}:`)
  if (sectionStart < 0) return []

  const afterKey = block.slice(sectionStart + key.length + 1)

  const inlineMatch = afterKey.match(/^\s*\[([^\]]*)\]/)
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  const items: string[] = []
  const lines = afterKey.split('\n')
  for (const line of lines) {
    const itemMatch = line.match(/^\s*-\s+["']?(.+?)["']?\s*$/)
    if (itemMatch) {
      items.push(itemMatch[1])
    } else if (line.trim() && !line.match(/^\s*-/) && !line.match(/^\s*$/)) {
      break
    }
  }
  return items
}

/** 从 YAML 中提取指定 key 的缩进子块文本。 */
function extractSection(yaml: string, sectionKey: string): string | null {
  const regex = new RegExp(`^(\\s*)${sectionKey}:\\s*$`, 'm')
  const match = yaml.match(regex)
  if (!match || match.index == null) return null

  const indent = match[1].length
  const startIdx = match.index + match[0].length + 1
  const lines = yaml.slice(startIdx).split('\n')
  const sectionLines: string[] = []

  for (const line of lines) {
    if (line.trim() === '') {
      sectionLines.push(line)
      continue
    }
    const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0
    if (lineIndent <= indent && line.trim()) break
    sectionLines.push(line)
  }

  return sectionLines.join('\n')
}
