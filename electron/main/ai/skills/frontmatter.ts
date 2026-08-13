import type { SkillCompatibility, SkillManifest, SkillReferenceRule } from './types'

/** 用户在 frontmatter 中显式覆盖的 skill 属性 */
export type SkillFrontmatterOverrides = {
  compatibility?: SkillCompatibility
  compatibilityNote?: string
  enabled?: boolean
}

/**
 * 解析 SKILL.md 文件头部的 YAML frontmatter
 * @param content - SKILL.md 的完整文本内容
 * @returns 解析后的名称、版本、描述、source、manifest 和覆盖项
 */
export function parseSkillFrontmatter(content: string): {
  name: string
  version: string
  description: string
  source: string
  manifest: Partial<SkillManifest> | null
  overrides: SkillFrontmatterOverrides
} {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const frontmatter = frontmatterMatch?.[1] ?? ''
  const lines = frontmatter.split(/\r?\n/)
  let name = ''
  let version = ''
  let description = ''
  let source = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!fieldMatch) continue

    const [, field, rawValue] = fieldMatch
    const value = stripYamlScalar(rawValue)

    if (field === 'description' && (value === '|' || value === '>')) {
      const block: string[] = []
      index += 1
      while (index < lines.length) {
        const blockLine = lines[index]
        if (blockLine && !/^\s+/.test(blockLine)) {
          index -= 1
          break
        }
        const trimmed = blockLine.trim()
        if (trimmed) block.push(trimmed)
        index += 1
      }
      description = block.join(' ').trim()
      continue
    }

    if (field === 'name') { name = value; continue }
    if (field === 'version') { version = value; continue }
    if (field === 'description') { description = value }
  }

  const sourceMatch = frontmatter.match(/^\s*source:\s*(.+)$/m)
  if (sourceMatch?.[1]) source = stripYamlScalar(sourceMatch[1])

  const { manifest, overrides } = parseManifestBlock(frontmatter)

  return { name, version, description, source, manifest, overrides }
}

/** 解析 frontmatter 中 `manifest:` 缩进块为结构化数据 */
function parseManifestBlock(frontmatter: string): {
  manifest: Partial<SkillManifest> | null
  overrides: SkillFrontmatterOverrides
} {
  const manifestStart = frontmatter.match(/^manifest:\s*$/m)
  if (!manifestStart) return { manifest: null, overrides: {} }

  const startIndex = manifestStart.index! + manifestStart[0].length
  const remaining = frontmatter.slice(startIndex)
  const lines = remaining.split(/\r?\n/)

  const result: Record<string, unknown> = {}
  let currentListKey: string | null = null
  let currentList: string[] | null = null

  const flushList = (): void => {
    if (currentListKey && currentList) result[currentListKey] = currentList
    currentListKey = null
    currentList = null
  }

  for (const line of lines) {
    if (line.match(/^[A-Za-z]/) && !line.startsWith(' ')) break

    const listItemMatch = line.match(/^\s{4,}-\s*(.+)$/)
    if (listItemMatch && currentList) {
      currentList.push(stripYamlScalar(listItemMatch[1]))
      continue
    }

    const match = line.match(/^\s{2}(\w+):\s*(.*)$/)
    if (!match) continue
    flushList()

    const [, key, rawValue] = match
    const value = stripYamlScalar(rawValue)

    if (value === '') {
      currentListKey = key
      currentList = []
      continue
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value.slice(1, -1).split(',').map((s) => stripYamlScalar(s)).filter(Boolean)
    } else if (value === 'true' || value === 'false') {
      result[key] = value === 'true'
    } else {
      result[key] = isNaN(Number(value)) ? value : Number(value)
    }
  }
  flushList()

  const overrides: SkillFrontmatterOverrides = {}
  if (typeof result.compatibility === 'string') overrides.compatibility = result.compatibility as SkillCompatibility
  if (typeof result.compatibilityNote === 'string') overrides.compatibilityNote = result.compatibilityNote
  if (typeof result.enabled === 'boolean') overrides.enabled = result.enabled

  const manifestKeys = ['category', 'tasks', 'stages', 'triggers', 'priority', 'required']
  const hasManifestField = manifestKeys.some((k) => result[k] !== undefined)
  const references = parseReferencesBlock(frontmatter)
  if (!hasManifestField && references.length === 0) return { manifest: null, overrides }

  const manifest: Partial<SkillManifest> = {
    category: typeof result.category === 'string' ? result.category as SkillManifest['category'] : undefined,
    tasks: Array.isArray(result.tasks) ? result.tasks as SkillManifest['tasks'] : undefined,
    stages: Array.isArray(result.stages) ? result.stages as SkillManifest['stages'] : undefined,
    triggers: Array.isArray(result.triggers) ? result.triggers as string[] : undefined,
    priority: typeof result.priority === 'number' ? result.priority : undefined,
    required: result.required === true ? true : undefined,
    references
  }

  return { manifest, overrides }
}

