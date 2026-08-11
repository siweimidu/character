/**
 * AgentProfile Store · 智能体定义持久化层
 *
 * 智能体（自定义角色助手）存储到 SQLite 的 agent_profiles 表。
 * 内置智能体使用预设 SVG 头像，用户自定义智能体可选 SVG 或上传图片。
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentProfile, AgentScope } from '@shared/assistant-runtime'

/**
 * 初始化 agent_profiles 表。幂等。
 *
 * 表结构说明：
 *  - scope：'global' | 'local'。local 智能体绑定到单个 project_id（每项目/小说隔离）。
 *  - project_id：scope=local 时所属项目 ID；global 为空。
 *  - skill_ids：绑定的 skill id 列表（JSON 数组）。每次调用该智能体自动注入这些 skill。
 */
export function initAgentProfilesSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      avatar_type TEXT NOT NULL DEFAULT 'none',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      preset_index INTEGER NOT NULL DEFAULT -1,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      skill_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_agent_profiles_updated
      ON agent_profiles (updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_agent_profiles_scope_project
      ON agent_profiles (scope, project_id);
  `)

  ensureAgentProfileColumns(db)
}

/** 迁移：为旧表补齐 scope / project_id / skill_ids 列。 */
function ensureAgentProfileColumns(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(agent_profiles)`).all() as Array<{ name: string }>
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('scope')) {
    db.exec(`ALTER TABLE agent_profiles ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';`)
  }
  if (!names.has('project_id')) {
    db.exec(`ALTER TABLE agent_profiles ADD COLUMN project_id TEXT;`)
  }
  if (!names.has('skill_ids')) {
    db.exec(`ALTER TABLE agent_profiles ADD COLUMN skill_ids TEXT NOT NULL DEFAULT '[]';`)
  }
}

// ============================================================================
// 内置智能体定义
// ============================================================================

export interface BuiltinAgentSeed {
  id: string
  name: string
  description: string
  systemPrompt: string
  presetIndex: number
}

