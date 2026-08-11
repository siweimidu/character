import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GEMINI_THOUGHT_SIGNATURE_HINT,
  formatAiErrorMessage,
  isGeminiThoughtSignatureError
} from './error-message.ts'

const GEMINI_THOUGHT_ERROR_MSG = [
  '[{"error":{',
  '"code":400,',
  '"message":"函数调用 (functionCall) 部分缺少 thought_signature（思考签名）。',
  '这是工具正常工作所必需的，缺少 thought_signature 可能会导致模型性能下降。',
  '附加数据：函数调用 default_api:list_chapters，位置 2。',
  '详情请参阅 https://ai.google.dev/gemini-api/docs/thought-signatures 。",',
  '"status":"INVALID_ARGUMENT"',
  '}}]'
].join('')

test('识别 Gemini OpenAI 兼容接口的 thought_signature 错误', () => {
  const err = new Error(GEMINI_THOUGHT_ERROR_MSG)
  assert.equal(isGeminiThoughtSignatureError(err), true)
})

test('不把普通工具错误误判为 thought_signature', () => {
  assert.equal(isGeminiThoughtSignatureError(new Error('tools are not supported')), false)
  assert.equal(isGeminiThoughtSignatureError(new Error('某模型不支持工具调用')), false)
})

test('formatAiErrorMessage 对 Gemini thought_signature 给出清晰指引', () => {
  const err = new Error(GEMINI_THOUGHT_ERROR_MSG)
  const message = formatAiErrorMessage(err, 'AI 调用失败')
  assert.equal(message, GEMINI_THOUGHT_SIGNATURE_HINT)
  assert.ok(message.includes('thought_signature'))
  assert.ok(message.includes('Claude / GPT'))
})

test('普通错误仍走原有格式化逻辑', () => {
  const message = formatAiErrorMessage(new Error('connection refused'), 'AI 调用失败')
  assert.equal(message, 'connection refused')
})
