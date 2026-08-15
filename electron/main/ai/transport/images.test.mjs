import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGeminiImageRequestBody, isGeminiNativeImageModel, parseGeminiImageResponse, resolveGeminiNativeSettings } from './images.ts'

test('buildGeminiImageRequestBody 生成正确的 generateContent 请求体', () => {
  const body = JSON.parse(buildGeminiImageRequestBody('一张网文封面'))
  assert.deepEqual(body.contents, [{ parts: [{ text: '一张网文封面' }] }])
  assert.deepEqual(body.generationConfig, { responseModalities: ['IMAGE'] })
})

test('parseGeminiImageResponse 提取 inlineData 图片与用量', () => {
  const payload = {
    candidates: [{
      content: {
        parts: [
          { text: '封面已生成' },
          { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' } }
        ]
      },
      finishReason: 'STOP'
    }],
    usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7, totalTokenCount: 49 }
  }
  const result = parseGeminiImageResponse(payload)
  assert.ok(result)
  assert.equal(result?.dataUrl, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')
  assert.equal(result?.revisedPrompt, '封面已生成')
  assert.deepEqual(result?.usage, {
    promptTokens: 42,
    completionTokens: 7,
    totalTokens: 49
  })
})

test('parseGeminiImageResponse 无 mimeType 时默认 image/png', () => {
  const result = parseGeminiImageResponse({
    candidates: [{ content: { parts: [{ inlineData: { data: 'AAAA' } }] } }]
  })
  assert.ok(result)
  assert.equal(result?.dataUrl, 'data:image/png;base64,AAAA')
})

test('parseGeminiImageResponse 返回 error 消息时抛出', () => {
  assert.throws(
    () => parseGeminiImageResponse({ error: { message: 'API key 无效' } }),
    /API key 无效/
  )
})

test('parseGeminiImageResponse 无图片且无文本时返回 null', () => {
  assert.equal(parseGeminiImageResponse({ candidates: [{ content: { parts: [] } }] }), null)
  assert.equal(parseGeminiImageResponse({}), null)
})

test('parseGeminiImageResponse 有文本但无图片时抛出可读错误', () => {
  assert.throws(
    () => parseGeminiImageResponse({ candidates: [{ content: { parts: [{ text: '抱歉，我无法生成图片' }] } }] }),
    /未返回图片数据/
  )
})

test('isGeminiNativeImageModel 识别 Gemini 原生图像模型', () => {
  assert.equal(isGeminiNativeImageModel('gemini-2.5-flash-image'), true)
  assert.equal(isGeminiNativeImageModel('imagen-3.0-generate-002'), true)
  assert.equal(isGeminiNativeImageModel('gpt-image-1'), false)
  assert.equal(isGeminiNativeImageModel('gemini-2.5-flash'), false)
  assert.equal(isGeminiNativeImageModel(''), false)
})

test('resolveGeminiNativeSettings 将 OpenAI 兼容入口修正为原生 v1beta 端点', () => {
  const base = (input) => resolveGeminiNativeSettings({ baseUrl: input, model: 'gemini-2.5-flash-image' }).baseUrl
  // 原生 v1beta 保持不变
  assert.equal(base('https://generativelanguage.googleapis.com/v1beta'), 'https://generativelanguage.googleapis.com/v1beta')
  // 剥离 /openai 兼容后缀
  assert.equal(base('https://generativelanguage.googleapis.com/v1beta/openai'), 'https://generativelanguage.googleapis.com/v1beta')
  // /v1 补全为 /v1beta
  assert.equal(base('https://generativelanguage.googleapis.com/v1'), 'https://generativelanguage.googleapis.com/v1beta')
  // 非 Gemini 域名保持原样
  assert.equal(base('https://api.openai.com/v1'), 'https://api.openai.com/v1')
})
