import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureEditorHtmlContent,
  getChapterCharacterCount,
  getChapterPreviewText,
  getPlainTextFromEditorContent,
  isRichTextDocument,
  serializePlainTextToHtml
} from './editorContent.ts'

// getPlainTextFromEditorContent 内部会先剥离标签再解码 HTML 实体。
// 通过富文本输入来验证实体解码是否完整、准确。

test('实体解码：常见命名实体正确还原', () => {
  assert.equal(getPlainTextFromEditorContent('<p>AT&amp;T Co</p>'), 'AT&T Co')
  assert.equal(getPlainTextFromEditorContent('<p>a&mdash;b</p>'), 'a—b')
  assert.equal(getPlainTextFromEditorContent('<p>他说&ldquo;你好&rdquo;</p>'), '他说“你好”')
  assert.equal(getPlainTextFromEditorContent('<p>a&nbsp;b</p>'), 'a b')
})

test('实体解码：十进制与十六进制数字实体正确还原', () => {
  assert.equal(getPlainTextFromEditorContent('<p>It&#39;s a test</p>'), "It's a test")
  assert.equal(getPlainTextFromEditorContent('<p>It&#x27;s a test</p>'), "It's a test")
  assert.equal(getPlainTextFromEditorContent('<p>&#65;&#x42;</p>'), 'AB')
})

test('实体解码：无法识别的实体保留原样，普通文本不受影响', () => {
  assert.equal(getPlainTextFromEditorContent('<p>a&notexist;b</p>'), 'a&notexist;b')
  assert.equal(getPlainTextFromEditorContent('<p>AT&amp;T &amp; company</p>'), 'AT&T & company')
})

test('isRichTextDocument 区分富文本与纯文本', () => {
  assert.equal(isRichTextDocument('<p>hello</p>'), true)
  assert.equal(isRichTextDocument('hello world'), false)
})

test('serializePlainTextToHtml 将纯文本转为段落 HTML', () => {
  assert.equal(serializePlainTextToHtml(''), '<p></p>')
  assert.equal(serializePlainTextToHtml('a&b'), '<p>a&amp;b</p>')
  assert.equal(serializePlainTextToHtml('第一段\n\n第二段'), '<p>第一段</p><p>第二段</p>')
})

test('ensureEditorHtmlContent 确保内容为 HTML 格式', () => {
  assert.equal(ensureEditorHtmlContent(''), '<p></p>')
  assert.equal(ensureEditorHtmlContent('纯文本'), '<p>纯文本</p>')
  assert.equal(ensureEditorHtmlContent('<p>富文本</p>'), '<p>富文本</p>')
})

test('getPlainTextFromEditorContent 正确提取纯文本', () => {
  assert.equal(getPlainTextFromEditorContent(''), '')
  assert.equal(
    getPlainTextFromEditorContent('<p>第一行<br />第二行</p>'),
    '第一行\n第二行'
  )
  assert.equal(
    getPlainTextFromEditorContent('<ul><li>甲</li><li>乙</li></ul>'),
    '- 甲\n- 乙'
  )
  assert.equal(
    getPlainTextFromEditorContent(`<p>他&#39;说&ldquo;好&rdquo;&mdash;&mdash;继续</p>`),
    `他'说“好”——继续`
  )
})

test('getChapterCharacterCount 返回去除首尾空白后的字数（含段落内空格）', () => {
  assert.equal(getChapterCharacterCount(''), 0)
  assert.equal(getChapterCharacterCount('<p>你好世界</p>'), 4)
  // 段落内空格会计入字符数：`你 好 世 界` = 4 个汉字 + 3 个空格
  assert.equal(getChapterCharacterCount('<p>你 好&nbsp;世 界</p>'), 7)
})

test('单条目缓存：相同内容重复读取返回一致结果', () => {
  const html = '<p>第一段</p><p>第二段</p>'
  const first = getPlainTextFromEditorContent(html)
  const second = getPlainTextFromEditorContent(html)
  assert.equal(second, first)
  assert.equal(getChapterCharacterCount(html), getChapterCharacterCount(html))
})

test('单条目缓存：内容变化后返回新结果（缓存不串味）', () => {
  const a = getPlainTextFromEditorContent('<p>甲</p>')
  const b = getPlainTextFromEditorContent('<p>乙</p>')
  const aAgain = getPlainTextFromEditorContent('<p>甲</p>')
  assert.equal(a, '甲')
  assert.equal(b, '乙')
  assert.equal(aAgain, '甲')
})

test('超大内容解析结果与预期一致（32万字规模）', () => {
  const paragraph = '<p>' + '测'.repeat(500) + '</p>'
  const html = paragraph.repeat(640) // 约 32 万字正文
  const count = getChapterCharacterCount(html)
  // 每段 500 字 + 段落间 1 个换行（640 段共 639 个换行）
  assert.equal(count, 500 * 640 + 639)
  // 同一大段内容重复统计命中缓存，结果一致
  assert.equal(getChapterCharacterCount(html), count)
})

test('getChapterPreviewText 压缩空白并支持兜底文案', () => {
  assert.equal(getChapterPreviewText(''), '章节尚未写入正文内容。')
  assert.equal(getChapterPreviewText('', '自定义兜底'), '自定义兜底')
  assert.equal(getChapterPreviewText('<p>你 好  世界</p>'), '你 好 世界')
})
