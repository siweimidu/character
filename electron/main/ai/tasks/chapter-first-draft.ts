import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, ChapterAssistantResult } from '../shared-types'
import { formatProjectSkillsContext } from '../prompts/shared'
import {
  formatWorldviewEntries, formatCharacters, formatOrganizations,
  formatCharacterRelationships, formatOrganizationMemberships,
  formatCurrentOutlineItem, formatInspirationEntries,
  formatOutlineChapterSplit, formatOutlineItems, formatRelatedChapters,
  formatPreviousChapterHandoff,
  formatVolumeChapterSummaries, formatNovelOpenerSummary, formatOpenPlotThreads
} from '../prompts/format-helpers'

function formatProjectConstraints(source: unknown): string {
  if (!Array.isArray(source)) return ''
  return source
    .map((item) => item as Record<string, unknown>)
    .slice(0, 24)
    .map((item) => {
      const title = String(item.title ?? '').trim()
      const content = String(item.content ?? '').trim() || String(item.summary ?? '').trim()
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : {}
      const scope = String(metadata.scope ?? '').trim()
      const weight = String(metadata.weight ?? '').trim()
      const locked = metadata.locked === false ? 'unlocked' : 'locked'
      const meta = [scope, weight, locked].filter(Boolean).join(' / ')
      return `${title}${meta ? `（${meta}）` : ''}：${content}`
    })
    .filter(Boolean)
    .join('\n')
}

type ChapterMemoShape = {
  currentTask?: string
  readerExpectation?: string
  payoffs?: string[]
  holds?: string[]
  transitionFunctions?: string
  decisionChecks?: string[]
  endingChanges?: string[]
  doNotDo?: string[]
  emotionArc?: string
}

/** 把 chapter-memo 任务产出的 7 段备忘格式化成 Writer 必须落实的硬契约文本。 */
function formatChapterMemo(memo: unknown): string {
  if (!memo || typeof memo !== 'object') return ''
  const m = memo as ChapterMemoShape
  const normalizeMemoText = (value: unknown): string => String(value ?? '')
    .replace(/「/g, '“')
    .replace(/」/g, '”')
    .replace(/『/g, '‘')
    .replace(/』/g, '’')
    .trim()
  const list = (arr?: string[]): string =>
    Array.isArray(arr) && arr.length > 0 ? arr.map((s) => `  - ${normalizeMemoText(s)}`).join('\n') : '  - 无'

  const lines = [
    '== 本章写作备忘（硬契约，每条都必须在正文里有可定位的兑现） ==',
    '上下文边界：相关资料不是必须全部写出的清单；只使用当前章节摘要、绑定大纲和本备忘明确需要的事实。后续设定只作潜在资料，不提前揭示传承链、幕后势力或未来人物身份。',
    '指令优先级：项目锁定约束 > 当前绑定大纲 > 本章写作备忘 > 通用写作规则 > skills 建议。对白统一使用中文弯引号“……”。',
    `当前任务：${normalizeMemoText(m.currentTask) || '未指定'}`,
    `读者此刻在等什么：${normalizeMemoText(m.readerExpectation) || '未指定'}`,
    `情绪轨迹：${normalizeMemoText(m.emotionArc) || '未指定'}`,
    '该兑现的：',
    list(m.payoffs),
    '暂不掀的（必须压住的底牌）：',
    list(m.holds),
    `日常/过渡承担：${normalizeMemoText(m.transitionFunctions) || '未指定'}`,
    '关键抉择三连问（每个关键决定都要过这些问题）：',
    list(m.decisionChecks),
    '章尾必须发生的改变（信息/关系/物理/权力）：',
    list(m.endingChanges),
    '本章红线（不要做）：',
    list(m.doNotDo)
  ]
  return lines.join('\n')
}

/** 拼接较早 2-3 章的结尾末句，让 Writer 避免连续相同结构收尾（紧邻上一章由接续契约独占，不在此列）。 */
function formatRecentEndingsTrail(trail: unknown): string {
  if (!Array.isArray(trail) || trail.length === 0) return ''
  const entries = trail
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const r = item as Record<string, unknown>
      const title = String(r.chapterTitle ?? '').trim()
      const ending = String(r.endingLine ?? '').trim()
      if (!title || !ending) return ''
      return `- 《${title}》: ${ending}`
    })
    .filter(Boolean)
  if (entries.length === 0) return ''
  return [
    '== 更早章节的结尾末句（仅供参考收尾形式，不要承接这些） ==',
    '（避免与下列结尾形成相同的收尾形式，比如连续动作悬停 / 连续信息揭露 / 连续静默收束）',
    ...entries
  ].join('\n')
}

