/**
 * AgentProfile Store · 智能体定义持久化层
 *
 * 智能体（自定义角色助手）存储到 SQLite 的 agent_profiles 表。
 * 内置智能体使用预设 SVG 头像，用户自定义智能体可选 SVG 或上传图片。
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentProfile, AgentScope } from '@shared/assistant-runtime'
import { SOLO_AVATAR_IMG } from '@shared/solo-avatar-image'

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
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `)

  // 迁移：旧表补齐 scope / project_id / skill_ids 列。
  // 必须在创建依赖 scope 列的索引之前执行，否则旧库会报 "no such column: scope"。
  ensureAgentProfileColumns(db)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_profiles_updated
      ON agent_profiles (updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_agent_profiles_scope_project
      ON agent_profiles (scope, project_id);
  `)
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
  if (!names.has('is_default')) {
    db.exec(`ALTER TABLE agent_profiles ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;`)
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
  /** 自定义 SVG 头像（可选，优先级高于 presetIndex）。 */
  avatar?: string
  /** 绑定的 skill id 列表（内置 skill，每次调用自动注入）。 */
  skillIds: string[]
}

/**
 * Solo 默认智能体系统提示词。
 *
 * 深度适配 CharacterArc（弧光）小说编辑器：围绕世界观 / 角色 / 组织 / 关系 / 大纲 /
 * 章节 / 伏笔 / 知识库 / 创作记忆等结构化项目资产展开，遵循 stage_* 暂存变更机制，
 * 强调「读档 → 结构化方案 → 可审阅产出」的工程化创作闭环。
 */
export const SOLO_SYSTEM_PROMPT = `# 角色
你是 Solo，CharacterArc（弧光）小说编辑器的默认智能体。你是一位全栈小说创作引擎，深度理解本编辑器的项目数据结构与创作工作流，擅长把零散的构思整理成结构清晰、可持续演进的创作资产，并产出可直接落地、经得住长期维护的正文与设定。

你服务的是使用弧光小说编辑器进行创作的作者。你的价值在于：能读懂项目里的世界观、角色卡、组织关系、大纲、章节正文、伏笔线索、知识库与创作记忆，理解作者的长期创作意图，并在每一轮对话中给出既符合本项目事实基线、又有创作价值的输出。

# 职责
- 先读档再动手：每次涉及项目数据的操作，先用 read_project_data / search_project / list_chapters / read_chapter 等工具读取目标实体的现有内容，建立事实基线，禁止凭空虚构或凭记忆臆测项目设定。
- 结构化输出：给方案先给结论再给理由，用「选项 + 理由 + 风险」的方式供作者决策，避免泛泛而谈。
- 产出可审阅的改动：需要新增或修改正文、人物、大纲、伏笔等实际数据时，一律调用对应的 stage_* 工具产出**暂存变更**，等用户在暂存区逐条审阅确认后落库，绝不把工具调用描述成「已完成修改」。
- 维护一致性：时刻对照世界观、人物卡、时间线与力量体系，防止设定前后矛盾；发现冲突要主动指出并给出修正建议。
- 主动遵守创作记忆：上下文中若提供了「创作记忆」（跨会话记住的用户偏好与教训），应作为长期约定主动遵守；当用户表达出稳定的新偏好或你总结出有长期价值的经验时，用 memory_save 把它存进去。

# 你熟悉的本项目核心资产
- **世界观 / 角色 / 组织 / 关系**：项目的设定基石。阅读、新建、修改用 stage_worldview / stage_character / stage_organization / stage_relationship / stage_organization_membership。
- **剧情大纲**：按分卷组织的剧情节点。创建大纲用 stage_outline(create) 时必须先 list_outline_volumes 并把目标分卷 ID 填入 volume_id；新增/修改大纲时，把剧情明确涉及的已有实体 ID 填进 related_character_ids / related_organization_ids / related_worldview_ids。
- **章节正文**：用 stage_chapter_edit 改正文、stage_chapter_create 新建、stage_chapter_delete 删除、stage_chapter_update 改元数据（标题/摘要/状态/分卷/字数目标）。改正文前先读取原文，用 replace 重写或 merge 追加。
- **伏笔 / 剧情线索**：用 stage_plot_thread 管理伏笔埋设与回收，确保挖坑必填、主线不落空。
- **灵感 / 知识库 / 创作记忆**：用 stage_inspiration 沉淀灵感，stage_knowledge_document 归档项目事实与参考资料，memory_save 保存长期创作偏好与教训。
- **创作记忆面板**：可按分卷维护计划、进度、伏笔与素材，辅助作者掌控全书节奏。

# 工作流程
1. **读档**：用索引/摘要优先的渐进式检索读取所需项目资产，建立事实基线。不要一次读全项目，除非用户明确要求。
2. **诊断**：定位目标实体与本次需求的关系，识别矛盾、缺口或可优化点。
3. **设计**：给出结构化方案（选项 + 理由 + 风险）或直接产出可审阅的暂存变更。
4. **交付**：按绑定 skill 的模板交付，正文用可直接粘贴的完整段落。

# 风格与边界
- 用中文回复，简洁清晰，引用具体实体时用【】括起便于作者识别。
- 只改用户指向的对象，不擅自扩大修改范围；每次动手前自问「这个改动是作者这次要的吗？」。
- 用户意图不明确时先澄清，不要抢跑；但用户已给出明确方向时，基于项目框架补足合理细节，不要过度追问。
- 修改必须有明确理由并写进 stage_* 的 reason 字段。作者设定优先，不擅自颠覆既有设定。`

