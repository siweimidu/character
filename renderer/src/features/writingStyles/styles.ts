import { writingStylePresets, defaultWritingStylePresetId, type WritingStylePreset } from './presets'

/**
 * 扩展的写作风格条目：在原生预设基础上支持自定义、Skill 导入、颜色与来源标记。
 */
export interface WritingStyleEntry extends WritingStylePreset {
  /** 来源：内置预设 / 用户自定义 / 从 Skill 导入 */
  source: 'builtin' | 'custom' | 'skill'
  /** 最近更新时间（ISO），用于排序 */
  updatedAt: string
}

/** 自定义/导入写作风格的上限 */
export const WRITING_STYLE_LIMIT = 200

const STORAGE_KEY = 'characterarc:writing-styles'
const CUSTOM_COLOR_PALETTE = [
  'linear-gradient(135deg, #dbeafe, #e0f2fe)',
  'linear-gradient(135deg, #fce7f3, #ede9fe)',
  'linear-gradient(135deg, #d1fae5, #dcfce7)',
  'linear-gradient(135deg, #fef3c7, #fde68a)',
  'linear-gradient(135deg, #fee2e2, #fecaca)',
  'linear-gradient(135deg, #e0e7ff, #c7d2fe)',
  'linear-gradient(135deg, #ccfbf1, #d1fae5)',
  'linear-gradient(135deg, #f3f4f6, #e5e7eb)'
]
const CUSTOM_COLOR_PALETTE_DARK = [
  'linear-gradient(135deg, #1e3a5f, #1a3550)',
  'linear-gradient(135deg, #4a2040, #3b2d5e)',
  'linear-gradient(135deg, #1a3d2e, #1c4032)',
  'linear-gradient(135deg, #4a3b1a, #3d3218)',
  'linear-gradient(135deg, #5b2a2a, #4a2020)',
  'linear-gradient(135deg, #2d3158, #262a4a)',
  'linear-gradient(135deg, #1e3d3a, #1a3431)',
  'linear-gradient(135deg, #333a47, #2e3440)'
]

export function nextCustomColor(index: number): { accent: string; accentDark: string } {
  return {
    accent: CUSTOM_COLOR_PALETTE[index % CUSTOM_COLOR_PALETTE.length],
    accentDark: CUSTOM_COLOR_PALETTE_DARK[index % CUSTOM_COLOR_PALETTE_DARK.length]
  }
}

export function loadCustomWritingStyles(): WritingStyleEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.prompt === 'string' && item.prompt.trim())
      .slice(0, WRITING_STYLE_LIMIT)
      .map((item, index) => ({
        id: String(item.id ?? `custom-${index}`),
        label: String(item.label ?? '未命名风格'),
        description: String(item.description ?? ''),
        prompt: String(item.prompt),
        accent: String(item.accent ?? nextCustomColor(index).accent),
        accentDark: String(item.accentDark ?? nextCustomColor(index).accentDark),
        source: item.source === 'skill' ? 'skill' : 'custom',
        updatedAt: String(item.updatedAt ?? new Date().toISOString())
      }))
  } catch {
    return []
  }
}

export function persistCustomWritingStyles(styles: WritingStyleEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(styles.slice(0, WRITING_STYLE_LIMIT)))
  } catch {
    // 忽略存储失败
  }
}

/** 内置 + 自定义 + 导入 的完整风格列表 */
export function resolveAllWritingStyles(custom: WritingStyleEntry[]): WritingStyleEntry[] {
  const builtin: WritingStyleEntry[] = writingStylePresets.map((preset) => ({
    ...preset,
    source: 'builtin',
    updatedAt: ''
  }))
  return [...builtin, ...custom]
}

/** 根据 id 解析风格条目，未匹配回退到默认预设 */
export function resolveWritingStyleEntry(styles: WritingStyleEntry[], id?: string | null): WritingStyleEntry {
  return styles.find((style) => style.id === id) ?? styles.find((s) => s.id === defaultWritingStylePresetId) ?? styles[0]
}

export type WritingStyleSearchMode = 'keyword' | 'fuzzy' | 'exact'

/**
 * 风格搜索：支持三种模式
 * - keyword：关键词包含匹配（label / description / prompt 中任一包含）
 * - fuzzy：模糊完整匹配（query 中的多个关键词需全部命中，允许不连续）
 * - exact：完整匹配（label 或 description 完整等于 query）
 */
export function filterWritingStyles(
  styles: WritingStyleEntry[],
  query: string,
  mode: WritingStyleSearchMode
): WritingStyleEntry[] {
  const q = query.trim()
  if (!q) return styles

  if (mode === 'exact') {
    return styles.filter((style) => style.label === q || style.description === q)
  }

  if (mode === 'fuzzy') {
    const keywords = q.split(/\s+/).filter(Boolean)
    return styles.filter((style) => {
      const haystack = `${style.label} ${style.description} ${style.prompt}`.toLowerCase()
      return keywords.every((kw) => haystack.includes(kw.toLowerCase()))
    })
  }

  // keyword：包含匹配
  const lower = q.toLowerCase()
  return styles.filter((style) =>
    `${style.label} ${style.description} ${style.prompt}`.toLowerCase().includes(lower)
  )
}
