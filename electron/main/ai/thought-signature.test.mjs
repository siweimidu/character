import assert from 'node:assert/strict'
import test from 'node:test'

import {
  captureThoughtSignatures,
  injectThoughtSignaturesIntoMessages,
  injectThoughtSignaturesIntoRequestBody,
  resetThoughtSignatureStore
} from './thought-signature.ts'

test.beforeEach(() => {
  resetThoughtSignatureStore()
})

test('非流式响应：捕获 message.tool_calls 里的 thought_signature 并可按 id 注入回传', () => {
  captureThoughtSignatures({
    choices: [{
      message: {
        role: 'assistant',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'list_chapters', arguments: '{}' },
          extra_content: { google: { thought_signature: 'sig-abc' } }
        }]
      }
    }]
  })

  const messages = [
    { role: 'user', content: '请删除第一章' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_chapters', arguments: '{}' } }]
    },
    { role: 'tool', tool_call_id: 'call_1', content: '章节列表...' }
  ]
  const injected = injectThoughtSignaturesIntoMessages(messages)
  assert.equal(injected, true)
  assert.equal(messages[1].tool_calls[0].extra_content.google.thought_signature, 'sig-abc')
})

test('流式响应：同一帧携带 id 与 signature 时直接捕获', () => {
  captureThoughtSignatures({
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call_2',
          type: 'function',
          function: { name: 'list_chapters', arguments: '' },
          extra_content: { google: { thought_signature: 'sig-stream' } }
        }]
      }
    }]
  })

  const messages = [
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'x', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_2', content: 'ok' }
  ]
  assert.equal(injectThoughtSignaturesIntoMessages(messages), true)
  assert.equal(messages[0].tool_calls[0].extra_content.google.thought_signature, 'sig-stream')
})

test('流式响应：id 与 signature 跨帧返回时按 index 累积捕获', () => {
  // 第一帧只有 id
  captureThoughtSignatures({
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_3', type: 'function', function: { name: 'list_chapters', arguments: '' } }] } }]
  })
  // 第二帧补上 thought_signature（同一 index）
  captureThoughtSignatures({
    choices: [{ delta: { tool_calls: [{ index: 0, extra_content: { google: { thought_signature: 'sig-pending' } } }] } }]
  })

  const messages = [
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_3', type: 'function', function: { name: 'x', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_3', content: 'ok' }
  ]
  assert.equal(injectThoughtSignaturesIntoMessages(messages), true)
  assert.equal(messages[0].tool_calls[0].extra_content.google.thought_signature, 'sig-pending')
})

test('注入后即删除：同一 id 不会再次注入', () => {
  captureThoughtSignatures({
    choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_4', type: 'function', function: { name: 'x', arguments: '{}' }, extra_content: { google: { thought_signature: 'sig-once' } } }] } }]
  })

  const messages = [
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_4', type: 'function', function: { name: 'x', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_4', content: 'ok' }
  ]
  assert.equal(injectThoughtSignaturesIntoMessages(messages), true)
  assert.equal(injectThoughtSignaturesIntoMessages(messages), false)
})

test('请求体为字符串时返回改写后的 JSON 字符串', () => {
  captureThoughtSignatures({
    choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_5', type: 'function', function: { name: 'x', arguments: '{}' }, extra_content: { google: { thought_signature: 'sig-body' } } }] } }]
  })

  const body = JSON.stringify({
    model: 'gemini-3.1-flash-lite',
    messages: [
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_5', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_5', content: 'ok' }
    ]
  })
  const rewritten = injectThoughtSignaturesIntoRequestBody(body)
  assert.equal(typeof rewritten, 'string')
  const parsed = JSON.parse(rewritten)
  assert.equal(parsed.messages[0].tool_calls[0].extra_content.google.thought_signature, 'sig-body')
})

test('无相关签名时请求体不做改写', () => {
  const body = JSON.stringify({ model: 'claude-3-5', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(injectThoughtSignaturesIntoRequestBody(body), undefined)
})

test('无关模型（无 extra_content）的响应不影响捕获', () => {
  captureThoughtSignatures({
    choices: [{ message: { role: 'assistant', content: '普通文本回复' } }]
  })
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(injectThoughtSignaturesIntoRequestBody(body), undefined)
})
