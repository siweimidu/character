import assert from 'node:assert/strict'
import test from 'node:test'

import { buildModelsUrlCandidates } from './model-urls.ts'

test('OpenAI 官方地址生成 /v1/models 候选', () => {
  const candidates = buildModelsUrlCandidates('https://api.openai.com/v1')
  assert.ok(candidates.includes('https://api.openai.com/v1/models'))
})

test('Google Gemini OpenAI 兼容入口会探测 /openai/models 与 /v1beta/models', () => {
  const candidates = buildModelsUrlCandidates(
    'https://generativelanguage.googleapis.com/v1beta/openai'
  )
  // 官方真实模型列表端点
  assert.ok(candidates.includes('https://generativelanguage.googleapis.com/v1beta/openai/models'))
  assert.ok(candidates.includes('https://generativelanguage.googleapis.com/v1beta/models'))
})

test('本地中转网关（LiteLLM/OmniRoute/FreeLLMAPI）默认 /v1 地址生成 /v1/models', () => {
  const litellm = buildModelsUrlCandidates('http://localhost:4000/v1')
  assert.ok(litellm.includes('http://localhost:4000/v1/models'))
  const omniroute = buildModelsUrlCandidates('http://localhost:3000/v1')
  assert.ok(omniroute.includes('http://localhost:3000/v1/models'))
  const freeLlm = buildModelsUrlCandidates('http://localhost:8080/v1')
  assert.ok(freeLlm.includes('http://localhost:8080/v1/models'))
})

test('自定义无版本段地址会同时尝试 /v1/models 与 /models', () => {
  const candidates = buildModelsUrlCandidates('https://example.com')
  assert.ok(candidates.includes('https://example.com/v1/models'))
  assert.ok(candidates.includes('https://example.com/models'))
})

test('去重后候选列表无重复项', () => {
  const candidates = buildModelsUrlCandidates('https://api.deepseek.com/v1')
  assert.equal(new Set(candidates).size, candidates.length)
})
