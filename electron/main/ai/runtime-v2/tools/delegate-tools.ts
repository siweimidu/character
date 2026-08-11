/**
 * delegate-tools · 子智能体委派（并行化）
 *
 * 对标 hermes-agent 的 "delegates and parallelizes" 与 Trae work 的多智能体协作：
 * 当主智能体面对一个大而可拆的任务（批量审计多章、并行核对多个实体一致性、
 * 一次收集多份独立资料），可以把它拆成若干互不依赖的子任务，用本工具
 * 委派给隔离的子智能体并行执行。
 *
 * 子智能体在独立的窄上下文里跑一次精简模型调用（不带工具，只做"读 + 蒸馏"），
 * 返回一小段结构化结论。这样：
 *   - 主循环的上下文不膨胀（sub-agent 的中间过程不进入主上下文）；
 *   - 多个子任务可用 Promise.all 并行，整体延迟接近最慢的一个；
 *   - 主智能体拿到的是已蒸馏的高信噪比结论，而不是原始海量文本。
 */

import { streamText } from 'ai'
import type { AppSettings } from '../../shared-types'
import { createModel, buildSystemPrompt } from '../../provider'
import type { Tool, ToolHandlerResult } from '../../agent/tools/types'

export type DelegateToolFactoryOptions = {
  settings: AppSettings
  projectId: string
  /** 顶层核心 system prompt（用于继承角色与创作准则）。 */
  systemPrompt: string
  /** 并发上限，防止一次委派过多子任务。 */
  maxConcurrency?: number
}

const DEFAULT_MAX_CONCURRENCY = 3
const MAX_RESULT_CHARS = 2400

function ok(content: string): ToolHandlerResult {
  return { content }
}

function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

/**
 * 在窄上下文里跑一次"读 + 蒸馏"的子智能体调用。
 * 子智能体不带工具，只基于给定的资料块产出精炼结论。
 */
async function runSubAgent(
  opts: DelegateToolFactoryOptions,
  task: string,
  material: string,
  outputHint: string,
  signal: AbortSignal
): Promise<string> {
  const subPrompt = [
    '你是一个被主智能体委派的子智能体，负责处理以下子任务。',
    '你有且仅有一次机会输出结论，不能调用任何工具。',
    '请基于给定的资料，直接给出精炼、自包含、可直接被主智能体使用的结论。',
    '',
    `【子任务】${task}`,
    '',
    material ? `【参考资料】\n${material}` : '【参考资料】无，请基于你的知识回答，并明确说明这是推断而非资料结论。',
    '',
    `【输出要求】${outputHint || '300 字以内，分条列出关键结论。'}`,
    '',
    '只输出结论本身，不要复述任务，不要加寒暄。'
  ].join('\n')

  const result = await streamText({
    model: createModel(opts.settings),
    system: buildSystemPrompt(opts.settings, opts.systemPrompt),
    prompt: subPrompt,
    abortSignal: signal
  })

  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') text += part.text
    else if (part.type === 'error') throw part.error
  }
  if (!text) text = await result.text
  return text.slice(0, MAX_RESULT_CHARS)
}

export function createDelegateTools(opts: DelegateToolFactoryOptions): Tool[] {
  const delegateSubagent: Tool = {
    definition: {
      name: 'delegate_subagent',
      description:
        '把一个大而可拆的任务拆成若干互不依赖的子任务，委派给隔离的子智能体并行执行并返回精炼结论。适用于：批量审计多个章节/实体、并行核对多个设定点、一次收集多份独立资料。参数 tasks 传一组 {description, material}。当任务很大、主上下文放不下全部材料时，用本工具把粗加工交给子智能体，你只消费蒸馏后的结论。',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: '要并行执行的子任务列表。每个子任务：description 描述子任务目标，material 是传给该子任务的参考资料（精简关键片段即可）。',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', description: '子任务目标，自包含、可独立评估。' },
                material: { type: 'string', description: '该子任务需要的参考资料片段（可为空字符串）。' }
              },
              required: ['description']
            }
          },
          output_hint: {
            type: 'string',
            description: '对每个子任务输出的统一要求，例如"50字内给结论和依据"。'
          }
        },
        required: ['tasks']
      }
    },
    handler: async (input, ctx): Promise<ToolHandlerResult> => {
      const raw = input.tasks
      if (!Array.isArray(raw) || raw.length === 0) {
        return err('delegate_subagent 需要至少一个子任务。')
      }
      const tasks = raw
        .slice(0, DEFAULT_MAX_CONCURRENCY * 3)
        .map((t) => ({
          description: String((t as { description?: unknown }).description ?? '').trim(),
          material: String((t as { material?: unknown }).material ?? '').trim().slice(0, 6000)
        }))
        .filter((t) => t.description)
      if (tasks.length === 0) return err('delegate_subagent 子任务缺少 description。')

      const outputHint = String(input.output_hint ?? '').trim()
      const concurrency = Math.min(DEFAULT_MAX_CONCURRENCY, tasks.length)

      // 并发限流：分批执行，每批最多 concurrency 个并行子任务，避免一次性打爆请求量。
      const results: string[] = []
      for (let start = 0; start < tasks.length; start += concurrency) {
        const batch = tasks.slice(start, start + concurrency)
        const batchResults = await Promise.all(
          batch.map(async (task) => {
            const content = await runSubAgent(opts, task.description, task.material, outputHint, ctx.signal)
            return content
          })
        )
        batchResults.forEach((content, i) => {
          const task = batch[i]
          const index = start + i
          results.push(`### 子任务 ${index + 1}：${task.description}\n${content}`)
        })
      }

      return ok(
        [
          '子智能体并行执行完成，以下是蒸馏后的结论（未进入主上下文）：',
          '',
          ...results
        ].join('\n\n')
      )
    }
  }

  return [delegateSubagent]
}
