/**
 * memory-tools · 创作记忆工具（学习闭环的"智能体自沉淀"入口）
 *
 * 对标 hermes-agent：agent 在完成任务后，可以主动把关键结论、用户偏好、
 * 或值得记住的方法存成创作记忆，供后续 turn 自动召回。配合用户在暂存区
 * 拒绝变更时自动沉淀的"教训"记忆，构成完整的学习闭环。
 */

import type { AgentMemoryKind } from '@shared/assistant-runtime'
import type { Tool, ToolHandlerResult } from '../../agent/tools/types'
import type { AgentMemoryStore } from '../agent-memory-store'

export type MemoryToolFactoryOptions = {
  getStore: () => Promise<AgentMemoryStore>
  projectId: string
  turnId: string
}

const VALID_KINDS: AgentMemoryKind[] = ['preference', 'lesson', 'fact', 'method']

function ok(content: string): ToolHandlerResult {
  return { content }
}

function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

export function createMemoryTools(opts: MemoryToolFactoryOptions): Tool[] {
  const memorySave: Tool = {
    definition: {
      name: 'memory_save',
      description:
        '把一条值得长期记住的创作信息保存到项目的创作记忆库，供后续对话跨会话自动召回。适合保存：用户的明确偏好（如"主角要冷峻克制"）、本次任务总结出的方法（如"这类章节适合短句节奏"）、项目关键事实（如"第二卷主角已黑化"）。注意：不要用它保存临时性内容；它是长期记忆，滥用会污染后续判断。',
      inputSchema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            description: '记忆类型：preference（创作偏好）、lesson（教训）、fact（项目事实）、method（方法）。',
            enum: VALID_KINDS
          },
          content: {
            type: 'string',
            description: '要记住的内容，简洁、自包含、可独立理解。'
          },
          importance: {
            type: 'number',
            description: '重要度 1~5，越高越优先召回。默认 3。'
          }
        },
        required: ['content']
      }
    },
    handler: async (input): Promise<ToolHandlerResult> => {
      const content = String(input.content ?? '').trim()
      if (!content) return err('memory_save 缺少 content。')
      const kindRaw = String(input.kind ?? 'preference')
      const kind: AgentMemoryKind = (VALID_KINDS as string[]).includes(kindRaw)
        ? (kindRaw as AgentMemoryKind)
        : 'preference'
      const importanceRaw = Number(input.importance ?? 3)
      const importance = Number.isFinite(importanceRaw) ? Math.round(importanceRaw) : 3

      const store = await opts.getStore()
      const memory = store.create({
        projectId: opts.projectId,
        kind,
        content,
        source: 'agent',
        importance,
        sourceTurnId: opts.turnId
      })
      return ok(
        `已保存一条创作记忆（${kind}，重要度 ${memory.importance}）：${memory.content}\n` +
        '该记忆将在后续对话中自动召回。'
      )
    }
  }

  return [memorySave]
}