/**
 * 解析 manifest 下的 references 列表，支持两种写法：
 * 1. 对象列表（含 file / loadWhen.task / loadWhen.chapterIndexMax）：
 *    references:
 *      - file: references/x.md
 *        loadWhen:
 *          task: chapter-first-draft
 * 2. 简单字符串列表（仅文件路径）：
 *    references:
 *      - references/x.md
 * 这里做独立的容错解析，避免因 references 未解析导致参考文件永远不加载。
 */
function parseReferencesBlock(frontmatter: string): SkillReferenceRule[] {
  const lines = frontmatter.split(/\r?\n/)
  const startIndex = lines.findIndex((line) => /^\s{0,2}references:\s*$/.test(line))
  if (startIndex < 0) return []

  const rules: SkillReferenceRule[] = []
  let current: SkillReferenceRule | null = null
  let inLoadWhen = false

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    // 遇到下一个顶层（无缩进）字段说明 references 结束
    if (line && !/^\s/.test(line)) break
    if (!line.trim()) {
      if (current && !inLoadWhen) {
        rules.push(current)
        current = null
      }
      continue
    }

    const itemMatch = line.match(/^\s{2,4}-\s*(.*)$/)
    if (itemMatch) {
      if (current) rules.push(current)
      current = null
      inLoadWhen = false
      const body = itemMatch[1].trim()
      const fileMatch = body.match(/^file:\s*(.+)$/)
      if (fileMatch) {
        current = { file: stripYamlScalar(fileMatch[1]) }
      } else if (body && !body.includes(':')) {
        // 简单字符串列表写法
        current = { file: stripYamlScalar(body) }
      }
      continue
    }

    if (!current) continue

    const loadWhenMatch = line.match(/^\s{4,6}loadWhen:\s*$/)
    if (loadWhenMatch) {
      inLoadWhen = true
      current.loadWhen = {}
      continue
    }

    const fileMatch = line.match(/^\s{4,6}file:\s*(.+)$/)
    if (fileMatch && !inLoadWhen) {
      current.file = stripYamlScalar(fileMatch[1])
      continue
    }

    const taskMatch = line.match(/^\s{6,8}task:\s*(.+)$/)
    if (taskMatch && inLoadWhen && current.loadWhen) {
      current.loadWhen.task = stripYamlScalar(taskMatch[1]) as SkillReferenceRule['loadWhen'] extends { task?: infer T } ? T : never
      continue
    }

    const chapterMatch = line.match(/^\s{6,8}chapterIndexMax:\s*(\d+)\s*$/)
    if (chapterMatch && inLoadWhen && current.loadWhen) {
      current.loadWhen.chapterIndexMax = Number(chapterMatch[1])
      continue
    }
  }

  if (current) rules.push(current)
  return rules.filter((rule) => rule.file)
}

/** 去除 YAML 标量值两端的引号并 trim */
function stripYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}