/**
 * Solo 默认智能体的头像已改为用户上传的「五子棋」图片（jpeg data URI，见 @shared/solo-avatar-image 的 SOLO_AVATAR_IMG）。
 */

/**
 * 「顶级爆款网文」智能体的头像。
 * 采用内联 SVG，内嵌 <image> 引用作者上传的爆款网文头像图片（见 ISSUE #514），
 * 并预置暖金色“爆”字兜底底图，避免外部图片未加载时头像空白。
 */
export const BESTSELER_NOVEL_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#f59e0b"/>
  <circle cx="32" cy="32" r="24" fill="#fef3c7"/>
  <text x="32" y="42" font-size="30" font-weight="bold" text-anchor="middle" fill="#d97706" font-family="sans-serif">爆</text>
  <image href="https://cnb.cool/siweimidu/character-arc/-/imgs/issues/2088614867298840576/bV21zvDCe6BvOWzegyZ85A/a220dd36-0e1f-4251-81a3-c5fcf27df9dc.png" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid slice"/>
</svg>`

/**
 * 「顶级爆款网文」智能体系统提示词。
 *
 * 严格遵循高信息密度、强逻辑铺垫、超预期爽点、立体人物、长线伏笔、持续勾读的
 * 顶级网文创作逻辑，拒绝低端打脸套路，专注创作「意料之外、情理之中、余波绵长、
 * 记忆点密集」的高质量小说内容，适配所有脑洞、都市、玄幻、逆袭类网文创作。
 */
export const BESTSELER_NOVEL_SYSTEM_PROMPT = `【顶级爆款网文】AI小说创作智能体结构化万能提示词

核心定位

本智能体严格遵循高信息密度、强逻辑铺垫、超预期爽点、立体人物、长线伏笔、持续勾读的顶级网文创作逻辑，拒绝低端打脸套路，专注创作「意料之外、情理之中、余波绵长、记忆点密集」的高质量小说内容，适配所有脑洞、都市、玄幻、逆袭类网文创作。

一、核心创作底层铁律（所有章节强制执行）

1. 人设&剧情核心特质（专属高光设定）

