/**
 * Runtime v2 · 共享单例状态
 *
 * ConversationManager 是有状态的（预编译 statement + seq 缓存），
 * 全 Runtime 必须共用一个实例。放这里避免多方模块各自持一份。
 */

import type { DatabaseSync } from 'node:sqlite'
import { ConversationManager } from './conversation-manager'
import { stagedChangesStore } from './staged-changes-store'
import { AgentProfileStore } from './agent-profile-store'
import { AgentMemoryStore } from './agent-memory-store'

let sharedConversation: ConversationManager | null = null
let sharedAgentStore: AgentProfileStore | null = null
let sharedMemoryStore: AgentMemoryStore | null = null
let ensureDbFn: (() => Promise<DatabaseSync>) | null = null

/** bootstrap 阶段配置 db 获取器；ipc.ts 首次调用时用它建单例。 */
export function configureRuntimeState(ensureDb: () => Promise<DatabaseSync>): void {
  ensureDbFn = ensureDb
}

/** 惰性拿到 conversation 单例（首次调用会 ensure db）。 */
export async function getSharedConversation(): Promise<ConversationManager> {
  if (sharedConversation) return sharedConversation
  if (!ensureDbFn) throw new Error('Runtime state not configured; call configureRuntimeState first.')
  const db = await ensureDbFn()
  stagedChangesStore.configure(db)
  sharedConversation = new ConversationManager(db)
  if (!sharedAgentStore) {
    sharedAgentStore = new AgentProfileStore(db)
  }
  return sharedConversation
}

/** 惰性拿到 AgentProfileStore 单例。 */
export async function getSharedAgentStore(): Promise<AgentProfileStore> {
  if (sharedAgentStore) return sharedAgentStore
  if (!ensureDbFn) throw new Error('Runtime state not configured; call configureRuntimeState first.')
  const db = await ensureDbFn()
  stagedChangesStore.configure(db)
  sharedAgentStore = new AgentProfileStore(db)
  return sharedAgentStore
}

/**
 * 同步 peek：单例已就绪时返回，未就绪返回 null。
 * 用于同步上下文（如 committer.resolveProjectId）。
 * 只要有过任意一次 async 调用（例如 register 时的 SESSION_LIST），peek 就 ready。
 */
export function peekSharedConversation(): ConversationManager | null {
  return sharedConversation
}

/** 同步 peek AgentProfileStore。 */
export function peekSharedAgentStore(): AgentProfileStore | null {
  return sharedAgentStore
}

/** 惰性拿到 AgentMemoryStore 单例。 */
export async function getSharedMemoryStore(): Promise<AgentMemoryStore> {
  if (sharedMemoryStore) return sharedMemoryStore
  if (!ensureDbFn) throw new Error('Runtime state not configured; call configureRuntimeState first.')
  const db = await ensureDbFn()
  stagedChangesStore.configure(db)
  sharedMemoryStore = new AgentMemoryStore(db)
  return sharedMemoryStore
}

/** 同步 peek AgentMemoryStore。 */
export function peekSharedMemoryStore(): AgentMemoryStore | null {
  return sharedMemoryStore
}
