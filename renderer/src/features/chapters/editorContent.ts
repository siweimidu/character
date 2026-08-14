// 匹配 HTML 标签的正则，用于判断内容是富文本还是纯文本
const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i

// HTML 实体到字符的映射表，用于解码常见命名实体
const NAMED_ENTITY_MAP: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  deg: '°',
  times: '×',
  divide: '÷',
  minus: '−'
}

// 将字符串中的特殊字符转义为 HTML 实体，防止 XSS 和富文本解析问题
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 将单个 HTML 实体（含分号）解码为对应的字符。
 * 支持命名实体（如 &amp;、&mdash;）、十进制数字实体（&#39;）和十六进制数字实体（&#x27;）。
 * 无法识别的实体原样返回。
 */
function decodeHtmlEntity(entityToken: string): string {
  const raw = entityToken.slice(1, -1) // 去掉 & 与 ;

  // 数字实体：&#39; 或 &#x27;
  if (raw[0] === '#') {
    const body = raw.slice(1)
    const codePoint = body[0]?.toLowerCase() === 'x'
      ? Number.parseInt(body.slice(1), 16)
      : Number.parseInt(body, 10)
    if (Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        // 非法码点（如孤立代理项）回退为原样
      }
    }
    return entityToken
  }

  return NAMED_ENTITY_MAP[raw] ?? entityToken
}

// 将 HTML 实体（如 &amp;、&#39;、&#x27;、&mdash;）解码为对应的原始字符
function decodeHtmlEntities(value: string): string {
  return value.replace(/&[^;\s]{1,16};/g, decodeHtmlEntity)
}

// 判断内容是否为富文本（包含 HTML 标签）
export function isRichTextDocument(content: string): boolean {
  return HTML_TAG_PATTERN.test(content)
}

// 将纯文本内容序列化为 HTML：
// 以双换行分段为 <p> 标签，段内单换行转为 <br />，同时转义特殊字符
export function serializePlainTextToHtml(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return '<p></p>'
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

// 确保编辑器内容始终为 HTML 格式：
// 空内容返回空段落标签，纯文本自动转为 HTML，富文本原样返回
export function ensureEditorHtmlContent(content: string): string {
  const normalized = content.trim()
  if (!normalized) {
    return '<p></p>'
  }

  return isRichTextDocument(normalized) ? normalized : serializePlainTextToHtml(normalized)
}

// 从 HTML 内容中提取纯文本：
// 将 <br>、块级标签转为换行，列表项转为 "- " 前缀，去除所有标签后解码实体
// 最终压缩连续空行，返回干净的纯文本
function extractPlainText(normalized: string): string {
  return decodeHtmlEntities(
    normalized
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 单条目缓存：同一内容在单次渲染内会被多处读取（字数、进度、预览、AI 上下文等），
// 避免对超大章节（如数十万字）反复做整段正则解析。仅缓存最近一次结果，
// 防止长字符串长期驻留内存，同时覆盖“同一内容被高频重复读取”的热路径。
let cachedPlainTextKey: string | null = null
let cachedPlainTextValue = ''

// 从 HTML 内容中提取纯文本：
// 将 <br>、块级标签转为换行，列表项转为 "- " 前缀，去除所有标签后解码实体
// 最终压缩连续空行，返回干净的纯文本
export function getPlainTextFromEditorContent(content: string): string {
  const normalized = content.trim()
  if (!normalized) {
    return ''
  }

  // 命中单条目缓存则直接复用，避免对同一大段内容重复解析。
  if (cachedPlainTextKey === normalized) {
    return cachedPlainTextValue
  }

  const result = isRichTextDocument(normalized)
    ? extractPlainText(normalized)
    : normalized

  cachedPlainTextKey = normalized
  cachedPlainTextValue = result
  return result
}

// 获取章节正文的字符数（去除空白后的纯文本长度）
// 复用 getPlainTextFromEditorContent 的单条目缓存，减少大章节下的重复解析开销。
export function getChapterCharacterCount(content: string): number {
  return getPlainTextFromEditorContent(content).length
}

// 获取章节正文的预览文本：将纯文本中连续空白压缩为单个空格
// 无内容时返回 fallback 默认提示文案
export function getChapterPreviewText(content: string, fallback = '章节尚未写入正文内容。'): string {
  const preview = getPlainTextFromEditorContent(content).replace(/\s+/g, ' ').trim()
  return preview || fallback
}