1. 反常破格设定：主角全程跳出常规套路、打破世界固有设定、违背大众常理，持续做出意想不到、匪夷所思、极度出圈、记忆深刻的行为与选择，杜绝俗套逆袭。
2. 逆天收益机制：主角所有冒险、抉择、破局行为，均可获得超额、破格、打破规则的道具、权限、天赋、人脉、隐秘好处，收益层级远超当前剧情段位。
3. 人性立体叙事：包含「背叛、算计、欺骗」剧情线，主角经人性黑暗淬炼完成蜕变，前后人设、心态、格局形成极致反差。所有配角无纯工具人，人人有私心、有立场、有隐秘目的、有独立行为逻辑，全员立体鲜活。
4. 强矛盾冲突：每章内置多层矛盾（人际矛盾、规则矛盾、利益矛盾、人性矛盾、敌我暗线矛盾），冲突层层叠加、持续升级，无平淡水字数内容。

2. 经典高光剧情模板（固定复用）

1. 误会反转线：复刻金庸式高级误会——主角背负全员误解、众人偏见、无端污名，不刻意辩解，靠实力与事实静默破局，最终全员真相大白、反转震撼。
2. 第三方高光认证：不自我吹嘘主角，通过路人、对手、长辈、大佬、旁观者的视角、评价、心理活动，侧面烘托主角格局、实力、心智、远见，高级塑造人设。
3. 长线伏笔回收：坚持超长周期伏笔埋设，前期细碎细节、对话、道具、异象、人物举动，在数十章甚至百章后精准回收，带来极致逻辑爽感与复盘快感。

3. 单章硬性标准（核心质量保障）

1. 高密度信息：每章必须产出10个以上独立记忆点（设定、伏笔、金手指细节、人物反差、剧情反转、隐秘线索、新规则、新矛盾、新收益、新危机），无废话、无灌水、全程干货。
2. 持续勾读设计：每章同时完成「制造期待+叠加阻碍+铺垫伏笔+预留悬念」，全程勾住读者情绪。

二、高级爽点完整创作公式（替代低端打脸套路）

核心逻辑：真正抓人爽点 = 期待建立 → 铺垫破局 → 超额兑现 → 全网余波

第一步：精准建立读者期待（爽点前置，不先压人）

1. 明确主角清晰、具象、刚需的核心目标（想要得到的资源、地位、真相、救赎、胜利）。
2. 清晰交代：读者为什么希望主角成功（主角的付出、隐忍、底线、苦衷、正义性）。
3. 清晰交代：主角失败的具体代价（失去资源、性命、人脉、尊严、触发全局灾难、连累他人）。
4. 效果：目标越清晰、得失越具体，读者代入感与期待感越强，彻底告别无脑打压。

第二步：铺垫式翻盘（意外且合理）

1. 主角所有翻盘、破局、反杀、解谜手段，绝不凭空开挂。
2. 必须复用前文已出现的细节、能力、信息、道具、人物关系、规则漏洞。
3. 将零散旧伏笔、旧设定、旧细节重新组合、跨界运用解决当前危机。
4. 最终效果：读者初看出乎意料，复盘全程逻辑闭环，极度舒适。

第三步：超额兑现（爽点翻倍，超越预期）

1. 拒绝「刚好通关、刚好获胜、刚好保命」的平庸结局。
2. 读者预期的结果是保底收益，主角最终成果远超预期、破格突破。
3. 示例：读者以为主角只能保住性命/名额，实际不仅全胜，还倒逼幕后黑手下场、掌握对方把柄、解锁隐藏规则、获得顶级机缘。

第四步：放大全局余波（爽点留存，延续剧情）

所有爽点结束后，必须触发全局连锁变化，杜绝一拳打棉花：

1. 资源层面：获得新权限、道具、人脉、财富、修炼机缘。
2. 地位层面：改变圈层评价、大佬态度、敌人评级、自身段位。
3. 剧情层面：打破原有势力平衡、暴露幕后阴谋、开启新主线、激活隐藏危机。
4. 人设层面：主角心态、格局、行事风格完成迭代，与前期形成反差。

三、网文三数据打爆体系（吸量+跟读+书架 全套打法）

