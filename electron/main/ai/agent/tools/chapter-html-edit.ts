function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

export function textToHtmlParagraphs(text: string): string {
  // 与 renderer 端 serializePlainTextToHtml 保持一致：
  // 按双换行分段，段内单换行转为 <br />，避免单换行被错误分割为多个段落。
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return '<p></p>'
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

function textToInlineHtml(text: string): string {
  return text
    .trim()
    .split(/\n+/)
    .map((line) => escapeHtml(line.trim()))
    .join('<br>')
}

function mapPlainIndexToHtml(html: string, plainIdx: number): number {
  let charCount = 0
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      while (i < html.length && html[i] !== '>') i++
      i++
      continue
    }
    if (html[i] === '&') {
      const semiIdx = html.indexOf(';', i)
      if (semiIdx !== -1 && semiIdx - i < 10) {
        if (charCount === plainIdx) return i
        charCount++
        i = semiIdx + 1
        continue
      }
    }
    if (charCount === plainIdx) return i
    charCount++
    i++
  }
  return html.length
}

function buildWhitespaceInsensitiveIndex(text: string): { value: string; indexMap: number[] } {
  let value = ''
  const indexMap: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) continue
    value += text[i]
    indexMap.push(i)
  }
  return { value, indexMap }
}

function findPlainTextRange(plain: string, search: string): { start: number; end: number } | null {
  const target = search.trim()
  if (!target) return null

  const exactStart = plain.indexOf(target)
  if (exactStart !== -1) {
    return { start: exactStart, end: exactStart + target.length }
  }

  const compactTarget = target.replace(/\s+/g, '')
  if (!compactTarget) return null

  const compactPlain = buildWhitespaceInsensitiveIndex(plain)
  const compactStart = compactPlain.value.indexOf(compactTarget)
  if (compactStart === -1) return null

  const compactEnd = compactStart + compactTarget.length - 1
  return {
    start: compactPlain.indexMap[compactStart],
    end: compactPlain.indexMap[compactEnd] + 1
  }
}

export function replaceInHtml(html: string, search: string, replacement: string): string {
  const plain = stripHtmlTags(html)
  const range = findPlainTextRange(plain, search)
  if (!range) {
    throw new Error(`Could not find target text: "${search.slice(0, 50)}..."`)
  }
  const htmlStart = mapPlainIndexToHtml(html, range.start)
  const htmlEnd = mapPlainIndexToHtml(html, range.end)
  return html.slice(0, htmlStart) + textToInlineHtml(replacement) + html.slice(htmlEnd)
}

export function insertInHtml(
  html: string,
  search: string,
  insertion: string,
  position: 'before' | 'after'
): string {
  const plain = stripHtmlTags(html)
  const range = findPlainTextRange(plain, search)
  if (!range) {
    throw new Error(`Could not find anchor text: "${search.slice(0, 50)}..."`)
  }
  const anchorIdx = position === 'before'
    ? mapPlainIndexToHtml(html, range.start)
    : mapPlainIndexToHtml(html, range.end)
  const insertionHtml = textToInlineHtml(insertion)
  const separatedInsertion = position === 'before'
    ? `${insertionHtml}<br>`
    : `<br>${insertionHtml}`
  return html.slice(0, anchorIdx) + separatedInsertion + html.slice(anchorIdx)
}

export function joinChapterBlocks(current: string, addition: string, position: 'start' | 'end'): string {
  if (!stripHtmlTags(current)) return addition
  return position === 'start' ? addition + current : current + addition
}
