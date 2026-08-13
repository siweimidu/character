import type { SkillCategory, SkillCompatibility, SkillManifest, SkillStageId } from './types'
import type { AiTaskName } from '../shared-types'

/** 启发式推断结果：当 skill 缺少 frontmatter manifest 时自动推断的元数据 */
export type HeuristicResult = {
  category: SkillCategory
  compatibility: SkillCompatibility
  compatibilityNote: string
  enabled: boolean
  stages: SkillStageId[]
  tasks: AiTaskName[]
  triggers: string[]
  priority: number
}

/**
 * 纯关键词启发式：为没有 frontmatter manifest 的 skill 推断元数据。
 * 所有已知 skill 的元数据应写在各自 SKILL.md 的 frontmatter 里，这里只兜底。
 */
export function inferSkillMeta(skillId: string, description: string): HeuristicResult {
  const lowerDesc = description.toLowerCase()
  const lowerSkillId = skillId.toLowerCase()

  // ── oh-story-claudecode 系列：按具体能力深度适配 ──
  if (lowerSkillId === 'story' || lowerSkillId === 'story-router') {
    return buildHeuristic('tool', ['reference', 'premise', 'setting', 'outline', 'draft'], [], ['写小说', '写网文', '开书', '扫榜', '拆文', '封面', '去AI味'], true, 'native', '网文工具箱路由入口：识别意图后分发到具体 story-* skill。', 9)
  }
  if (lowerSkillId === 'story-long-write' || lowerSkillId === 'story-short-write') {
    return buildHeuristic('writing', ['premise', 'setting', 'outline', 'draft'], WRITING_TASKS, ['写正文', '开书', '续写', '写章节', '大纲', '回炉', '重写'], true, 'native', '网文正文写作执行器：从情绪出发产出正文。', 9)
  }
  if (lowerSkillId === 'story-long-analyze' || lowerSkillId === 'story-short-analyze') {
    return buildHeuristic('analysis', ['reference'], ['reference-style-chunk', 'reference-style-analysis', 'chapter-analysis'], ['拆文', '拆书', '分析', '黄金三章', '对标'], true, 'native', '爆款拆文：拆解结构、爽点、节奏与人设。', 8)
  }
  if (lowerSkillId === 'story-long-scan' || lowerSkillId === 'story-short-scan') {
    return buildHeuristic('market', ['reference'], [], ['扫榜', '排行', '什么火', '市场', '趋势'], true, 'native', '扫榜选题：识别市场趋势与风口题材。', 8)
  }
  if (lowerSkillId === 'story-review') {
    return buildHeuristic('analysis', ['draft'], ['chapter-analysis', 'story-deep-audit', 'chapter-repair'], ['审查', '审一下', '找问题', 'review'], true, 'native', '多视角对抗式审查：找出结构、角色、文字与设定问题。', 8)
  }
  if (lowerSkillId === 'story-import') {
    return buildHeuristic('tool', ['reference'], ['continuation-import-chunk', 'continuation-import-aggregate'], ['导入', '反向解析', '导入小说'], true, 'native', '把已有小说反向解析为标准项目结构。', 7)
  }
  if (lowerSkillId === 'story-setup') {
    return buildHeuristic('tool', [], [], ['准备写书', '搭环境', '初始化', '配置写作项目'], true, 'native', '写作基础设施部署：合并而非覆盖用户已有配置。', 7)
  }
  if (lowerSkillId === 'browser-cdp') {
    return buildHeuristic('tool', [], [], ['浏览器', 'CDP', '抓取', '登录态'], false, 'external-only', '依赖外部 agent-browser 工具，当前项目无 CDP 执行环境，仅作资料保留。')
  }
  if (lowerSkillId === 'story-cover' || lowerSkillId.includes('cover')) {
    return buildHeuristic('cover', [], ['cover-generate'], ['封面', '封面图'], true, 'native', '封面生成：根据书名/作者名分析题材并生成封面。')
  }

  if (lowerSkillId.includes('scan') || lowerDesc.includes('市场') || lowerDesc.includes('排行'))
    return buildHeuristic('market', ['reference'], [], ['排行', '市场', '趋势'], true)

  if (lowerSkillId.includes('analyze') || lowerDesc.includes('拆书') || lowerDesc.includes('拆文'))
    return buildHeuristic('analysis', ['reference'], ['reference-style-chunk', 'reference-style-analysis'], ['拆书', '分析', '对标'], true)

  if (lowerSkillId.includes('write') || lowerDesc.includes('写作') || lowerDesc.includes('创作'))
    return buildHeuristic('writing', ['premise', 'setting', 'outline', 'draft'], WRITING_TASKS, ['写正文', '写章节', '大纲', '开书'], true)

  if (lowerSkillId.includes('deslop') || lowerSkillId.includes('polish') || lowerDesc.includes('润色') || lowerDesc.includes('ai味'))
    return buildHeuristic('polish', ['draft'], ['chapter-assistant', 'chapter-first-draft'], ['润色', '去AI味', '降低AI感'], true)

  if (lowerSkillId.includes('cdp') || lowerSkillId.includes('browser'))
    return buildHeuristic('tool', [], [], [], false, 'external-only', '当前项目没有浏览器 CDP 执行能力，此 skill 会作为外部工具说明保留。')

  return buildHeuristic('writing', [], [], [], false, 'partial', '已识别为通用 skill，可手动决定是否启用并绑定到对应阶段。')
}

/**
 * 将用户提供的 partial manifest 与启发式推断结果合并为完整的 SkillManifest
 * @param partial - 用户在 frontmatter 中声明的 manifest（可能为 null）
 * @param heuristic - 启发式推断的兜底值
 * @returns 合并后的完整 SkillManifest
 */
export function buildFullManifest(
  partial: Partial<SkillManifest> | null,
  heuristic: HeuristicResult
): SkillManifest {
  return {
    category: partial?.category ?? heuristic.category,
    tasks: partial?.tasks?.length ? partial.tasks : heuristic.tasks,
    stages: partial?.stages?.length ? partial.stages : heuristic.stages,
    triggers: partial?.triggers?.length ? partial.triggers : heuristic.triggers,
    priority: partial?.priority ?? heuristic.priority,
    references: partial?.references ?? [],
    required: partial?.required ?? false
  }
}

/** 写作类 skill 默认关联的 AI 任务列表 */
const WRITING_TASKS: AiTaskName[] = [
  'chapter-assistant', 'chapter-first-draft', 'outline-batch', 'outline-chain',
  'chapter-analysis', 'inspiration-pack', 'project-bootstrap',
  'worldview-entry', 'character-card', 'outline-item',
  'spiral-seed', 'spiral-expand', 'spiral-characters', 'spiral-organizations',
  'spiral-relationships', 'spiral-worldview-expand', 'spiral-outline', 'spiral-validate'
]

/** 构造 HeuristicResult 的便捷工厂函数 */
function buildHeuristic(
  category: SkillCategory,
  stages: SkillStageId[],
  tasks: AiTaskName[],
  triggers: string[],
  enabled: boolean,
  compatibility: SkillCompatibility = 'native',
  compatibilityNote: string = '',
  priority: number = 5
): HeuristicResult {
  return { category, compatibility, compatibilityNote, enabled, stages, tasks, triggers, priority }
}