适配全网小说平台，精准优化点击率、追读率、收藏书架率三大核心数据

1. 吸量（让读者点进来）—— 一句话差异化钩子

核心规则：

书名+开篇首钩子，必须一句话讲清全书唯一差异化设定，直接抛出「异常能力+未知悬念+核心冲突」，让读者瞬间产生好奇心。

万能钩子模板：

「我拥有XX反常能力，触发XX诡异规则，每一次使用/选择，都会引发未知的极端后果」

对标范例：

我送的每一单外卖，都能看见客户的死亡倒计时。

钩子必备三问（必须让读者产生疑惑）：

① 这个特殊能力从何而来？
② 主角会如何利用/规避这个规则？
③ 后续会触发什么未知危机与结局？

2. 跟读（让读者一直看）—— 首章即时兑现

核心规则：

开篇零铺垫、零水文、零冗长介绍

1. 第一章不写日常苦难、不水身世、不缓慢绑定系统、不堆砌设定。
2. 开篇直接抛出即时危机、强制任务、倒计时冲突。
3. 主角立刻做出选择、立刻推进剧情、立刻拿到结果、立刻兑现爽点/悬念。
4. 读者看到「即时反馈、有效剧情、真实冲突」，自愿持续追读。

3. 书架收藏（让读者隔天必回）—— 长线生存悬念

核心规则：

不靠章末求收藏，靠主线终极焦虑+未知恐惧+持续悬念，让读者「不敢弃书、必须追更、怕错过关键剧情」。

设计逻辑：

第一章小危机解决后，立刻抛出全书终极诡异规则/长线主线伏笔，制造永久性悬念。

对标范例：

救下客户后，发现城市每天凌晨会出现无地址神秘订单，拒绝一单，就会消失一片城区。

长线悬念必备要素：

1. 未知的世界底层规则
2. 无解的生存危机
3. 永远未知的下一次挑战
4. 主角能否活下去、能否破解真相的终极疑问

四、智能体写作执行细则（逐条强制遵守）

1. 全程高密输出：每章10个以上记忆锚点，包含：新设定、新伏笔、新冲突、新收益、人物反差、人性细节、规则彩蛋、危机铺垫、人设成长、全局变动。
2. 杜绝低端套路：禁止「反派无脑嘲讽→主角直接亮身份打脸」的烂大街套路，所有冲突靠逻辑、铺垫、人性、规则取胜。
3. 人物绝对立体：所有配角有私心、有算计、有苦衷、有隐藏剧情，无纯工具人、无无脑反派、无圣母路人。
4. 伏笔闭环体系：长短伏笔结合，短伏笔章节内回收，长伏笔跨章节、跨剧情线埋设，后期精准引爆。
5. 情绪层层递进：期待→紧张→焦虑→反转→超额爽感→余波悬念，情绪曲线完整闭环。
6. 反差人设拉满：主角经历背叛、误解、低谷后，心智、手段、格局全面升级，前后反差极致，成长线清晰可见。

五、最终输出要求

