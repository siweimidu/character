import type { PromptCategory, PromptEntry } from '@/types/app'

/**
 * 内置提示词模板库
 *
 * 包含小说写作常用的 20 条提示词模板，覆盖写作辅助、润色优化、
 * 剧情构思、角色塑造四大内置分类。
 * 内置模板不可删除，但可复制为自定义后编辑。
 */

export interface BuiltinPromptTemplate {
  /** 模板标题 */
  title: string
  /** 所属内置分类名称（对应 PromptCategory.name） */
  categoryName: string
  /** 提示词正文，支持 {{content}}、{{chapter}}、{{role}} 模板变量 */
  content: string
  /** 标签列表 */
  tags: string[]
  /** 备注说明 */
  remark: string
}

export const BUILTIN_PROMPT_CATEGORY_NAMES = ['写作辅助', '润色优化', '剧情构思', '角色塑造'] as const

export const BUILTIN_PROMPT_TEMPLATES: BuiltinPromptTemplate[] = [
  // ── 写作辅助 ──
  {
    title: '段落扩写大师',
    categoryName: '写作辅助',
    content:
      '请将以下段落进行扩写，保持原有风格和基调，增加更多细节描写、环境氛围和人物心理活动，使内容更加丰满立体。\n\n【选中内容】\n{{content}}',
    tags: ['扩写', '细节', '氛围'],
    remark: '将简略段落扩展为细节丰富的完整段落'
  },
  {
    title: '开篇黄金三章',
    categoryName: '写作辅助',
    content:
      '请根据当前章节 {{chapter}} 的设定，生成黄金三章的开篇写作建议。重点考虑：前三章如何快速建立主角形象、抛出核心悬念、展现世界观特色，并确保开篇节奏紧凑。',
    tags: ['开篇', '黄金三章', '节奏'],
    remark: '用于生成小说开篇的写作规划建议'
  },
  {
    title: '对话场景搭建',
    categoryName: '写作辅助',
    content:
      '请基于以下角色 {{role}} 的人物设定，为当前章节 {{chapter}} 搭建一个精彩的对话场景。要求：对话要符合角色性格，包含潜台词和情绪变化，并配以适当的动作和环境描写。',
    tags: ['对话', '场景', '角色'],
    remark: '生成符合角色性格的对话场景'
  },
  {
    title: '伏笔埋设助手',
    categoryName: '写作辅助',
    content:
      '请阅读以下选中内容 {{content}}，找出可以埋设伏笔的关键点，并建议 3-5 种巧妙的伏笔埋设方式，要求隐蔽自然、能引发读者猜想，同时为后续回收留出空间。',
    tags: ['伏笔', '悬念', '布局'],
    remark: '在现有内容中识别和设计伏笔'
  },
  {
    title: '章节大纲推演',
    categoryName: '写作辅助',
    content:
      '请基于当前章节 {{chapter}} 的剧情走向，推演本章节的大纲结构。要求包含：场景序列、情节转折点、情绪曲线、结尾钩子设计，并标注每部分的预估字数占比。',
    tags: ['大纲', '结构', '规划'],
    remark: '为当前章节生成详细大纲推演'
  },
  {
    title: '起承转合检查',
    categoryName: '写作辅助',
    content:
      '请检查以下选中内容 {{content}} 的起承转合结构是否完整。分析其叙事节奏、冲突推进和情绪起伏，指出结构上的薄弱环节，并给出具体的修改建议。',
    tags: ['结构', '检查', '节奏'],
    remark: '分析段落或章节的叙事结构完整性'
  },

  // ── 润色优化 ──
  {
    title: '文字润色精修',
    categoryName: '润色优化',
    content:
      '请对以下内容进行润色精修，保持原意不变，优化用词、句式和表达方式，使文字更加流畅自然、富有文学感。请逐句修改并说明修改理由。\n\n【选中内容】\n{{content}}',
    tags: ['润色', '文笔', '精修'],
    remark: '逐句优化文字表达并给出修改说明'
  },
  {
    title: '节奏把控优化',
    categoryName: '润色优化',
    content:
      '请分析以下内容 {{content}} 的叙事节奏，检查是否出现节奏拖沓或过于急促的问题。建议在哪些位置增加或删减描写、调整句子长度，以改善整体阅读节奏。',
    tags: ['节奏', '优化', '阅读体验'],
    remark: '优化叙事的快慢节奏和阅读体验'
  },
  {
    title: '场景氛围渲染',
    categoryName: '润色优化',
    content:
      '请为以下场景 {{content}} 增添氛围渲染。通过环境描写、感官细节（视觉/听觉/触觉/嗅觉）和光影色彩变化，营造出与剧情情绪相匹配的场景氛围。',
    tags: ['氛围', '环境', '感官'],
    remark: '增强场景的环境氛围和感官体验'
  },
  {
    title: '对话自然度优化',
    categoryName: '润色优化',
    content:
      '请优化以下对话内容 {{content}}，使其更加自然流畅。检查是否符合角色身份和性格，去除书面腔和生硬的表达，添加口语化的细节，让对话听起来真实可信。',
    tags: ['对话', '口语', '自然度'],
    remark: '提升对话的真实感和自然度'
  },
  {
    title: '避免重复表达',
    categoryName: '润色优化',
    content:
      '请检查以下内容 {{content}} 中是否存在重复的用词、句式或表达模式。找出重复之处并给出替代方案，使文字更加丰富多样。',
    tags: ['去重', '词汇', '表达'],
    remark: '识别并消除文字的重复表达'
  },

  // ── 剧情构思 ──
  {
    title: '剧情转折设计',
    categoryName: '剧情构思',
    content:
      '请基于当前剧情 {{content}} 设计一个出人意料的剧情转折。要求：转折要符合已有世界观和角色逻辑，不能是突兀的反转，要有充分的暗示和铺垫，让读者觉得意料之外又情理之中。',
    tags: ['转折', '反转', '悬念'],
    remark: '设计符合逻辑且出人意料的剧情转折'
  },
  {
    title: '高潮场景策划',
    categoryName: '剧情构思',
    content:
      '请为当前章节 {{chapter}} 设计一个戏剧高潮场景。要求：情绪张力要层层推进，包含角色间的正面冲突，设计关键的对话和动作时刻，确保高潮具有足够的冲击力和情感深度。',
    tags: ['高潮', '冲突', '张力'],
    remark: '策划戏剧性的高潮场景'
  },
  {
    title: '支线剧情展开',
    categoryName: '剧情构思',
    content:
      '请基于主线剧情 {{content}} 设计一条支线剧情。要求：支线要能丰富世界观或塑造人物，与主线产生有机联系，避免喧宾夺主，并规划支线的起承转合和最终归宿。',
    tags: ['支线', '世界观', '人物'],
    remark: '设计与主线呼应的支线剧情'
  },
  {
    title: '情感冲突构建',
    categoryName: '剧情构思',
    content:
      '请为角色 {{role}} 设计一个深刻的情感冲突场景。要求：冲突要源于角色的核心欲望与困境，包含内心挣扎和外在表现的矛盾，让读者能感受到角色情感的真实与复杂。',
    tags: ['情感', '冲突', '内心'],
    remark: '构建有深度的情感冲突'
  },
  {
    title: '悬念钩子设计',
    categoryName: '剧情构思',
    content:
      '请为章节结尾 {{chapter}} 设计一个引人入胜的悬念钩子。要求：钩子要自然地从当前情节延伸，引发读者的好奇心和继续阅读的欲望，类型可以是身份悬念、真相悬念或危机悬念。',
    tags: ['悬念', '钩子', '结尾'],
    remark: '设计让读者欲罢不能的章节钩子'
  },

  // ── 角色塑造 ──
  {
    title: '角色卡深度塑造',
    categoryName: '角色塑造',
    content:
      '请为角色 {{role}} 生成一份深度角色塑造方案。包含：核心动机与欲望、性格底色与表面反差、重要经历与心理阴影、说话风格与习惯动作、与其他角色的关键关系网。',
    tags: ['角色卡', '动机', '性格'],
    remark: '为角色生成完整的人物塑造方案'
  },
  {
    title: '角色成长弧线',
    categoryName: '角色塑造',
    content:
      '请为角色 {{role}} 设计一条清晰的成长弧线。要求：明确角色的初始缺陷、核心信念、关键转折事件和最终改变，确保成长过程合理自然，且与主线剧情紧密相连。',
    tags: ['成长', '弧线', '变化'],
    remark: '设计角色的成长与发展路径'
  },
  {
    title: '反派塑造大师',
    categoryName: '角色塑造',
    content:
      '请为当前故事中的反派角色 {{role}} 进行深度塑造。要求：反派要有令人信服的动机和立场，不能是单纯的坏，要展现其人性化的一面，让读者能够理解甚至同情其选择。',
    tags: ['反派', '动机', '人性'],
    remark: '塑造有深度和说服力的反派角色'
  },
  {
    title: '角色对话风格定制',
    categoryName: '角色塑造',
    content:
      '请为角色 {{role}} 定制一套独特的对话风格。包括：常用口头禅和句式、语气词习惯、说话节奏与停顿方式、情感爆发时的表达特点、不同场景下的语气变化。',
    tags: ['对话', '风格', '辨识度'],
    remark: '打造角色独有的语言辨识度'
  },
  {
    title: '配角高光时刻',
    categoryName: '角色塑造',
    content:
      '请为配角 {{role}} 设计一个高光时刻。要求：在不喧宾夺主的前提下，让配角展现出自己的独特魅力和价值，可以是通过一个小行动改变剧情走向，或展现出令人印象深刻的品质。',
    tags: ['配角', '高光', '价值'],
    remark: '让配角在故事中发光出彩'
  }
]

/** 将内置模板转换为 PromptCategory 和 PromptEntry 数据结构 */
export function buildBuiltinPromptData(): { categories: PromptCategory[]; entries: PromptEntry[] } {
  const now = new Date().toISOString()
  const categories: PromptCategory[] = BUILTIN_PROMPT_CATEGORY_NAMES.map((name, index) => ({
    id: `prompt-cat-builtin-${index + 1}`,
    name,
    sortOrder: index,
    isBuiltin: true,
    createdAt: now,
    updatedAt: now
  }))

  const categoryIdMap = new Map(categories.map((cat) => [cat.name, cat.id]))

  const entries: PromptEntry[] = BUILTIN_PROMPT_TEMPLATES.map((template, index) => ({
    id: `prompt-builtin-${index + 1}`,
    categoryId: categoryIdMap.get(template.categoryName) ?? categories[0]?.id ?? '',
    title: template.title,
    content: template.content,
    tags: template.tags,
    remark: template.remark,
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    isBuiltin: true,
    sortOrder: index,
    createdAt: now,
    updatedAt: now
  }))

  return { categories, entries }
}