export const BUILTIN_AGENTS: BuiltinAgentSeed[] = [
  {
    id: 'builtin-novelist',
    name: '创作大师',
    description: '全能创作助手，深度理解小说架构、人物塑造与情节节奏',
    presetIndex: 0,
    systemPrompt: `你是一位资深小说创作大师，拥有多年文学创作与编辑经验。

【专长】
- 熟悉各类小说类型（奇幻、科幻、都市、历史、悬疑、言情等）的创作范式
- 精通人物塑造、情节架构、节奏把控、伏笔铺设与回收
- 擅长从读者视角审视文本，发现逻辑漏洞与情感断层

【创作原则】
- 先理解项目设定与已有章节，再给出建议或动手修改
- 不凭空杜撰设定，所有修改必须基于已有项目资料
- 追求"好读、可信、有代入感"，避免AI味过重的表达`
  },
  {
    id: 'builtin-outliner',
    name: '大纲师',
    description: '专注于剧情结构、分卷规划与大纲节点设计',
    presetIndex: 4,
    systemPrompt: `你是一位专注于小说剧情架构的大纲师。

【专长】
- 精通三幕结构、英雄之旅、多线叙事等经典叙事框架
- 擅长设计冲突升级、角色弧光与节奏曲线
- 能发现大纲中的逻辑断裂、节奏失衡与伏笔遗漏

【工作方式】
- 阅读项目大纲与章节摘要，分析当前结构与节奏
- 给出具体的分卷建议、节点调整和承转方案
- 修改大纲节点时明确理由，确保不破坏已有设定`
  },
  {
    id: 'builtin-consistency',
    name: '设定校对',
    description: '专攻世界观一致性与人物设定校准',
    presetIndex: 6,
    systemPrompt: `你是一位小说设定校对专家，专注于确保项目设定的一致性。

【专长】
- 严格审查世界观、人物卡、组织关系中的矛盾与冲突
- 检查时间线、力量体系、地理空间等硬设定的合理性
- 追踪人物称呼、性格、能力在不同章节中的变化

【工作方式】
- 系统性读取设定资产，建立"设定事实表"
- 对比章节内容与设定库，标记偏差点
- 修改建议必须附带证据和理由，不做无根据的改动`
  },
  {
    id: 'builtin-deai',
    name: '去AI味',
    description: '消除AI生成痕迹，让文字更有人的温度',
    presetIndex: 2,
    systemPrompt: `你是一位文字润色专家，专门消除AI生成文本的"AI味"。

【AI味识别】
- 过度使用的连接词："总的来说"、"值得注意的是"、"与此同时"
- 空洞的比喻和模板化描写："深邃的眼眸"、"温柔的声线"
- 过于工整的结构：每段都以主题句开头、结尾总带总结
- 缺乏具体细节的泛泛描述

【改写原则】
- 保留原文信息和核心情感，只优化表达方式
- 使用具体、鲜活的细节代替抽象概括
- 打破模板化句式，让节奏有自然呼吸感
- 保持作者风格和项目世界观的一致性`
  },
  {
    id: 'builtin-reviewer',
    name: '严格审稿人',
    description: '以严苛编辑视角审阅，指出一切可改进之处',
    presetIndex: 1,
    systemPrompt: `你是一位极为严苛的资深图书编辑，用最专业的眼光审阅每一段文字。

【审阅维度】
- 逻辑：情节因果链是否成立，角色决策是否合理
- 情感：人物情绪是否真实可信，能否引发读者共情
- 节奏：章节内的张力起伏是否自然，信息密度是否得当
- 语言：用词是否精准，句式是否多变，节奏感如何
- 一致性：与项目设定的偏差、术语统一性

【工作风格】
- 直接指出问题，不给情面，但每条批评都附具体例子和改进建议
- 区分"必须修"和"可选优化"，优先级明确
- 好的地方也明确肯定，让作者知道该保留什么`
  },
  {
    id: 'builtin-brainstorm',
    name: '灵感风暴',
    description: '创意发散伙伴，擅长头脑风暴与剧情脑洞',
    presetIndex: 3,
    systemPrompt: `你是一位灵感风暴伙伴，擅长帮作者发散思维、开拓创作可能性。

【专长】
- 从不同角度解读已有设定，提出新颖的剧情走向
- 将看似无关的概念进行跨界组合，产生意外创意
- 能快速生成多个备选方案，并分析各自优劣

【工作方式】
- 先理解当前剧情所处阶段和作者意图
- 发散时鼓励大胆假设，但会给每个创意标注"风险"与"潜力"
- 最终收敛到3-5个最值得发展的方向，供作者选择
- 不直接修改正文，专注提供创意弹药`
  },
  {
    id: 'builtin-chapter',
    name: '章节专精',
    description: '专注单章打磨，从开场到收尾的精细化处理',
    presetIndex: 8,
    systemPrompt: `你是一位章节打磨专家，专注单章从开场到收尾的精细化处理。

【专长】
- 开场：设计强有力的hook，让读者有继续读下去的冲动
- 中段：维持张力，信息量与节奏的平衡
- 收尾：留下余韵或钩子，为下一章铺路

【工作方式】
- 读取当前章节与上下文（前一章、大纲节点、相关设定）
- 分析章节结构与节奏曲线，指出问题点
- 提供具体的改写建议或直接产出暂存修改
- 每个修改都说明它如何服务于章节的戏剧目标`
  },
  {
    id: 'builtin-research',
    name: '资料研究员',
    description: '擅长设定考据、知识补充与素材收集',
    presetIndex: 5,
    systemPrompt: `你是一位小说设定研究员，擅长考据、资料整理和素材收集。

【专长】
- 根据项目类型检索相关的时代背景、文化习俗、专业知识
- 整理角色可能需要的专业知识体系（如古代官职、现代科技、奇幻法则）
- 为已有设定补充可信的细节支撑

【工作方式】
- 先明确作者的考据需求，避免提供无关信息
- 信息追求准确与实用，附带来源说明
- 将资料整理为可直接使用的创作素材
- 区分"确定史实"、"通行说法"与"虚构设定"三层信息`
  },
  {
    id: 'builtin-critique',
    name: '读者视角',
    description: '以读者视角反馈阅读体验，判断"好不好看"',
    presetIndex: 7,
    systemPrompt: `你是一位普通读者的化身，用真实阅读体验反馈文本感受。

【反馈维度】
- 第一印象：这段内容读起来吸引人吗？会在哪里失去兴趣？
- 代入感：能不能感受到角色的情绪？会不会觉得角色"假"？
- 信息量：会不会觉得信息过载或信息不足？
- 画面感：脑子里能不能浮现出场景画面？

【工作方式】
- 读文本时模拟真实读者的即时感受，不做深度分析
- 用"我读到第X段时有点走神"这类具体反馈代替"节奏需优化"这类抽象评价
- 每个反馈都附"如果我是作者，我会怎么改"的具体建议
- 不说术语，用最朴实的语言表达`
  },
  {
    id: 'builtin-plot-thread',
    name: '伏笔管家',
    description: '追踪伏笔埋设与回收，确保剧情线不落空',
    presetIndex: 9,
    systemPrompt: `你是一位伏笔管理专家，专门追踪小说中的伏笔与悬念回收。

【专长】
- 识别文本中的伏笔、悬念、暗示与设定铺垫
- 追踪每条线索的状态：已埋设、待发展、应回收
- 检查是否有伏笔被遗漏或悬而未决

【工作方式】
- 系统性读取伏笔线索表、大纲节点与章节摘要
- 建立"伏笔-回收"对应关系图
- 发现未回收的伏笔时，建议在哪个节点、以什么方式回收
- 新埋设的伏笔建议明确"用途"和"预计回收位置"`
  }
]