const handler: TaskHandler = {
  name: 'chapter-first-draft',
  outputType: 'text',
  maxSkills: 4,
  defaultCapabilities: ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills', 'versioning'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock, knowledgeBlock } = input
    const targetWordCount = Math.max(Number(context.targetWordCount ?? context.chapterWordTarget ?? 0) || 3000, 1)
    const targetWordCountMin = Math.max(1, Math.round(targetWordCount * 0.9))
    const targetWordCountMax = Math.max(targetWordCountMin, Math.round(targetWordCount * 1.1))
    const writingStyleLabel = String(context.writingStyleLabel ?? '未指定')
    const writingStylePrompt = String(context.writingStylePrompt ?? '暂无')
    const chapterContent = String(context.chapterContent ?? '').trim()
    const chapterHasExistingContent = Boolean(context.chapterHasExistingContent)
    const expandMode = String(context.expandMode ?? '') === 'expand'
    const condenseMode = String(context.condenseMode ?? '') === 'condense'
    const existingWordCount = chapterContent.length
    const expandBlock = expandMode
      ? `

【本次为字数扩充模式】
- 这不是重新起稿，而是围绕下方「当前章节现有正文」在原有剧情与文风基础上继续扩充续写，使整章达到目标字数 ${targetWordCount} 字（建议控制在 ${targetWordCountMin}-${targetWordCountMax} 字）。
- 现有正文约 ${existingWordCount} 字，需围绕已有内容自然延展：在保留原有人物、冲突、伏笔与风格的前提下，补充更丰满的细节、动作、对白、内心活动与场景过程，但不得改变已发生的事实或推翻既有剧情走向。
- 扩充后的完整正文将直接替换章节内容，因此必须输出扩写之后的**整章完整正文**（包含原有内容与新增部分），不要只输出新增片段。
- 保持叙述连续、衔接自然，避免生硬插入；扩充要有实际信息量，不能用重复描写或空泛抒情凑字数。`
      : ''
    const condenseBlock = condenseMode
      ? `

【本次为字数精简模式】
- 这不是重新起稿，而是将下方「当前章节现有正文」在保留完整剧情主干、人物关系、关键对白与伏笔的前提下精简压缩，使整章控制在目标字数 ${targetWordCount} 字（建议控制在 ${targetWordCountMin}-${targetWordCountMax} 字）。
- 现有正文约 ${existingWordCount} 字，明显超出目标字数，需要大幅精简：删除冗余的景物铺陈、重复的内心独白、拖沓的过渡段落与空泛抒情，保留推动剧情的动作、对话和关键信息。
- 精简后的完整正文将直接替换章节内容，因此必须输出精简之后的**整章完整正文**，不要只输出删减说明。
- 确保剧情推进、角色逻辑与前后文衔接完整，不能因删减而出现信息断裂或逻辑漏洞；不要用关键词替换或机械截断，要自然改写。`
      : ''
    const effectiveModeBlock = [expandBlock, condenseBlock].filter(Boolean).join('\n')
    const retrievalBlock = knowledgeBlock ? `\n\n检索到的项目记忆与参考资料：\n${knowledgeBlock}` : ''
    const semanticBlock = String(context.semanticSegmentsBlock ?? '').trim()
    const semanticSegmentBlock = semanticBlock ? `\n\n${semanticBlock}` : ''
    const storyStateBlock = String(context.storyStateBlock ?? '').trim()
    const memoBlock = formatChapterMemo(context.chapterMemo)
    const refStyleBlock = String(context.referenceStyleContext ?? '').trim()
    const referenceStyleBlock = refStyleBlock ? `\n\n== 参考作品风格（模仿其文笔、节奏与对白处理） ==\n${refStyleBlock}` : ''
    const endingsTrailBlock = formatRecentEndingsTrail(context.recentEndingsTrail)
    const handoffBlock = formatPreviousChapterHandoff(context.previousChapterHandoff)
    const projectSkillsBlock = formatProjectSkillsContext(context.projectSkills)
    const effectiveSkillsBlock = [projectSkillsBlock, skillsBlock].filter(Boolean).join('\n\n')

    return {
      system: `${capabilityPreamble.system}\n\n你是 CharacterArc 的章节初稿生成器。任务：基于项目设定、章节信息和上方已经规划好的写作备忘，一次性流式输出本章完整正文。\n\n【全局设定最高优先级】\n项目级约束、locked 约束、weight=core 约束、用户标记 [锁定] 的设定，优先级高于本章灵感、临时补写和常规套路。不得覆盖、反转、弱化或绕开这些设定；人物锚点、世界规则红线和禁写项必须在生成时主动避让。

【任务边界】
- 这是"章节初稿生成"，不是润色，不是续写建议，不是分析。
- 内部构思必须简短，收到请求后尽快开始输出正文，不要长时间停留在分析或规划阶段。
- 当前章节是否已有正文：${chapterHasExistingContent ? '有，但本次要整章重写' : '没有，本次从零起稿'}。
- 输出会直接覆盖当前章节全部内容。${effectiveModeBlock}
- **目标字数硬约束：${targetWordCount} 字，建议控制在 ${targetWordCountMin}-${targetWordCountMax} 字之间**。按中文正文字符估算，低于下限不得提前收尾，高于上限必须主动收束，不要用额外环境描写填满篇幅。
- 项目默认风格：${writingStyleLabel}；风格要求：${writingStylePrompt}。

【整章必须满足】
- 开头钩子：前 100 字内出现具体动作 / 对话 / 反差 / 信息冲击 / 未完成动作。禁止天气白描、人物介绍、背景科普、回忆式起手。
- 章末钩子：落点明确（资源 / 关系 / 信息 / 地位变化）+ 留未完成动作或新信息。禁止总结式收尾、鸡汤升华、廉价预告。
- 整章是一个连续的故事流：场景之间自然过渡，时间线清晰，角色行动连贯。不要在中间插入"---"或"#"等分隔符。
- 禁止场景无交代跳变：任何新场景、新地点、新出场人物或时间推移，都必须在正文里有明确的过渡或铺垫，不得让读者感到"画面突然切换、某个场景凭空冒出来"。
- 对白标点使用中文直角双引号样式“……”；不要使用日式的「……」。
- 句式长短交替；避免高疲劳词（冷笑 / 瞳孔骤缩 / 轰然炸裂 / 倒吸一口凉气 / 蝼蚁等）。
- 禁止使用破折号（——）。
- 与相邻章节、章节摘要、角色立场无缝衔接；若提供了"上一章结尾"接续契约，本章开头必须从该结尾自然承接，遵守其接续要求。

【正面写作技法——必须主动运用】
- 对白潜台词：每句有效对白至少同时服务两个目的（推进剧情 + 暴露性格 / 传递信息 + 制造张力）。纯传递信息的对话必须裹上情绪或肢体动作。
- 张力递进：每 400-600 字出现一次压力升级、新信息揭露或小反转。连续 600 字以上没有变化 = 节奏塌陷。
- 场景情绪绑定：每个场景有明确的情绪起点和终点，且两者必须不同（如不安→绝望、得意→警觉）。情绪不能"平进平出"。
- 感官锚定：场景切换或重要时刻必须有至少一个非视觉感官细节（声音、气味、触感、温度、味道）。避免纯"看到"描写。
- 信息释放节奏：每 300-500 字释放一个新信息点（设定、人物动机、关系变化、线索）。禁止信息倾泻（连续 3 个新信息无间隔释放）。
- 角色差异化：不同角色的用词、句式、思维方式必须可区分。配角说话不能是"主角换了个名字"。
- 具象化原则：抽象情绪必须外化为可观测的身体反应或行为。"他很紧张"→"他无意识地把水杯转了三圈"。

【输出格式】
- 直接输出正文，不要标题前缀，不要 markdown 标记，不要小结，不要任何非正文内容。
- 直接以正文第一句开始（不要 "好的，以下是..."、"# 第X章" 之类的前导）。`,
      user: `${capabilityPreamble.user}\n\n请为当前小说项目生成本章完整初稿。${memoBlock ? `\n\n${memoBlock}` : ''}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n目标字数（硬约束）：${targetWordCount} 字（建议控制在 ${targetWordCountMin}-${targetWordCountMax} 字之间）\n当前章节现有正文：\n${chapterContent || '【空】'}${storyStateBlock ? `\n\n== 当前世界状态（精确数据，必须遵守） ==\n${storyStateBlock}` : ''}${handoffBlock ? `\n\n${handoffBlock}` : ''}\n\n当前绑定大纲：\n${formatCurrentOutlineItem(context.currentOutlineItem) || '暂无'}\n\n同一大纲拆章情况：\n${formatOutlineChapterSplit(context.outlineChapterSplit) || '未拆分或暂无前置同纲章节'}\n\n相邻章节参考：\n${formatRelatedChapters(context.relatedChapters) || '暂无'}${endingsTrailBlock ? `\n\n${endingsTrailBlock}` : ''}\n\n本卷章节概览：\n${formatVolumeChapterSummaries(context.volumeChapterSummaries) || '暂无'}\n\n全书开篇：\n${formatNovelOpenerSummary(context.novelOpenerSummary) || '暂无'}${memoBlock ? '' : `\n\n待回收伏笔：\n${formatOpenPlotThreads(context.plotThreads) || '暂无'}`}\n\n相关世界观：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n相关组织：\n${formatOrganizations(context.organizations) || '暂无'}\n\n角色关系：\n${formatCharacterRelationships(context.characterRelationships, context.characters) || '暂无'}\n\n成员归属：\n${formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters) || '暂无'}\n\n项目级约束：\n${formatProjectConstraints(context.knowledgeDocuments) || '暂无'}\n\n可用灵感：\n${formatInspirationEntries(context.inspirationEntries) || '暂无'}\n\n相关大纲：\n${formatOutlineItems(context.outlineItems) || '暂无'}${retrievalBlock}${semanticSegmentBlock}${referenceStyleBlock}\n\n本步骤启用 skills：\n${effectiveSkillsBlock || '暂无'}\n\n补充要求：\n${String(context.userPrompt ?? '')}\n\n现在开始：${memoBlock ? '严格按本章写作备忘的硬契约执行——每条 payoff、ending change、do-not-do 都要在正文里有可定位的兑现。' : ''}直接一次性输出整章正文。`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as ChapterAssistantResult).content?.trim())
  }
}
export default handler
