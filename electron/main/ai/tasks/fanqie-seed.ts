import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, FanqieSeedResult, FanqieSeedEntry } from '../shared-types'

/** 新书选题生成任务：基于番茄榜单风向数据，批量生成 2-3 个可落地的新书选题 */
const handler: TaskHandler = {
  name: 'fanqie-seed',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    return {
      system: `${capabilityPreamble.system}\n\n你是番茄小说平台的资深编辑与爆款选题策划。请根据榜单风向数据，设计可直接开新书立项的选题方案。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 entries，entries 中每项都必须包含 title、concept、genre、hook、protagonist、goldFinger、first3Hooks、outline。`,
      user: `${capabilityPreamble.user}\n\n请基于以下番茄榜单风向数据，生成 2 到 3 个差异化、可落地的新书选题。\n\n== 平台风向 ==\n${String(context.platform ?? '番茄小说')}\n\n== 当前榜单的热门赛道（含在读增长） ==\n${String(context.hotGenres ?? '暂无')}\n\n== 当前榜单的高频题材标签 ==\n${String(context.hotThemes ?? '暂无')}\n\n== 当前分类的榜单书目（书名 + 简介 + 在读） ==\n${String(context.categoryBooks ?? '暂无')}\n\n== 风向速评 ==\n${String(context.summary ?? '暂无')}\n\n目标赛道偏好（可为空）：${String(context.targetGenre ?? '')}\n\n要求（严格对标但不抄袭）：\n1. entries 返回 2 到 3 个选题，相互之间赛道/卖点要足够差异化\n2. 每个选题都要吸收榜单的"爽感骨架"（身份反差、金手指快速兑现、每章爽点+钩子、快速打脸），但世界观、主角身份、金手指机制、人物关系必须换新\n3. title 为候选书名，含一个直击卖点的钩子（对标爆款标题模板）\n4. concept：一句话核心卖点（≤40字）\n5. genre：题材分类（如都市/玄幻/科幻/直播文等）\n6. hook：一句话概念钩子\n7. protagonist：主角身份 + 核心反差\n8. goldFinger：金手指机制（换新，不抄榜上标杆）\n9. first3Hooks：前 3 章每章的钩子（每章 ≤40字）\n10. outline：这本书的整体主线概述（≤120字）\n\n返回格式：{"entries":[{"title":"","concept":"","genre":"","hook":"","protagonist":"","goldFinger":"","first3Hooks":[""],"outline":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<FanqieSeedResult>
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.slice(0, 3).map((e) => {
          const entry = e as Partial<FanqieSeedEntry>
          const first3Hooks = Array.isArray(entry.first3Hooks)
            ? entry.first3Hooks.map((h) => String(h).trim()).filter(Boolean).slice(0, 3)
            : []
          return {
            title: entry.title?.trim() || '未命名新书选题',
            concept: entry.concept?.trim() || '',
            genre: entry.genre?.trim() || '',
            hook: entry.hook?.trim() || '',
            protagonist: entry.protagonist?.trim() || '',
            goldFinger: entry.goldFinger?.trim() || '',
            first3Hooks,
            outline: entry.outline?.trim() || ''
          } as FanqieSeedEntry
        })
      : []
    return { entries } as FanqieSeedResult
  },
  validate(result: AiTaskResult): boolean {
    return (result as FanqieSeedResult).entries.length > 0
  }
}
export default handler
