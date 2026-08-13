import { basename, extname } from 'node:path'
import { readFile } from 'node:fs/promises'

export type ReferenceFileType = 'txt' | 'md' | 'docx' | 'json'

export type ReferenceStyleMetric = {
  label: string
  value: string
}

export type ReferenceNovelChunk = {
  id: string
  label: string
  order: number
  text: string
  characterCount: number
  topKeywords: string[]
  metrics: ReferenceStyleMetric[]
}

export type ReferenceNovelLocalContext = {
  title: string
  fileName: string
  fileType: ReferenceFileType
  excerpt: string
  analysisSample: string
  characterCount: number
  chapterCount: number
  topKeywords: string[]
  metrics: ReferenceStyleMetric[]
  analysisChunks: ReferenceNovelChunk[]
}

type JiebaRuntime = {
  jieba: {
    cut(text: string, hmm?: boolean): string[]
  }
  tfidf: {
    extractKeywords(
      jieba: { cut(text: string, hmm?: boolean): string[] },
      text: string,
      limit: number
    ): Array<{ keyword: string }>
  }
}

let jiebaRuntimePromise: Promise<JiebaRuntime> | null = null
const CHAPTER_HEADING_RE = /^(第[0-9零一二三四五六七八九十百千万两]+[章节回卷部集][^\n]{0,40})$/gm
const MAX_ANALYSIS_CHUNKS = 12
const MAX_CHUNK_CHAR_COUNT = 6_000
const CHUNK_KEYWORD_LIMIT = 8
const KEYWORD_TEXT_CLIP = 36_000
const KEYWORD_MAX_LENGTH = 10
const STOP_WORDS = new Set([
  '一个',
  '一种',
  '一些',
  '没有',
  '他们',
  '自己',
  '这个',
  '那个',
  '这里',
  '那里',
  '我们',
  '你们',
  '不是',
  '然后',
  '已经',
  '可以',
  '因为',
  '所以',
  '而且',
  '只是',
  '还是',
  '如果',
  '但是',
  '开始',
  '时候',
  '东西',
  '什么',
  '怎么',
  '一个人',
  '一下',
  '出来',
  '进去',
  '之后',
  '之前',
  '起来',
  '下来',
  '现在',
  '真的',
  '有些',
  '这种',
  '那种',
  '自己人',
  '这时候',
  '那时候',
  '这东西',
  '那东西',
  '这地方',
  '那地方',
  '什么事',
  '怎么会',
  '为什么',
  '不用说',
  '说什么',
  '看着',
  '看向',
  '盯着',
  '听到',
  '说道',
  '问道',
  '笑道',
  '开口',
  '发现',
  '觉得',
  '感觉',
  '知道',
  '明白',
  '继续',
  '直接',
  '慢慢',
  '瞬间',
  '片刻',
  '身上',
  '身体',
  '目光',
  '眼神',
  '脸色',
  '声音',
  '问题',
  '事情',
  '地方'
])

const GENERIC_KEYWORD_RE = /^(说道|问道|笑道|看着|看向|盯着|听到|发现|觉得|感觉|知道|明白|继续|直接|慢慢|瞬间|片刻|身上|身体|目光|眼神|脸色|声音|问题|事情|地方|时候|东西|什么|怎么|如果|因为|所以|但是|然后|已经|还是|可以|不是|没有)$/u
const CHAPTER_TOKEN_RE = /^第?[0-9零一二三四五六七八九十百千万两]+[章节回卷部集]$/u

