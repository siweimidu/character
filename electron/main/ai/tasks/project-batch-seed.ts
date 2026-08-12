import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, OutlineResult, ProjectBatchSeedResult, WorldviewResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { normalizeWorldviewType } from './worldview-type'

/** 批量生成作品任务：一次生成多个作品（名称、简介、题材、篇幅、开局世界观与前 3 章大纲） */
const handler: TaskHandler = {
  name: 'project-batch-seed',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'worldview', 'outline', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    // 数量不设硬限制：仅做最小值与合理上限兜底，避免单次请求输出过大导致超时
    const count = Math.max(1, Math.min(50, Number(context.count) || 3))
    const requestedGenre = String(context.genre ?? '').trim()
    const requestedLength = String(context.novelLength ?? '').trim()
    const genreLabel = requestedGenre ? `统一题材：${requestedGenre}` : '题材：不指定（请为每个作品挑选差异化且合适的题材）'
    const lengthLabel = requestedLength === 'short'
      ? '目标篇幅：短篇（聚焦单线冲突，强调完整闭环与集中爆发）'
      : requestedLength === 'long'
        ? '目标篇幅：长篇（适合连载推进，允许多线铺陈与持续升级）'
        : '目标篇幅：不指定（请根据每个作品的题材和设定选择合适的长篇或短篇）'

    return {
      system: `${capabilityPreamble.system}\n\n你是资深小说策划编辑。任务是为用户一次批量构思 ${count} 个全新小说作品。请只返回 JSON 对象，不要返回 Markdown。对象必须包含 entries 数组，entries 里每项都必须包含 title、premise、genre、novelLength、worldviewEntries、outlineItems。worldviewEntries 每项包含 type、title、content；outlineItems 每项包含 title、wordTarget、conflict、summary。`,
      user: `${capabilityPreamble.user}\n\n请为用户批量构思 ${count} 个差异化、可落地的全新小说作品。\n\n批量要求：\n- ${genreLabel}\n- ${lengthLabel}\n- 每个作品之间在题材、设定、主角处境上要有足够差异化，避免同质化\n- entries 数组必须恰好包含 ${count} 个作品\n\n每个作品的字段要求：\n1. title：作品名称（2-6 字为主，有辨识度、有故事感）\n2. premise：小说简介（180-400 字，包含主角身份、触发事件、核心目标、主要阻力、未决悬念，作为后续生成世界观和大纲的依据）\n3. genre：题材分类（如科幻/仙侠/都市/悬疑/言情等）\n4. novelLength：目标篇幅，只允许 "short"（短篇）或 "long"（长篇），与上面目标篇幅要求一致\n5. worldviewEntries：开局世界观设定，返回 3 条，每条含 type（必须是 地理/法则/物种/势力/历史 之一）、title、content；三条设定之间要互相支撑，与题材和简介紧密相关\n6. outlineItems：前 3 章的大纲，返回 3 条，每条含 title、wordTarget（使用"预估 xxxx字"格式）、conflict、summary；三条大纲要形成连续推进的开局\n\n所有内容使用中文，必须紧贴题材、篇幅和简介。\n\n${writingStyle}\n\n返回格式：{"entries":[{"title":"","premise":"","genre":"","novelLength":"long","worldviewEntries":[{"type":"","title":"","content":""}],"outlineItems":[{"title":"","wordTarget":"","conflict":"","summary":""}]}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const rawList = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { entries?: unknown }).entries)
      ? ((parsed as { entries: unknown[] }).entries)
      : []
    const list = rawList.slice(0, 50)
    const result: ProjectBatchSeedResult = list.map((item) => {
      const entry = item as Partial<{
        title: unknown
        premise: unknown
        genre: unknown
        novelLength: unknown
        worldviewEntries: unknown
        outlineItems: unknown
      }>
      const rawWorldview = Array.isArray(entry.worldviewEntries) ? entry.worldviewEntries : []
      const rawOutline = Array.isArray(entry.outlineItems) ? entry.outlineItems : []
      const worldviewEntries: WorldviewResult[] = rawWorldview.slice(0, 3).map((e) => {
        const w = e as Partial<WorldviewResult>
        return {
          type: normalizeWorldviewType(w.type, '地理'),
          title: w.title?.trim() || '新世界观词条',
          content: w.content?.trim() || 'AI 未返回有效内容'
        } as WorldviewResult
      })
      const outlineItems: OutlineResult[] = rawOutline.slice(0, 3).map((o, index) => {
        const item = o as Partial<OutlineResult>
        return {
          title: item.title?.trim() || `第${index + 1}章：新剧情节点`,
          wordTarget: item.wordTarget?.trim() || '预估 3000字',
          conflict: item.conflict?.trim() || '新的冲突正在酝酿。',
          summary: item.summary?.trim() || 'AI 未返回有效剧情摘要'
        } as OutlineResult
      })
      const novelLength = entry.novelLength === 'short' ? 'short' : 'long'
      return {
        title: String(entry.title ?? '').trim() || '未命名作品',
        premise: String(entry.premise ?? '').trim() || '',
        genre: String(entry.genre ?? '').trim() || '未分类',
        novelLength,
        worldviewEntries,
        outlineItems
      }
    })
    return result
  },
  validate(result: AiTaskResult): boolean {
    return Array.isArray(result) && (result as ProjectBatchSeedResult).length > 0
  }
}
export default handler
