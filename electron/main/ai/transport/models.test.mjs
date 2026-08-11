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

test('本地中转网关（LiteLLM/OmniRouter/FreeLLMAPI）默认地址生成 /v1/models', () => {
  const litellm = buildModelsUrlCandidates('http://localhost:4000/v1')
  assert.ok(litellm.includes('http://localhost:4000/v1/models'))
  // OmniRouter 默认端口 20128，baseURL 为 /v1/models，归一化后仍能探测 /v1/models
  const omniRouter = buildModelsUrlCandidates('http://localhost:20128/v1/models')
  assert.ok(omniRouter.includes('http://localhost:20128/v1/models'))
  // FreeLLMAPI 默认端口 3001
  const freeLlm = buildModelsUrlCandidates('http://localhost:3001/v1')
  assert.ok(freeLlm.includes('http://localhost:3001/v1/models'))
})

test('自带 /models 端点的地址仍能正确探测自身与根 /v1/models', () => {
  const candidates = buildModelsUrlCandidates('http://localhost:20128/v1/models')
  // stripKnownEndpointSuffix 会剥离 /models，再补回 /v1/models，因此自身候选仍在
  assert.ok(candidates.includes('http://localhost:20128/v1/models'))
  // 去重无重复
  assert.equal(new Set(candidates).size, candidates.length)
})

test('带完整 chat/completions 端点的中转地址能剥离出 /v1/models', () => {
  const candidates = buildModelsUrlCandidates('https://relay.example.com/api/v1/chat/completions')
  assert.ok(candidates.includes('https://relay.example.com/api/v1/models'))
  const rootCandidates = buildModelsUrlCandidates('https://relay.example.com/v1/chat/completions')
  assert.ok(rootCandidates.includes('https://relay.example.com/v1/models'))
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