function normalizeKeywordCandidate(value: string): string {
  return value
    .replace(/[《》〈〉【】〔〕（）()“”"'`~!@#$%^&*+=|\\/:;,.?，。！？；、】【\[\]\s]+/g, '')
    .trim()
}

function isValidKeywordCandidate(keyword: string): boolean {
  if (!keyword || keyword.length < 2 || keyword.length > KEYWORD_MAX_LENGTH) {
    return false
  }

  if (STOP_WORDS.has(keyword) || GENERIC_KEYWORD_RE.test(keyword) || CHAPTER_TOKEN_RE.test(keyword)) {
    return false
  }

  if (/^\d+$/.test(keyword) || /^[A-Za-z0-9]{1,2}$/.test(keyword)) {
    return false
  }

  if (!/^[\p{Script=Han}A-Za-z0-9·_-]+$/u.test(keyword)) {
    return false
  }

  if (!/[\p{Script=Han}A-Za-z]/u.test(keyword)) {
    return false
  }

  if (/([^\d])\1\1/u.test(keyword)) {
    return false
  }

  if (
    (keyword.startsWith('这个') || keyword.startsWith('那个') || keyword.startsWith('一种') || keyword.startsWith('一个'))
    || (keyword.endsWith('时候') || keyword.endsWith('一下') || keyword.endsWith('出来') || keyword.endsWith('进去'))
  ) {
    return false
  }

  return true
}

function selectDistinctKeywords(
  candidates: Array<{ keyword: string; score: number; frequency: number }>,
  limit: number
): string[] {
  const selected: string[] = []

  for (const candidate of candidates) {
    if (selected.length >= limit) {
      break
    }

    const duplicatedByLongerKeyword = selected.some((existing) =>
      (existing.includes(candidate.keyword) || candidate.keyword.includes(existing))
      && Math.abs(existing.length - candidate.keyword.length) <= 2
    )

    if (duplicatedByLongerKeyword) {
      continue
    }

    selected.push(candidate.keyword)
  }

  return selected
}

async function getJiebaRuntime(): Promise<JiebaRuntime> {
  if (!jiebaRuntimePromise) {
    jiebaRuntimePromise = (async () => {
      const [{ Jieba, TfIdf }, { dict, idf }] = await Promise.all([
        import('@node-rs/jieba'),
        import('@node-rs/jieba/dict.js')
      ])

      return {
        jieba: Jieba.withDict(dict),
        tfidf: TfIdf.withDict(idf)
      }
    })()
  }

  return jiebaRuntimePromise
}

function resolveFileType(filePath: string): ReferenceFileType {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.docx') {
    return 'docx'
  }

  if (extension === '.md' || extension === '.markdown') {
    return 'md'
  }

  if (extension === '.json') {
    return 'json'
  }

  return 'txt'
}

function normalizeNovelText(rawText: string): string {
  return rawText
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readNovelText(filePath: string, fileType: ReferenceFileType): Promise<string> {
  if (fileType === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filePath })
    return normalizeNovelText(result.value)
  }

  const buffer = await readFile(filePath)
  const raw = buffer.toString('utf-8')
  if (fileType === 'json') {
    return normalizeNovelText(extractJsonNovel(raw).text)
  }
  return normalizeNovelText(raw)
}

/**
 * 解析 JSON 参考小说，返回正文文本与可选标题。支持多种常见结构：
 *   - { "title": "...", "content": "..." }（单个 content 字段）
 *   - { "chapters": ["...", "..."] }（章节数组）
 *   - { "content": ["段落1", "段落2"] }（段落数组）
 *   - 顶层直接为字符串或字符串数组
 * 若解析失败或没有可用文本则抛出错误。
 */
function extractJsonNovel(rawJson: string): { title: string; text: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error('JSON 文件解析失败，请确认是有效的 JSON 格式。')
  }

  let title = ''

  if (typeof parsed === 'string') {
    return { title, text: parsed }
  }

  if (Array.isArray(parsed)) {
    const parts = parsed.filter((item): item is string => typeof item === 'string')
    if (!parts.length) {
      throw new Error('JSON 文件中没有可用的文本内容。')
    }
    return { title, text: parts.join('\n\n') }
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>

    const titleValue = record.title ?? record.name ?? record.bookTitle
    if (typeof titleValue === 'string' && titleValue.trim()) {
      title = titleValue.trim()
    }

    // 收集可能包含正文的字段（优先级从高到低）
    const content = collectTextField(record, ['content', 'text', 'body', '正文', '内容'])
    if (content) {
      return { title, text: content }
    }

    const chapters = collectTextField(record, ['chapters', 'sections', 'chaptersText', '章节'])
    if (chapters) {
      return { title, text: chapters }
    }

    // 兜底：尝试拼接所有字符串值
    const fallback = Object.values(record)
      .filter((value): value is string => typeof value === 'string')
      .join('\n\n')
    if (fallback.trim()) {
      return { title, text: fallback }
    }
  }

  throw new Error('JSON 文件中没有可用的文本内容。')
}