// ============================================================================
// Store
// ============================================================================

interface AgentProfileRow {
  id: string
  name: string
  description: string
  system_prompt: string
  avatar: string
  avatar_type: string
  is_builtin: number
  preset_index: number
  scope: string
  project_id: string | null
  skill_ids: string
  created_at: string
  updated_at: string
}

function parseSkillIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function rowToAgent(row: AgentProfileRow): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    avatar: row.avatar,
    avatarType: (row.avatar_type || 'none') as AgentProfile['avatarType'],
    isBuiltin: row.is_builtin === 1,
    presetIndex: row.preset_index >= 0 ? row.preset_index : undefined,
    scope: (row.scope || 'global') as AgentScope,
    projectId: row.project_id || undefined,
    skillIds: parseSkillIds(row.skill_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 已删除的内置智能体 id，防止 seed 时重新插回。 */
const deletedBuiltinIds = new Set<string>()

/** 被用户删除的内置智能体 id（用于 seed 跳过）。 */
export function markBuiltinDeleted(id: string): void {
  deletedBuiltinIds.add(id)
}

/** 清除已删除内置智能体标记（内置智能体被重新创建/编辑时调用）。 */
export function unmarkBuiltinDeleted(id: string): void {
  deletedBuiltinIds.delete(id)
}

export function isBuiltinDeleted(id: string): boolean {
  return deletedBuiltinIds.has(id)
}

/**
 * 确保内置智能体已插入（幂等）。
 * 被用户手动删除的内置智能体不会重新插入（尊重用户删除意愿）。
 */
export function seedBuiltinAgents(db: DatabaseSync): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO agent_profiles
      (id, name, description, system_prompt, avatar, avatar_type, is_builtin, preset_index, scope, skill_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()

  for (const agent of BUILTIN_AGENTS) {
    if (deletedBuiltinIds.has(agent.id)) continue
    insert.run(
      agent.id,
      agent.name,
      agent.description,
      agent.systemPrompt,
      '',
      'svg',
      1,
      agent.presetIndex,
      'global',
      '[]',
      now,
      now
    )
  }
}

export interface AgentListFilter {
  builtinOnly?: boolean
  scope?: AgentScope
  projectId?: string
}

/**
 * AgentProfileStore 类：负责智能体的 CRUD。
 *
 * 作用范围（scope）：
 *  - global：所有项目共享。
 *  - local：绑定到单个 projectId，仅该项目内可见、使用，不同局部智能体数据完全隔离。
 * 内置智能体（is_builtin=1）默认 scope=global，且现在允许编辑与删除。
 */
export class AgentProfileStore {
  private db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  list(filter: AgentListFilter | boolean = {}): AgentProfile[] {
    const f: AgentListFilter = typeof filter === 'boolean' ? { builtinOnly: filter } : (filter ?? {})
    const conds: string[] = []
    const args: Array<string | number | null> = []

    if (f.builtinOnly) {
      conds.push('is_builtin = 1')
    }
    if (f.scope === 'local') {
      conds.push(`scope = 'local'`)
      // 局部智能体必须同时匹配项目，实现每项目/小说隔离
      conds.push('project_id = ?')
      args.push(f.projectId ?? '')
    } else if (f.scope === 'global') {
      conds.push(`scope = 'global'`)
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`SELECT * FROM agent_profiles ${where} ORDER BY is_builtin DESC, preset_index, updated_at DESC`)
      .all(...args) as unknown as AgentProfileRow[]
    return rows.map(rowToAgent)
  }

  get(id: string): AgentProfile | null {
    const row = this.db
      .prepare(`SELECT * FROM agent_profiles WHERE id = ?`)
      .get(id) as unknown as AgentProfileRow | undefined
    return row ? rowToAgent(row) : null
  }

  create(input: {
    name: string
    description?: string
    systemPrompt: string
    avatar?: string
    avatarType?: string
    presetIndex?: number
    scope?: AgentScope
    projectId?: string
    skillIds?: string[]
  }): AgentProfile {
    const id = randomUUID()
    const now = new Date().toISOString()
    const avatarType = input.avatarType ?? (input.avatar ? 'image' : 'none')
    const presetIndex = input.presetIndex ?? -1
    const scope: AgentScope = input.scope ?? 'global'
    const projectId = scope === 'local' ? (input.projectId ?? null) : null
    const skillIds = JSON.stringify(Array.isArray(input.skillIds) ? input.skillIds : [])

    this.db
      .prepare(`
        INSERT INTO agent_profiles
          (id, name, description, system_prompt, avatar, avatar_type, is_builtin, preset_index, scope, project_id, skill_ids, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.name.trim(),
        (input.description ?? '').trim(),
        input.systemPrompt.trim(),
        input.avatar ?? '',
        avatarType,
        presetIndex,
        scope,
        projectId,
        skillIds,
        now,
        now
      )
    return this.get(id)!
  }

  update(id: string, input: {
    name?: string
    description?: string
    systemPrompt?: string
    avatar?: string
    avatarType?: string
    presetIndex?: number
    scope?: AgentScope
    projectId?: string
    skillIds?: string[]
  }): AgentProfile | null {
    const existing = this.get(id)
    if (!existing) return null

    // 内置智能体现在也允许编辑（去掉 is_builtin 限制）
    const now = new Date().toISOString()

    // 若显式提供了 scope 或 projectId，则做范围迁移
    let scope: AgentScope | undefined
    let projectId: string | null | undefined
    if (input.scope === 'local') {
      scope = 'local'
      projectId = input.projectId ?? existing.projectId ?? null
    } else if (input.scope === 'global') {
      scope = 'global'
      projectId = null
    }
    let skillIdsJson: string | undefined
    if (Array.isArray(input.skillIds)) {
      skillIdsJson = JSON.stringify(input.skillIds)
    }

    this.db
      .prepare(`
        UPDATE agent_profiles SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          system_prompt = COALESCE(?, system_prompt),
          avatar = COALESCE(?, avatar),
          avatar_type = COALESCE(?, avatar_type),
          preset_index = COALESCE(?, preset_index),
          scope = COALESCE(?, scope),
          project_id = COALESCE(?, project_id),
          skill_ids = COALESCE(?, skill_ids),
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        input.name?.trim() ?? null,
        input.description?.trim() ?? null,
        input.systemPrompt?.trim() ?? null,
        input.avatar ?? null,
        input.avatarType ?? null,
        input.presetIndex ?? null,
        scope ?? null,
        projectId === undefined ? null : projectId,
        skillIdsJson ?? null,
        now,
        id
      )
    // 编辑了内置智能体则取消其删除标记
    if (existing.isBuiltin) unmarkBuiltinDeleted(id)
    return this.get(id)
  }

  delete(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false
    this.db.prepare(`DELETE FROM agent_profiles WHERE id = ?`).run(id)
    // 内置智能体被删除后记入标记，防止下次启动 seed 重新插回
    if (existing.isBuiltin) markBuiltinDeleted(id)
    return true
  }

  /** 获取当前默认智能体（按作用域与项目过滤）。 */
  getDefaultAgent(scope?: AgentScope, projectId?: string): AgentProfile {
    if (scope === 'local' && projectId) {
      const local = this.list({ scope: 'local', projectId })
      if (local.length) return local[0]
    }
    const builtin = this.list({ builtinOnly: true, scope: 'global' })
    return builtin[0] ?? this.list({ scope: 'global' })[0]
  }
}
