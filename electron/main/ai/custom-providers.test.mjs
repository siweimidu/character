import assert from 'node:assert/strict'
import test from 'node:test'

import {
  anthropicCompleteAdapter,
  createCustomProtocolModel,
  dashscopeNativeAdapter,
  koboldAdapter,
  novelAiAdapter
} from './custom-providers.ts'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function createFetchCapture(handler) {
  const requests = []
  return {
    requests,
    fetch: async (input, init) => {
      requests.push({ url: String(input), init })
      return handler(requests.at(-1))
    }
  }
}

const samplePrompt = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好，我在。' }
]

test('Anthropic 旧版 /v1/complete 请求体与响应解析', async () => {
  const capture = createFetchCapture(() =>
    jsonResponse({ completion: '是的，收到。', stop_reason: 'stop_sequence' })
  )
  const model = createCustomProtocolModel({
    adapter: anthropicCompleteAdapter,
    provider: 'anthropic',
    modelId: 'claude-legacy',
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com/v1',
    fetch: capture.fetch
  })
  const result = await model.doGenerate({
    prompt: samplePrompt,
    maxOutputTokens: 100,
    temperature: 0.5
  })

  assert.match(capture.requests[0].url, /\/v1\/complete$/)
  assert.equal(capture.requests[0].init.headers['x-api-key'], 'test-key')
  const body = JSON.parse(capture.requests[0].init.body)
  assert.equal(body.model, 'claude-legacy')
  assert.match(body.prompt, /USER: 你好/)
  assert.equal(body.max_tokens_to_sample, 100)
  assert.equal(body.temperature, 0.5)

  assert.equal(result.content[0].type, 'text')
  assert.equal(result.content[0].text, '是的，收到。')
  assert.equal(result.finishReason, 'stop')
})

test('KoboldCpp /api/v1/generate 解析 results 数组', async () => {
  const capture = createFetchCapture(() =>
    jsonResponse({ results: [{ text: '行，没问题。' }] })
  )
  const model = createCustomProtocolModel({
    adapter: koboldAdapter,
    provider: 'kobold',
    modelId: 'koboldcpp',
    apiKey: '',
    baseUrl: 'http://localhost:5001',
    fetch: capture.fetch
  })
  const result = await model.doGenerate({ prompt: samplePrompt })
  assert.match(capture.requests[0].url, /\/api\/v1\/generate$/)
  assert.equal(result.content[0].text, '行，没问题。')
})

test('NovelAI /v1/generate 解析 output 文本', async () => {
  const capture = createFetchCapture(() =>
    jsonResponse({ output: '夜色如墨，风声呜咽。' })
  )
  const model = createCustomProtocolModel({
    adapter: novelAiAdapter,
    provider: 'novelai',
    modelId: 'kayra-v1',
    apiKey: 'novel-key',
    baseUrl: 'https://api.novelai.net',
    fetch: capture.fetch
  })
  const result = await model.doGenerate({ prompt: samplePrompt })
  assert.match(capture.requests[0].url, /\/v1\/generate$/)
  assert.equal(capture.requests[0].init.headers.authorization, 'Bearer novel-key')
  assert.equal(result.content[0].text, '夜色如墨，风声呜咽。')
})

test('阿里百炼原生 generation 请求体与响应解析', async () => {
  const capture = createFetchCapture(() =>
    jsonResponse({
      output: { text: '你好，我是通义。', finish_reason: 'stop' },
      usage: { input_tokens: 5, output_tokens: 8 }
    })
  )
  const model = createCustomProtocolModel({
    adapter: dashscopeNativeAdapter,
    provider: 'dashscope',
    modelId: 'qwen-max',
    apiKey: 'dash-key',
    baseUrl: 'https://dashscope.aliyuncs.com',
    fetch: capture.fetch
  })
  const result = await model.doGenerate({ prompt: samplePrompt, maxOutputTokens: 200 })
  assert.match(capture.requests[0].url, /\/api\/v1\/services\/aigc\/text-generation\/generation$/)
  const body = JSON.parse(capture.requests[0].init.body)
  assert.equal(body.model, 'qwen-max')
  assert.equal(body.input.messages[0].role, 'user')
  assert.equal(body.input.messages[0].content, '你好')
  assert.equal(body.parameters.max_tokens, 200)
  assert.equal(result.content[0].text, '你好，我是通义。')
  assert.equal(result.usage.outputTokens, 8)
})

test('doStream 一次性下发整段文本', async () => {
  const capture = createFetchCapture(() =>
    jsonResponse({ output: { text: '流式内容' } })
  )
  const model = createCustomProtocolModel({
    adapter: dashscopeNativeAdapter,
    provider: 'dashscope',
    modelId: 'qwen-max',
    apiKey: 'k',
    baseUrl: 'https://dashscope.aliyuncs.com',
    fetch: capture.fetch
  })
  const streamResult = await model.doStream({ prompt: samplePrompt })
  let text = ''
  for await (const part of streamResult.stream) {
    if (part.type === 'text-delta') text += part.delta
  }
  assert.equal(text, '流式内容')
})