function collectTextField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
    if (Array.isArray(value)) {
      const parts = value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
      if (parts.length) {
        return parts.join('\n\n')
      }
      const nestedChapters = value
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((chapter) => collectTextField(chapter as Record<string, unknown>, ['content', 'text', 'body', '正文', '内容']))
        .filter(Boolean)
      if (nestedChapters.length) {
        return nestedChapters.join('\n\n')
      }
    }
    if (value && typeof value === 'object') {
      const nested = collectTextField(value as Record<string, unknown>, keys)
      if (nested) {
        return nested
      }
    }
  }
  return ''
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function splitChapters(text: string): string[] {
  const matches = Array.from(text.matchAll(CHAPTER_HEADING_RE))
  if (matches.length >= 3) {
    return matches
      .map((match, index) => {
        const start = match.index ?? 0
        const end = matches[index + 1]?.index ?? text.length
        return text.slice(start, end).trim()
      })
      .filter(Boolean)
  }

  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) {
    return []
  }

  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length > 2600 && current.trim()) {
      chunks.push(current.trim())
      current = paragraph
      continue
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trim()}……`
}

function buildAnalysisSample(chapters: string[], text: string): string {
  const sourceSections = chapters.length >= 3
    ? [chapters[0], chapters[Math.floor(chapters.length / 2)], chapters[chapters.length - 1]]
    : [
        text.slice(0, 2200),
        text.slice(Math.max(0, Math.floor(text.length / 2) - 1100), Math.max(0, Math.floor(text.length / 2) - 1100) + 2200),
        text.slice(Math.max(0, text.length - 2200))
      ]

  return sourceSections
    .map((section, index) => {
      const label = index === 0 ? '开篇样本' : index === 1 ? '中段样本' : '后段样本'
      return `【${label}】\n${clipText(section.trim(), 2200)}`
    })
    .join('\n\n')
}

function computeMetrics(text: string, chapters: string[]): ReferenceStyleMetric[] {
  const plainText = text.replace(/\s+/g, '')
  const characterCount = plainText.length
  const paragraphs = splitParagraphs(text)
  const sentences = text
    .split(/[。！？!?；;]+/)
    .map((sentence) => sentence.replace(/\s+/g, '').trim())
    .filter(Boolean)
  const dialogueParagraphCount = paragraphs.filter((paragraph) => /[“”「」『』"']/u.test(paragraph)).length
  const shortSentenceCount = sentences.filter((sentence) => sentence.length <= 18).length
  const emotionMarkCount = (text.match(/[!?！？]/g) ?? []).length
  const avgSentenceLength = sentences.length ? plainText.length / sentences.length : 0
  const dialogueParagraphRatio = paragraphs.length ? dialogueParagraphCount / paragraphs.length : 0
  const shortSentenceRatio = sentences.length ? shortSentenceCount / sentences.length : 0
  const emotionMarksPerThousand = characterCount ? (emotionMarkCount / characterCount) * 1000 : 0

  return [
    { label: '总字数', value: `${characterCount.toLocaleString('zh-CN')} 字` },
    { label: '章节估计', value: `${Math.max(chapters.length, 1)} 段/章` },
    { label: '平均句长', value: `${avgSentenceLength.toFixed(1)} 字/句` },
    { label: '对白段落占比', value: `${(dialogueParagraphRatio * 100).toFixed(0)}%` },
    { label: '短句比例', value: `${(shortSentenceRatio * 100).toFixed(0)}%` },
    { label: '情绪标点密度', value: `每千字 ${emotionMarksPerThousand.toFixed(1)} 个` }
  ]
}

async function extractKeywords(text: string, limit = 10): Promise<string[]> {
  const { jieba, tfidf } = await getJiebaRuntime()
  const clippedText = clipText(text, KEYWORD_TEXT_CLIP)
  const tfidfKeywords = tfidf.extractKeywords(jieba, clippedText, Math.max(limit * 3, 24))
  const tokenFrequency = new Map<string, number>()

  for (const token of jieba.cut(clippedText, false)) {
    const normalized = normalizeKeywordCandidate(token)
    if (!isValidKeywordCandidate(normalized)) {
      continue
    }
    tokenFrequency.set(normalized, (tokenFrequency.get(normalized) ?? 0) + 1)
  }

  const scoreMap = new Map<string, { keyword: string; score: number; frequency: number }>()

  tfidfKeywords.forEach((entry, index) => {
    const keyword = normalizeKeywordCandidate(entry.keyword)
    if (!isValidKeywordCandidate(keyword)) {
      return
    }

    const current = scoreMap.get(keyword) ?? { keyword, score: 0, frequency: tokenFrequency.get(keyword) ?? 0 }
    current.score += Math.max(0, 30 - index)
    scoreMap.set(keyword, current)
  })

  for (const [keyword, frequency] of tokenFrequency.entries()) {
    const current = scoreMap.get(keyword) ?? { keyword, score: 0, frequency }
    current.frequency = frequency
    current.score += frequency * 4
    current.score += Math.min(keyword.length, 6)
    if (/^[\p{Script=Han}]{3,6}$/u.test(keyword)) {
      current.score += 3
    }
    if (clippedText.length > 12_000 && frequency < 2) {
      current.score -= 3
    }
    scoreMap.set(keyword, current)
  }

  const ranked = Array.from(scoreMap.values())
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.frequency !== left.frequency) return right.frequency - left.frequency
      return right.keyword.length - left.keyword.length
    })

  return selectDistinctKeywords(ranked, limit)
}

function mergeSectionsIntoChunks(sections: string[]): string[] {
  if (sections.length === 0) {
    return []
  }

  const merged: string[] = []
  let current = ''

  for (const section of sections) {
    if (section.length > MAX_CHUNK_CHAR_COUNT) {
      if (current.trim()) {
        merged.push(current.trim())
        current = ''
      }

      for (let index = 0; index < section.length; index += MAX_CHUNK_CHAR_COUNT) {
        const slice = section.slice(index, index + MAX_CHUNK_CHAR_COUNT).trim()
        if (slice) {
          merged.push(slice)
        }
      }
      continue
    }

    const candidate = current ? `${current}\n\n${section}` : section
    if (candidate.length > MAX_CHUNK_CHAR_COUNT && current.trim()) {
      merged.push(current.trim())
      current = section
      continue
    }

    current = candidate
  }

  if (current.trim()) {
    merged.push(current.trim())
  }

  return merged
}

function pickRepresentativeChunkIndexes(total: number): number[] {
  if (total <= MAX_ANALYSIS_CHUNKS) {
    return Array.from({ length: total }, (_, index) => index)
  }

  const indexes = new Set<number>([0, total - 1, Math.floor(total / 2)])
  const step = (total - 1) / (MAX_ANALYSIS_CHUNKS - 1)

  for (let index = 0; index < MAX_ANALYSIS_CHUNKS; index += 1) {
    indexes.add(Math.round(index * step))
  }

  return Array.from(indexes)
    .sort((left, right) => left - right)
    .slice(0, MAX_ANALYSIS_CHUNKS)
}

function buildChunkLabel(index: number, total: number): string {
  if (index === 0) {
    return '开篇段'
  }

  if (index === total - 1) {
    return '收束段'
  }

  const ratio = total <= 1 ? 0 : index / (total - 1)
  if (ratio < 0.34) {
    return '前段'
  }

  if (ratio > 0.66) {
    return '后段'
  }

  return '中段'
}

async function buildAnalysisChunks(chapters: string[]): Promise<ReferenceNovelChunk[]> {
  const mergedChunks = mergeSectionsIntoChunks(chapters)
  const selectedIndexes = pickRepresentativeChunkIndexes(mergedChunks.length)

  return Promise.all(selectedIndexes.map(async (chunkIndex, order) => {
    const text = mergedChunks[chunkIndex]
    const plainText = text.replace(/\s+/g, '')
    const label = `${buildChunkLabel(chunkIndex, mergedChunks.length)} ${chunkIndex + 1}/${mergedChunks.length}`
    return {
      id: `chunk-${chunkIndex + 1}`,
      label,
      order,
      text,
      characterCount: plainText.length,
      topKeywords: await extractKeywords(text, CHUNK_KEYWORD_LIMIT),
      metrics: computeMetrics(text, [text])
    }
  }))
}

export async function extractReferenceNovelContext(filePath: string): Promise<ReferenceNovelLocalContext> {
  const fileType = resolveFileType(filePath)
  const fileName = basename(filePath)
  const defaultTitle = basename(filePath, extname(filePath)).trim() || '未命名参考作品'
  let title = defaultTitle
  let text = ''

  if (fileType === 'json') {
    const buffer = await readFile(filePath)
    const parsed = extractJsonNovel(buffer.toString('utf-8'))
    text = normalizeNovelText(parsed.text)
    if (parsed.title) {
      title = parsed.title
    }
  } else {
    text = await readNovelText(filePath, fileType)
  }

  if (!text.trim()) {
    throw new Error('导入的文件没有可用正文，请确认文件内容不是空白。')
  }

  const chapters = splitChapters(text)
  const excerpt = clipText(chapters[0] ?? text, 800)
  const [topKeywords, analysisChunks] = await Promise.all([
    extractKeywords(text),
    buildAnalysisChunks(chapters)
  ])

  return {
    title,
    fileName,
    fileType,
    excerpt,
    analysisSample: buildAnalysisSample(chapters, text),
    characterCount: text.replace(/\s+/g, '').length,
    chapterCount: Math.max(chapters.length, 1),
    topKeywords,
    metrics: computeMetrics(text, chapters),
    analysisChunks
  }
}
