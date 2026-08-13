import assert from 'node:assert/strict'
import test from 'node:test'

import { estimateTokens } from './token-estimate.ts'

test('estimateTokens 对空文本返回 0', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(undefined), 0)
  assert.equal(estimateTokens(null), 0)
})

test('estimateTokens 对纯中文段落返回非 0 估算值', () => {
  // 模拟测速提示词要求生成的约 80-120 字中文段落
  const text =
    '清晨的湖面平静如镜，薄雾轻轻笼罩着远处的山峦。我坐在岸边，看着太阳慢慢升起，阳光洒在水面上泛起金色的波纹。几只水鸟掠过，留下细细的涟漪。这是一个宁静而美好的早晨。'
  const tokens = estimateTokens(text)
  assert.ok(tokens > 0, '中文段落应估算出非 0 token 数')
  // 约 1 个中文字符 ≈ 0.7 token
  assert.ok(tokens < text.length, '估算 token 数不应超过字符数')
})

test('estimateTokens 对英文文本按字符比例估算', () => {
  const text = 'The quick brown fox jumps over the lazy dog.'
  const tokens = estimateTokens(text)
  assert.ok(tokens > 0)
  assert.ok(tokens <= text.length)
})
