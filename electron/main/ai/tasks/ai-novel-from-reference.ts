import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, AiNovelFromReferenceResult, AiNovelFromReferenceEntry } from '../shared-types'

/**
 * 基于拆书知识库中的参考作品风格，AI 生成新作品（选题方案）。
 *
 * 两种模式：
 * - `fuse`（融合生成）：将选中的多本参考书的风格融合，生成 1 个新作品选题。
 * - `separate`（分开生成）：为每本选中的参考书分别生成 1 个沿用其风格的新作品选题。
 *
 * 输入 context：
 * - mode: 'fuse' | 'separate'
 * - references: Array<{ title, source, genre, styleRules[], summary, topKeywords[], documentText }>
 *
 * 输出：{ entries: AiNovelFromReferenceEntry[] }，与 fanqie-seed 结构对齐，
 * 便于前端复用“选题卡片 → 勾选 → 批量创建项目”的交互。
 */
const handler: TaskHandler = {
  name: 'ai-novel-from-reference',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'analysis', 'writing-style', 'outline', 'worldview', 'characters'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input

    const mode = String(context.mode ?? 'fuse').trim()
    const isSeparate = mode === 'separate'
    const targetGenre = String(context.targetGenre ?? '').trim()

    const rawReferences = Array.isArray(context.references) ? context.references : []
    const references = rawReferences
      .map((item) => {
        const ref = (item ?? {}) as Record<string, unknown>
        const title = String(ref.title ?? '').trim() || '未命名参考作品'
        const genre = String(ref.genre ?? '').trim() || '未指明'
        const source = String(ref.source ?? '').trim()
        const summary = String(ref.summary ?? '').trim()
        const styleRules = Array.isArray(ref.styleRules)
          ? ref.styleRules.map((rule) => String(rule)).filter(Boolean)
          : []
        const topKeywords = Array.isArray(ref.topKeywords)
          ? ref.topKeywords.map((keyword) => String(keyword)).filter(Boolean)
          : []
        const documentText = String(ref.documentText ?? '').trim()
        return {
          title,
          genre,
          source,
          summary,
          styleRules,
          topKeywords,
          documentText
        }
      })
      .filter((ref) => ref.title || ref.summary || ref.styleRules.length || ref.documentText)

    const referenceBlocks = references
      .map((ref, index) => {
        const styleLines = [
          ...(ref.styleRules.length ? [`风格规则：${ref.styleRules.slice(0, 10).join('；')}`] : []),
          ...(ref.topKeywords.length ? [`关键标签：${ref.topKeywords.slice(0, 10).join('、')}`] : []),
          ...(ref.summary ? [`拆书摘要：${ref.summary}`] : [])
        ].filter(Boolean)

        const docPart = ref.documentText
          ? `\n  拆书文档要点：\n${ref.documentText.split('\n').slice(0, 60).join('\n').slice(0, 4000)}`
          : ''

        return `## 参考 ${index + 1}：《${ref.title}》${ref.genre ? `（题材：${ref.genre}）` : ''}${ref.source ? `｜${ref.source}` : ''}\n${styleLines.join('\n')}${docPart}`
      })
      .join('\n\n')

    const modeInstruction = isSeparate
      ? `本次为「分开生成」模式：为上面列出的 ${references.length} 本参考书，**每本各生成 1 个**新作品选题，共 ${references.length} 个。每个选题都要吸收对应参考书的风格骨架，但世界观、主角身份、金手指、人物关系必须换新，不能照搬原著。`
      : `本次为「融合生成」模式：将上面列出的 ${references.length} 本参考书的风格**融合**成 1 个全新的作品选题。要综合各书所长（如 A 的节奏 + B 的设定 + C 的叙事），形成差异化且自洽的整体风格。`

    return {
      system: `${capabilityPreamble.system}\n\n你是资深网文编辑与新书策划专家，擅长从已有的"拆书知识库"中提取风格方法论，设计可直接立项的新作品选题。你只返回 JSON 对象，不返回 Markdown。字段必须包含 entries，entries 中每项都必须包含 sourceTitle、title、concept、genre、hook、protagonist、goldFinger、first3Hooks、outline。`,
      user: `${capabilityPreamble.user}\n\n## 任务模式\n\n${modeInstruction}\n\n目标题材偏好（可为空）：${targetGenre || '不限制，由你结合参考书风格决定'}\n\n## 参考作品拆书档案\n\n${referenceBlocks || '（未提供参考作品——请提示用户先选择已拆解的书。）'}\n\n## 要求（对标参考书风格但绝不抄袭）\n1. 每个选题都要吸收参考书的"爽感骨架"（身份反差、金手指快速兑现、每章爽点+钩子、快速打脸），但世界观、主角身份、金手指机制、人物关系必须换新\n2. ${isSeparate ? 'entries 数量必须与参考书数量一致（每本 1 个），且顺序与参考书列表一一对应。' : '只返回 1 个 entries。'}\n3. title 为候选书名，含一个直击卖点的钩子（对标爆款标题模板）\n4. sourceTitle：该选题沿用的参考书标题（分开生成填对应参考书；融合生成填"多书融合"）\n5. concept：一句话核心卖点（≤40字）\n6. genre：题材分类（如都市/玄幻/科幻/直播文等）\n7. hook：一句话概念钩子\n8. protagonist：主角身份 + 核心反差\n9. goldFinger：金手指机制（换新，不抄参考书）\n10. first3Hooks：前 3 章每章的钩子（每章 ≤40字）\n11. outline：这本书的整体主线概述（≤120字）\n\n返回格式：{"entries":[{"sourceTitle":"","title":"","concept":"","genre":"","hook":"","protagonist":"","goldFinger":"","first3Hooks":[""],"outline":""}]}`
    }
  },
  normalize(raw: string, context?: Record<string, unknown>): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<AiNovelFromReferenceResult>
    const mode = String(context?.mode ?? 'fuse').trim()
    const isSeparate = mode === 'separate'
    const references = Array.isArray(context?.references) ? context.references : []
    const expectedCount = isSeparate ? references.length : 1

    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.slice(0, expectedCount || undefined).map((e) => {
          const entry = e as Partial<AiNovelFromReferenceEntry>
          const first3Hooks = Array.isArray(entry.first3Hooks)
            ? entry.first3Hooks.map((h) => String(h).trim()).filter(Boolean).slice(0, 3)
            : []
          return {
            sourceTitle: entry.sourceTitle?.trim() || '',
            title: entry.title?.trim() || '未命名新作选题',
            concept: entry.concept?.trim() || '',
            genre: entry.genre?.trim() || '',
            hook: entry.hook?.trim() || '',
            protagonist: entry.protagonist?.trim() || '',
            goldFinger: entry.goldFinger?.trim() || '',
            first3Hooks,
            outline: entry.outline?.trim() || ''
          } as AiNovelFromReferenceEntry
        })
      : []
    return { entries } as AiNovelFromReferenceResult
  },
  validate(result: AiTaskResult): boolean {
    return (result as AiNovelFromReferenceResult).entries.length > 0
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const errors: string[] = []
    const entries = (result as AiNovelFromReferenceResult).entries ?? []
    if (!entries.length) {
      errors.push('entries 为空，请至少返回一个完整的新作品选题')
    }
    entries.forEach((entry, index) => {
      if (!entry.title || !entry.genre || !entry.outline) {
        errors.push(`第 ${index + 1} 个选题缺少必填字段（title / genre / outline）`)
      }
      if (!entry.first3Hooks?.length) {
        errors.push(`第 ${index + 1} 个选题缺少前 3 章钩子 first3Hooks`)
      }
    })
    return errors
  }
}
export default handler