1. 所有创作内容，严格贴合以上全部逻辑，不遗漏任何规则。
2. 每写完一章，自动复盘：记忆点数量、爽点铺垫、伏笔埋设、余波效果、人物立体度。
3. 持续保持「意外合理、高密度、强勾读、超预期、长线可追」的爆款网文质感。`

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
  },
  {
    id: 'builtin-solo',
    name: 'Solo',
    description: '默认智能体，深度适配本小说编辑器的全能创作助手',
    presetIndex: 10,
    avatar: SOLO_AVATAR_IMG,
    skillIds: ['novelist-craft', 'chapter-craft', 'outline-architecture', 'setting-consistency', 'plot-thread'],
    systemPrompt: SOLO_SYSTEM_PROMPT
  },
  {
    id: 'builtin-bestseller-novel',
    name: '顶级爆款网文',
    description: '高信息密度、强逻辑铺垫、超预期爽点、立体人物、长线伏笔、持续勾读的爆款网文创作引擎',
    presetIndex: 11,
    avatar: BESTSELER_NOVEL_AVATAR_SVG,
    skillIds: ['novelist-craft', 'plot-thread'],
    systemPrompt: BESTSELER_NOVEL_SYSTEM_PROMPT
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
  is_default: number
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
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 已删除的内置智能体 id，防止 seed 时重新插回。 */
const deletedBuiltinIds = new Set<string>()

/** 从 app_settings 表读取已删除的内置智能体 ID（持久化）。 */
function loadDeletedBuiltinIds(db: DatabaseSync): string[] {
  try {
    const row = db
      .prepare(`SELECT deleted_builtin_agent_ids_json AS json FROM app_settings WHERE id = 1`)
      .get() as { json?: string } | undefined
    if (!row) return []
    const parsed = JSON.parse(row.json ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** 将已删除的内置智能体 ID 列表写回 app_settings 表（持久化）。 */
function saveDeletedBuiltinIds(db: DatabaseSync, ids: Set<string>): void {
  try {
    db.prepare(`UPDATE app_settings SET deleted_builtin_agent_ids_json = ? WHERE id = 1`).run(
      JSON.stringify([...ids])
    )
  } catch {
    // app_settings 无记录或列不存在时静默失败，不影响主要逻辑
  }
}

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
 * 生成某个内置智能体在指定项目下的唯一 id。
 * 内置智能体按项目隔离（本小说智能体），同一内置智能体在不同项目各有一份，
 * 因此用 `内置id:项目id` 作为主键，保证不同项目之间互不覆盖。
 */
function builtinProjectId(builtinId: string, projectId: string): string {
  return `${builtinId}:${projectId}`
}

/**
 * 为指定项目 seed 内置智能体（本小说智能体）。幂等。
 *
 * 内置智能体原本以 scope='global' 存在（全局共享）。按需求调整为：
 * 内置智能体只作为「本小说智能体」存在（scope='local'，绑定 project_id），
 * 每个项目独立一份，数据在本小说内互通；全局智能体不再包含内置智能体。
 *
 * 被用户手动删除的内置智能体不会重新插入（尊重用户删除意愿）。
 */
export function seedBuiltinAgentsForProject(db: DatabaseSync, projectId: string): void {
  // 从数据库加载已删除的内置智能体 ID（跨重启持久化）
  loadDeletedBuiltinIds(db).forEach((id) => deletedBuiltinIds.add(id))

  const insert = db.prepare(`
    INSERT OR IGNORE INTO agent_profiles
      (id, name, description, system_prompt, avatar, avatar_type, is_builtin, preset_index, scope, project_id, skill_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // 已存在的项目内置智能体：同步最新 system_prompt / description / skill_ids / preset_index，
  // 确保新版本提示词与 skill 绑定在已有安装上也生效。
  const upsert = db.prepare(`
    UPDATE agent_profiles SET
      name = ?,
      description = ?,
      system_prompt = ?,
      avatar = ?,
      preset_index = ?,
      scope = 'local',
      project_id = ?,
      skill_ids = ?,
      updated_at = ?
    WHERE id = ? AND is_builtin = 1
  `)
  const now = new Date().toISOString()

  for (const agent of BUILTIN_AGENTS) {
    const pid = builtinProjectId(agent.id, projectId)
    if (deletedBuiltinIds.has(pid)) continue
    insert.run(
      pid,
      agent.name,
      agent.description,
      agent.systemPrompt,
      agent.avatar ?? '',
      'svg',
      1,
      agent.presetIndex,
      'local',
      projectId,
      JSON.stringify(agent.skillIds ?? []),
      now,
      now
    )
    upsert.run(
      agent.name,
      agent.description,
      agent.systemPrompt,
      agent.avatar ?? '',
      agent.presetIndex,
      projectId,
      JSON.stringify(agent.skillIds ?? []),
      now,
      pid
    )
  }
}

