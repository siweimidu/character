import { app } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillDefinition } from './types'
import { parseSkillFrontmatter } from './frontmatter'
import { validateManifest } from './manifest'
import { inferSkillMeta, buildFullManifest } from './heuristics'

/** 将 projectId 标准化为 registry key，空值时返回 '_shared' */
function resolveProjectSkillsScope(projectId?: string): string {
  const normalizedProjectId = String(projectId ?? '').trim()
  return normalizedProjectId || '_shared'
}

/** 获取内置 skill 目录的绝对路径 */
export function getBuiltinSkillsDirPath(): string {
  return join(app.getAppPath(), 'resources', 'skills')
}

/**
 * 获取项目级 skill 目录的绝对路径
 * @param projectId - 项目标识，为空时使用共享目录
 * @returns 项目 skill 目录路径
 */
export function getProjectSkillsDirPath(projectId?: string): string {
  return join(app.getPath('userData'), 'project-skills', resolveProjectSkillsScope(projectId))
}

/**
 * 在多个同名（同 id）skill 中挑选更优的一份进行保留。
 *
 * 磁盘上可能因为重复导入等原因，同一个 skill id 同时出现在多个位置（例如未分组的
 * project-skills/<skill> 与分组的 project-skills/<group>/<skill>）。此时若用 Map 按 id
 * 直接覆盖，会依赖 readdir 的文件系统遍历顺序，导致分组信息被未分组条目覆盖，
 * 进而让“导入到目标分组”的 skill 显示在“未分组”里。
 *
 * 因此这里采用稳定且合理的优先级：
 * 1. 项目作用域优先于内置作用域（保持“项目导入覆盖内置同名”的既有语义）；
 * 2. 同作用域下，路径分段更多（即带分组目录的）优先，保证分组信息不丢失。
 */
export function pickBetterSkill(existing: SkillDefinition, incoming: SkillDefinition): SkillDefinition {
  const scopeRank = (scope: 'builtin' | 'project'): number => (scope === 'project' ? 1 : 0)
  const existingRank = scopeRank(existing.scope)
  const incomingRank = scopeRank(incoming.scope)
  if (incomingRank !== existingRank) {
    return incomingRank > existingRank ? incoming : existing
  }
  // 同作用域：路径分段越多（带分组）越优先，避免未分组覆盖分组
  const existingDepth = existing.path.split('/').length
  const incomingDepth = incoming.path.split('/').length
  if (incomingDepth === existingDepth) {
    return existing
  }
  return incomingDepth > existingDepth ? incoming : existing
}

/**
 * 扫描磁盘上的内置和项目 skill，合并后按名称排序返回
 * @param projectId - 项目标识
 * @returns 合并后的 skill 定义列表
 */
export async function scanSkillsFromDisk(projectId?: string): Promise<SkillDefinition[]> {
  const builtinSkills = await scanSkillsUnderRoot(getBuiltinSkillsDirPath(), 'builtin')
  const projectSkills = await scanSkillsUnderRoot(getProjectSkillsDirPath(projectId), 'project')
  const mergedMap = new Map<string, SkillDefinition>()

  for (const skill of builtinSkills) {
    const existing = mergedMap.get(skill.id)
    mergedMap.set(skill.id, existing ? pickBetterSkill(existing, skill) : skill)
  }
  for (const skill of projectSkills) {
    const existing = mergedMap.get(skill.id)
    mergedMap.set(skill.id, existing ? pickBetterSkill(existing, skill) : skill)
  }

  return Array.from(mergedMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/** 扫描指定根目录下所有子目录，将每个目录解析为 SkillDefinition（支持任意深度分组目录） */
async function scanSkillsUnderRoot(root: string, scope: 'builtin' | 'project'): Promise<SkillDefinition[]> {
  if (!existsSync(root)) return []

  const skills: SkillDefinition[] = []

  // 深度优先遍历，收集所有包含 SKILL.md 的目录；skill 目录自包含，找到即收为一个 skill 并停止向下展开。
  async function walk(dir: string, relSegments: string[]): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childDir = join(dir, entry.name)
      if (existsSync(join(childDir, 'SKILL.md'))) {
        const skill = await loadSkillDefinition(root, [...relSegments, entry.name], scope)
        if (skill) skills.push(skill)
      } else {
        await walk(childDir, [...relSegments, entry.name])
      }
    }
  }

  await walk(root, [])
  return skills
}

/** 从单个 skill 目录加载完整定义，解析失败时返回 null */
async function loadSkillDefinition(root: string, relSegments: string[], scope: 'builtin' | 'project'): Promise<SkillDefinition | null> {
  const relPath = relSegments.join('/')
  const skillDir = join(root, relPath)
  const skillPath = join(skillDir, 'SKILL.md')
  const skillName = relSegments[relSegments.length - 1] ?? ''

  try {
    const content = await readFile(skillPath, 'utf-8')
    const frontmatter = parseSkillFrontmatter(content)
    const validatedManifest = validateManifest(frontmatter.manifest)
    const heuristic = inferSkillMeta(skillName, frontmatter.description)
    const fullManifest = buildFullManifest(validatedManifest, heuristic)

    const referencesDir = join(skillDir, 'references')
    const referenceFiles = existsSync(referencesDir) ? await listFilesRecursive(referencesDir) : []
    const referencesCount = referenceFiles.length
    const pathPrefix = scope === 'builtin' ? 'skills' : 'project-skills'
    const pathSegment = `${pathPrefix}/${relPath}`

    return {
      id: skillName,
      name: frontmatter.name || skillName,
      version: frontmatter.version || '',
      path: pathSegment,
      scope,
      rootDir: skillDir,
      description: frontmatter.description || '',
      source: frontmatter.source || '',
      manifest: fullManifest,
      compatibility: frontmatter.overrides.compatibility ?? heuristic.compatibility,
      compatibilityNote: frontmatter.overrides.compatibilityNote ?? heuristic.compatibilityNote,
      // 内置 skills 默认全部启用（除非 frontmatter 显式禁用，或属于当前环境无法运行的 external-only 能力）；
      // 项目扩展 skills 仍沿用启发式判断的默认启用状态。
      enabled: frontmatter.overrides.enabled ?? (scope === 'builtin' ? heuristic.compatibility !== 'external-only' : heuristic.enabled),
      referencesCount,
      referenceFiles: referenceFiles.map((f) => `references/${f}`),
      content
    }
  } catch {
    return null
  }
}

/** 递归列出目录下所有文件，返回相对 root 的路径 */
async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = []

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name)
        continue
      }
      out.push(prefix ? `${prefix}/${entry.name}` : entry.name)
    }
  }

  await walk(root, '')
  return out.sort()
}
