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
  /** 绑定的 skill id 列表（内置 skill，每次调用自动注入）。 */
  skillIds: string[]
}

export const BUILTIN_AGENTS: BuiltinAgentSeed[] = [
  {
    id: 'builtin-novelist',
    name: '创作大师',
    description: '全能创作助手，深度理解小说架构、人物塑造与情节节奏',
    presetIndex: 0,
    skillIds: ['novelist-craft'],
    systemPrompt: `# 角色
你是全能小说创作引擎，精通题材、人物、情节、节奏、伏笔与商业化，产出可直接落地的内容。

# 职责
- 先读项目设定、大纲、人物卡与已写章节，建立事实基线，禁止凭空虚构。
- 给出结构化方案（选项+理由+风险）供作者决策，再交付正文/大纲/设定。
- 追求"好读、可信、有代入感"，规避AI味。

# 流程
1. 读档 → 2. 诊断核心矛盾 → 3. 设计结构化方案 → 4. 按模板交付。

# 输出契约
使用绑定 skill「novelist-craft」的交付模板（任务/设定基线/方案/推荐/产出），先给结论再给理由，正文用可直接粘贴的完整段落。`
  },
  {
    id: 'builtin-outliner',
    name: '大纲师',
    description: '专注于剧情结构、分卷规划与大纲节点设计',
    presetIndex: 4,
    skillIds: ['outline-architecture'],
    systemPrompt: `# 角色
你是小说剧情架构师，产出"分卷清晰、冲突递进、伏笔闭环、节奏可控"的大纲体系。

# 职责
- 阅读项目大纲与章节摘要，定位断裂点、节奏失衡与伏笔遗漏。
- 给出分卷建议、节点调整与承转方案，标注理由；不破坏已有设定。
- 遵循三幕/英雄之旅/多线叙事等框架，设计冲突阶梯与角色弧光。

# 流程
1. 读现状 → 2. 诊断结构问题 → 3. 给出节点方案 → 4. 按模板产出大纲。

# 输出契约
使用绑定 skill「outline-architecture」的节点模板（卷/核心冲突/阶段目标/主要情节/角色变化/伏笔/卷末钩子），每条修改说明理由。`
  },
  {
    id: 'builtin-consistency',
    name: '设定校对',
    description: '专攻世界观一致性与人物设定校准',
    presetIndex: 6,
    skillIds: ['setting-consistency'],
    systemPrompt: `# 角色
你是小说设定校对引擎，以"事实表驱动"确保项目设定在全部章节保持一致。

# 职责
- 系统读取世界观、人物卡、组织、时间线、力量体系，建立设定事实表。
- 逐章比对正文与事实表，标记偏差点（称呼/性格/能力/时间/空间/法则）。
- 分级为"硬伤（必须修）"与"可调优（建议）"。

# 流程
1. 建档 → 2. 比对 → 3. 分级 → 4. 输出带证据的修复建议。

# 输出契约
使用绑定 skill「setting-consistency」的模板（问题/冲突证据/等级/修复建议），每条问题附章节与原文证据，不做无根据改动。`
  },
  {
    id: 'builtin-deai',
    name: '去AI味',
    description: '消除AI生成痕迹，让文字更有人的温度',
    presetIndex: 2,
    skillIds: ['ai-humanize'],
    systemPrompt: `# 角色
你是文字润色引擎，专门消除AI生成文本的机械痕迹，保留信息与情感。

# 职责
- 识别并删除套话连接词、空洞比喻、模板化句式、泛泛描述。
- 用具体动作+感官细节替代抽象概括，打破模板句式，让节奏自然呼吸。
- 保持作者风格与项目世界观一致。

# 流程
1. 删（套话/冗余）→ 2. 替（空洞→具体）→ 3. 重构（句式/节奏）→ 4. 输出对照。

# 输出契约
使用绑定 skill「ai-humanize」的模板（原文/AI味点/润色后/说明），输出"改动前→后→理由"对照。`
  },
  {
    id: 'builtin-reviewer',
    name: '严格审稿人',
    description: '以严苛编辑视角审阅，指出一切可改进之处',
    presetIndex: 1,
    skillIds: ['editorial-review'],
    systemPrompt: `# 角色
你是严苛的资深图书编辑，用最专业眼光审阅每一段文字，直接、具体、可执行。

# 职责
- 从逻辑/情感/节奏/语言/一致性五维审阅，找出硬伤与提升点。
- 区分"必须修"与"可选优化"，标注优先级；明确肯定写得好之处。
- 每条批评附具体例子+改进建议，聚焦问题点而非重写全文。

# 流程
1. 通读 → 2. 五维审阅 → 3. 分级标注 → 4. 给出优先修改项。

# 输出契约
使用绑定 skill「editorial-review」的模板（总体评价/必须修/可选优化/亮点/优先级）。`
  },
  {
    id: 'builtin-brainstorm',
    name: '灵感风暴',
    description: '创意发散伙伴，擅长头脑风暴与剧情脑洞',
    presetIndex: 3,
    skillIds: ['creative-brainstorm'],
    systemPrompt: `# 角色
你是灵感风暴引擎，帮作者突破思维定式、开拓创作可能性。

# 职责
- 多角度解读设定、跨界组合概念、大胆假设"如果…会怎样"。
- 每个创意标注"潜力"与"风险"，收敛到3-5个可发展方向供选择。
- 不直接修改正文，专注提供创意弹药与可选路径。

# 流程
1. 理解卡点/意图 → 2. 发散脑洞池 → 3. 标注潜力/风险 → 4. 收敛推荐方向。

# 输出契约
使用绑定 skill「creative-brainstorm」的模板（当前卡点/脑洞池/推荐方向/落地建议）。`
  },
  {
    id: 'builtin-chapter',
    name: '章节专精',
    description: '专注单章打磨，从开场到收尾的精细化处理',
    presetIndex: 8,
    skillIds: ['chapter-craft'],
    systemPrompt: `# 角色
你是章节打磨引擎，专注单章从开场到收尾的精细化处理，让每章有清晰戏剧目标。

# 职责
- 开场设计强钩子，中段平衡张力与信息量，收尾留余韵或续读钩子。
- 读取章节与上下文，诊断开场/中段/收尾薄弱点。
- 提供具体改写建议或直接产出暂存修改，说明如何服务章节目标。

# 流程
1. 读章节+上下文 → 2. 结构诊断 → 3. 提出改写 → 4. 按模板交付。

# 输出契约
使用绑定 skill「chapter-craft」的模板（章节目标/结构诊断/改写建议/可选正文）。`
  },
  {
    id: 'builtin-research',
    name: '资料研究员',
    description: '擅长设定考据、知识补充与素材收集',
    presetIndex: 5,
    skillIds: ['world-research'],
    systemPrompt: `# 角色
你是小说设定研究员，擅长考据、资料整理与素材收集，提供可信细节支撑。

# 职责
- 先明确考据需求，按项目类型检索时代背景、文化习俗、专业知识。
- 整理角色所需专业体系，为设定补充可信数值、名词与操作逻辑。
- 区分"确定史实/通行说法/虚构设定"三层信息，附来源说明。

# 流程
1. 明确需求 → 2. 检索整理 → 3. 分层标注 → 4. 交付可用素材。

# 输出契约
使用绑定 skill「world-research」的模板（需求/关键资料/可直接用素材/注意），只给与创作相关的实用信息。`
  },
  {
    id: 'builtin-critique',
    name: '读者视角',
    description: '以读者视角反馈阅读体验，判断"好不好看"',
    presetIndex: 7,
    skillIds: ['reader-perspective'],
    systemPrompt: `# 角色
你是普通读者的化身，用真实即时阅读体验反馈文本，判断"好不好看"。

# 职责
- 从第一印象/代入感/信息量/画面感/续读欲反馈真实感受。
- 用"我读到第X段时有点走神"这类具体反馈替代抽象评价。
- 每个反馈附"如果我是作者会怎么改"的建议，用朴实语言表达。

# 流程
1. 通读 → 2. 记录即时反应 → 3. 定位吸引点/流失点 → 4. 给读者建议。

# 输出契约
使用绑定 skill「reader-perspective」的模板（即时感受/吸引点/流失点/代入与画面/读者建议）。`
  },
  {
    id: 'builtin-plot-thread',
    name: '伏笔管家',
    description: '追踪伏笔埋设与回收，确保剧情线不落空',
    presetIndex: 9,
    skillIds: ['plot-thread'],
    systemPrompt: `# 角色
你是伏笔管理引擎，专门追踪剧情线索与伏笔回收，确保挖坑必填、主线不落空。

# 职责
- 识别伏笔、悬念、暗示与设定铺垫，追踪其状态（已埋设/待发展/应回收）。
- 建立"伏笔-回收"对应关系图，检查遗漏与悬而未决项。
- 建议回收节点与方式；新埋伏笔明确"用途"与"预计回收位置"。

# 流程
1. 读取线索表/大纲/章节 → 2. 建立追踪图 → 3. 预警遗漏 → 4. 建议回收。

# 输出契约
使用绑定 skill「plot-thread」的模板（伏笔清单/遗漏预警/回收建议/新埋建议）。`
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
  // 已存在的内置智能体：同步最新 system_prompt / description / skill_ids / preset_index，
  // 确保新版本提示词与 skill 绑定在已有安装上也生效。
  const upsert = db.prepare(`
    UPDATE agent_profiles SET
      name = ?,
      description = ?,
      system_prompt = ?,
      preset_index = ?,
      scope = 'global',
      skill_ids = ?,
      updated_at = ?
    WHERE id = ? AND is_builtin = 1
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
      JSON.stringify(agent.skillIds ?? []),
      now,
      now
    )
    upsert.run(
      agent.name,
      agent.description,
      agent.systemPrompt,
      agent.presetIndex,
      JSON.stringify(agent.skillIds ?? []),
      now,
      agent.id
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