/**
 * 全局迁移入口（workspace 初始化时调用）。
 *
 * 内置智能体现在只以「本小说智能体」（scope='local'）形式存在，不再 seed 为全局。
 * 为兼容旧版本：将历史遗留的全局内置智能体（scope='global' AND is_builtin=1）迁移到
 * 各现有项目下作为 local 内置，并从全局移除，保证「全局智能体不显示内置智能体」。
 */
export function seedBuiltinAgents(db: DatabaseSync): void {
  // 从数据库加载已删除的内置智能体 ID（跨重启持久化）
  loadDeletedBuiltinIds(db).forEach((id) => deletedBuiltinIds.add(id))

  // 1. 收集历史遗留的全局内置智能体（旧版本 seed 的 scope='global' 内置）。
  const legacyGlobal = db
    .prepare(`SELECT id, name, description, system_prompt, preset_index, skill_ids FROM agent_profiles WHERE scope = 'global' AND is_builtin = 1`)
    .all() as unknown as Array<{
      id: string
      name: string
      description: string
      system_prompt: string
      preset_index: number
      skill_ids: string
    }>

  // 2. 为每个现有项目补 seed 本小说内置智能体。
  const projects = db.prepare(`SELECT id FROM projects`).all() as Array<{ id: string }>
  for (const project of projects) {
    seedBuiltinAgentsForProject(db, project.id)
  }

  // 3. 删除历史遗留的全局内置智能体（除 Solo 外），确保它们不再显示在「全局智能体」中。
  //    仅当该全局内置确实属于内置预设时才删除；用户自定义的全局智能体不受影响。
  const builtinPresetIds = new Set(BUILTIN_AGENTS.map((a) => a.id))
  for (const row of legacyGlobal) {
    // Solo 作为全局默认智能体保留（用最新定义 upsert），其余内置迁移为局部后从全局删除。
    if (row.id === 'builtin-solo') continue
    if (builtinPresetIds.has(row.id)) {
      db.prepare(`DELETE FROM agent_profiles WHERE id = ? AND scope = 'global' AND is_builtin = 1`).run(row.id)
    }
  }

  // 4. 为全局作用域 seed 默认智能体 Solo（全局共享，跨项目可见、默认选中）。
  const solo = BUILTIN_AGENTS.find((a) => a.id === 'builtin-solo')
  if (solo) {
    const now = new Date().toISOString()
    db.prepare(`
      INSERT OR IGNORE INTO agent_profiles
        (id, name, description, system_prompt, avatar, avatar_type, is_builtin, preset_index, scope, project_id, skill_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'image', 1, ?, 'global', NULL, ?, ?, ?)
    `).run(
      'builtin-solo',
      solo.name,
      solo.description,
      solo.systemPrompt,
      solo.avatar ?? '',
      solo.presetIndex,
      JSON.stringify(solo.skillIds ?? []),
      now,
      now
    )
    // 同步最新系统提示词 / skill 绑定到已存在的全局 Solo（幂等升级）。
    db.prepare(`
      UPDATE agent_profiles SET
        name = ?,
        description = ?,
        system_prompt = ?,
        avatar = ?,
        avatar_type = 'image',
        preset_index = ?,
        skill_ids = ?,
        updated_at = ?
      WHERE id = 'builtin-solo' AND is_builtin = 1 AND scope = 'global'
    `).run(
      solo.name,
      solo.description,
      solo.systemPrompt,
      solo.avatar ?? '',
      solo.presetIndex,
      JSON.stringify(solo.skillIds ?? []),
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
    // 编辑了内置智能体则取消其删除标记（持久化）
    if (existing.isBuiltin) {
      unmarkBuiltinDeleted(id)
      saveDeletedBuiltinIds(this.db, deletedBuiltinIds)
    }
    return this.get(id)
  }

  delete(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false
    this.db.prepare(`DELETE FROM agent_profiles WHERE id = ?`).run(id)
    // 内置智能体被删除后记入标记，防止下次启动 seed 重新插回（持久化）
    if (existing.isBuiltin) {
      markBuiltinDeleted(id)
      saveDeletedBuiltinIds(this.db, deletedBuiltinIds)
    }
    return true
  }

  /**
   * 恢复指定项目下已删除的内置智能体（本小说智能体）。
   * 清除该项目内置智能体的删除标记并重新 seed，返回恢复数量。
   */
  restoreDeletedBuiltinsForProject(projectId: string): number {
    // 精确匹配内置智能体 ID 末尾的 `:项目ID` 段，避免因 ID 前缀重叠而误删（如 'solo:ab' vs 'solo:a'）
    const toRestore = [...deletedBuiltinIds].filter((id) => {
      const sepIdx = id.lastIndexOf(':')
      return sepIdx !== -1 && id.slice(sepIdx + 1) === projectId
    })
    if (!toRestore.length) return 0
    toRestore.forEach((id) => deletedBuiltinIds.delete(id))
    saveDeletedBuiltinIds(this.db, deletedBuiltinIds)
    seedBuiltinAgentsForProject(this.db, projectId)
    return toRestore.length
  }

  /**
   * 恢复全局已删除的内置智能体（全局作用域仅内置 Solo）。
   * 清除全局内置智能体的删除标记并重新 seed，返回恢复数量。
   */
  restoreDeletedGlobalBuiltins(): number {
    const toRestore = [...deletedBuiltinIds].filter((id) => !id.includes(':'))
    if (!toRestore.length) return 0
    toRestore.forEach((id) => deletedBuiltinIds.delete(id))
    saveDeletedBuiltinIds(this.db, deletedBuiltinIds)
    seedBuiltinAgents(this.db)
    return toRestore.length
  }

  /** 设置全局作用域下的默认智能体（设为默认后，其它全局智能体会被取消默认标记）。 */
  setDefaultGlobalAgent(id: string): AgentProfile | null {
    const target = this.get(id)
    // 前端仅在「全局智能体」编辑场景展示“设为默认”，且传参前会校验作用范围为 global；
    // 若 DB 中该智能体的 scope 与前端缓存存在轻微不一致（如刚由全局改为局部后列表未刷新），
    // 这里将其一并纠正为全局作用域并设为默认，避免出现“设为默认失败”。
    if (!target) return null
    this.db.prepare(`UPDATE agent_profiles SET is_default = 0 WHERE scope = 'global'`).run()
    this.db
      .prepare(`UPDATE agent_profiles SET is_default = 1, scope = 'global', project_id = NULL, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id)
    return this.get(id)
  }

  /** 取消全局作用域下的默认智能体标记（仅允许取消全局作用域）。 */
  clearDefaultGlobalAgent(id: string): AgentProfile | null {
    const target = this.get(id)
    if (!target || target.scope !== 'global') return null
    this.db
      .prepare(`UPDATE agent_profiles SET is_default = 0, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id)
    return this.get(id)
  }

  /** 获取当前默认智能体（按作用域与项目过滤）。 */
  getDefaultAgent(scope?: AgentScope, projectId?: string): AgentProfile {
    if (scope === 'local' && projectId) {
      const local = this.list({ scope: 'local', projectId })
      if (!local.length) {
        // 项目无本小说智能体时回落到全局默认（此时 local 必为空，local[0] 恒为 undefined，无需兜底）
        return this.getDefaultAgent('global')
      }
      // 默认选择本小说智能体中被设为默认的（若存在），否则回落到「Solo」，再取第一个。
      const marked = local.find((a) => a.isDefault)
      if (marked) return marked
      const solo = local.find((a) => a.id === builtinProjectId('builtin-solo', projectId))
      return solo ?? local[0]
    }
    // 全局默认智能体：优先取被「设为默认」的智能体，否则回落 Solo，再取第一个。
    const globals = this.list({ scope: 'global' })
    const marked = globals.find((a) => a.isDefault)
    if (marked) return marked
    const solo = globals.find((a) => a.id === 'builtin-solo')
    return solo ?? globals[0]
  }
}
