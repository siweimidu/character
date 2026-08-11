import { generateText } from 'ai'
import type { AppSettings } from '../shared-types'
import { normalizeSettings } from '../settings'
import { createModel, buildSystemPrompt } from '../provider'
import { createProxyFetch } from '../proxy-fetch'

/** 模型基准测试的结果 */
export interface ModelBenchmarkResult {
  /** 完整请求往返延迟（毫秒），从发出请求到收到完整响应 */
  latencyMs: number
  /** 每秒输出 token 数 */
  tokensPerSec: number
  /** 本次测试输出 token 数 */
  completionTokens: number
  /** 本次测试输入 token 数 */
  promptTokens: number
}

/** 延迟探测使用的最小提示词，确保各模型都能快速返回 */
const LATENCY_PROBE_PROMPT = 'Reply with the single word: OK'

/** 测速提示词，要求输出足够多的 token 以便统计速率 */
const SPEED_PROBE_PROMPT =
  'Write a short paragraph of about 80 to 120 Chinese characters describing a calm morning by the lake. Reply with only the paragraph.'

/** 单次测速请求的超时时间（毫秒） */
const BENCHMARK_TIMEOUT_MS = 60_000

/** 统计 latency 前放弃输入侧 token 估算，只保留 completion 侧速率，避免模型返回差异干扰 */
function measureTiming(ms: number): number {
  return Math.max(0, ms)
}

/**
 * 对当前配置的模型执行一次基准测试：测延迟（毫秒）与测速（每秒 token）。
 *
 * 延迟：发送一条最小探测请求，测量从发出到完整返回的往返耗时。
 * 测速：发送一条短文生成请求，用返回的 completionTokens 除以耗时得到每秒 token 数。
 *
 * @param rawSettings - 待测试的模型配置
 * @returns 延迟与测速结果
 */
export async function benchmarkModel(rawSettings: AppSettings): Promise<ModelBenchmarkResult> {
  const settings = normalizeSettings(rawSettings)
  if (!settings.model.trim()) {
    throw new Error('请先填写模型名称后再进行性能测试。')
  }
  if (!settings.baseUrl.trim()) {
    throw new Error('请先填写 Base URL 后再进行性能测试。')
  }

  const requestFetch = createProxyFetch(settings.proxyUrl)

  // 1) 测延迟：最小探测请求，测量往返耗时
  const latencyStart = performance.now()
  await generateText({
    model: createModel(settings, { requestFetch }),
    system: buildSystemPrompt(settings, 'You are a latency probe.'),
    prompt: LATENCY_PROBE_PROMPT,
    abortSignal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS)
  })
  const latencyMs = measureTiming(performance.now() - latencyStart)

  // 2) 测速：短文生成请求，统计输出 token 与耗时
  const speedStart = performance.now()
  const speedResult = await generateText({
    model: createModel(settings, { requestFetch }),
    system: buildSystemPrompt(settings, 'You are a writing assistant.'),
    prompt: SPEED_PROBE_PROMPT,
    abortSignal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS)
  })
  const speedElapsedMs = measureTiming(performance.now() - speedStart)

  const completionTokens = Number.isFinite(speedResult.usage?.outputTokens) ? (speedResult.usage?.outputTokens ?? 0) : 0
  const promptTokens = Number.isFinite(speedResult.usage?.inputTokens) ? (speedResult.usage?.inputTokens ?? 0) : 0

  const seconds = speedElapsedMs / 1000
  const tokensPerSec = seconds > 0 ? completionTokens / seconds : 0

  return {
    latencyMs,
    tokensPerSec,
    completionTokens,
    promptTokens
  }
}
