/**
 * memories · 创作记忆（学习闭环）召回
 *
 * 把本项目跨会话沉淀的创作偏好与教训注入 system prompt。
 * 这是 hermes-agent "closed learning loop" / openclaw 记忆层在弧光里的落地：
 * 智能体记得用户纠正过什么、偏好什么，进而在后续工作里主动遵守，
 * 而不是每次从零开始猜测。
 *
 * 召回量小、优先级高，几乎不会被预算裁剪；若被裁剪则提示模型如何查看。
 */

import type {
  ContextBuildRequest,
  ContextSlice
} from '@shared/assistant-runtime'
import type { ContextProvider } from '../context-builder'
import type { AgentMemoryStore } from '../agent-memory-store'
import { formatMemoriesBlock } from '../agent-memory-store'
import { makeSlice } from './shared'

const MAX_MEMORIES_INJECTED = 12

export function makeMemoriesProvider(
  getStore: () => Promise<AgentMemoryStore>
): ContextProvider {
  return {
    id: 'memories',
    priority: 95,
    truncationHint: '创作记忆较多，此处省略。若有与本次任务相关的偏好，可用 memory 相关通道查看。',
    isApplicable(surface) {
      // 项目级与章节级都注入；内联小助手保持轻量，不注入。
      return surface.scope !== 'selection'
    },
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const store = await getStore()
      const memories = store.list(request.projectId, MAX_MEMORIES_INJECTED)
      const body = formatMemoriesBlock(memories)
      if (!body) return null
      return makeSlice('memories', 95, '创作记忆', body)
    }
  }
}
