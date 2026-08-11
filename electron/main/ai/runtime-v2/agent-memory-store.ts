/**
 * AgentMemoryStore · 智能体学习闭环（创作记忆）
 *
 * 对标 hermes-agent 的 "closed learning loop" 与 openclaw 的记忆层：
 * 让智能体不仅能"调用工具"，还能**跨会话记住用户的创作偏好、纠正与教训**，
 * 并在后续 turn 自动召回、注入上下文，从而"越用越懂这个项目"。
 *
 * 三类记忆来源：
 *   1. 用户纠正沉淀 —— 用户拒绝/修改某个暂存变更时，自动把"为什么不对、要怎么改"
 *      记成一条教训记忆（learning from correction）。
 *   2. 智能体自沉淀 —— 通过 memory_save 工具，在完成任务后主动把关键结论/偏好存档。
 *   3. 用户手写 —— 通过 IPC / UI 直接录入创作偏好。
 *
 * 召回策略：按 projectId 取相关记忆，按重要度/新鲜度排序，注入 system prompt。
 * 不依赖把全部历史对话塞进上下文（那正是 openclaw 强调的"每 call 都付费"的成本）。
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AgentMemory, AgentMemoryKind } from '@shared/assistant-runtime'

/**
 * 初始化 assistant_memories 表。幂等。
 */
export function initAgentMemoriesSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'preference',
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      importance INTEGER NOT NULL DEFAULT 3,
      source_turn_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_assistant_memories_project
      ON assistant_memories (project_id, importance DESC, updated_at DESC);
  `)
}

export interface MemoryInput {
  projectId: string
  kind: AgentMemoryKind
  content: string
  source?: 'user' | 'agent' | 'system'
  importance?: number
  sourceTurnId?: string
}

interface MemoryRow {
  id: string
  project_id: string
  kind: string
  content: string
  source: string
  importance: number
  source_turn_id: string
  created_at: string
  updated_at: string
}

function rowToMemory(row: MemoryRow): AgentMemory {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as AgentMemoryKind,
    content: row.content,
    source: row.source as 'user' | 'agent' | 'system',
    importance: row.importance,
    sourceTurnId: row.source_turn_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const MAX_MEMORY_CONTENT = 2000
const MAX_MEMORIES_PER_PROJECT = 200

/**
 * 创作记忆持久化层。每个 Runtime 一个单例（经 state.ts 共享）。
 */
export class AgentMemoryStore {
  private readonly stmts: {
    insert: StatementSync
    get: StatementSync
    list: StatementSync
    listByKind: StatementSync
    delete: StatementSync
    updateImportance: StatementSync
    countByProject: StatementSync
  }

  constructor(private readonly db: DatabaseSync) {
    this.stmts = {
      insert: db.prepare(
        `INSERT INTO assistant_memories
         (id, project_id, kind, content, source, importance, source_turn_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      get: db.prepare(`SELECT * FROM assistant_memories WHERE id = ?`),
      list: db.prepare(
        `SELECT * FROM assistant_memories
         WHERE project_id = ?
         ORDER BY importance DESC, updated_at DESC
         LIMIT ?`
      ),
      listByKind: db.prepare(
        `SELECT * FROM assistant_memories
         WHERE project_id = ? AND kind = ?
         ORDER BY importance DESC, updated_at DESC
         LIMIT ?`
      ),
      delete: db.prepare(`DELETE FROM assistant_memories WHERE id = ? AND project_id = ?`),
      updateImportance: db.prepare(
        `UPDATE assistant_memories
         SET importance = ?, updated_at = ? WHERE id = ? AND project_id = ?`
      ),
      countByProject: db.prepare(
        `SELECT COUNT(*) AS cnt FROM assistant_memories WHERE project_id = ?`
      )
    }
  }

  /** 新增一条记忆。超过单项目上限时丢弃最旧/最低重要度条目。 */
  create(input: MemoryInput): AgentMemory {
    const now = new Date().toISOString()
    const memory: AgentMemory = {
      id: randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      content: (input.content || '').slice(0, MAX_MEMORY_CONTENT).trim(),
      source: input.source ?? 'user',
      importance: Math.min(5, Math.max(1, input.importance ?? 3)),
      sourceTurnId: input.sourceTurnId || undefined,
      createdAt: now,
      updatedAt: now
    }
    this.stmts.insert.run(
      memory.id,
      memory.projectId,
      memory.kind,
      memory.content,
      memory.source,
      memory.importance,
      memory.sourceTurnId ?? '',
      memory.createdAt,
      memory.updatedAt
    )
    this.prune(memory.projectId)
    return memory
  }

  /** 超出上限时，删除项目内最不重要/最旧的一条，保持窗口稳定。 */
  private prune(projectId: string): void {
    const row = this.stmts.countByProject.get(projectId) as { cnt: number } | undefined
    if (!row || row.cnt <= MAX_MEMORIES_PER_PROJECT) return
    const all = this.list(projectId, MAX_MEMORIES_PER_PROJECT + 50)
    const excess = all.slice(MAX_MEMORIES_PER_PROJECT)
    for (const m of excess) {
      this.stmts.delete.run(m.id, projectId)
    }
  }

  get(id: string): AgentMemory | null {
    const row = this.stmts.get.get(id) as MemoryRow | undefined
    return row ? rowToMemory(row) : null
  }

  list(projectId: string, limit = 50): AgentMemory[] {
    const rows = this.stmts.list.all(projectId, limit) as unknown as MemoryRow[]
    return rows.map(rowToMemory)
  }

  listByKind(projectId: string, kind: AgentMemoryKind, limit = 50): AgentMemory[] {
    const rows = this.stmts.listByKind.all(projectId, kind, limit) as unknown as MemoryRow[]
    return rows.map(rowToMemory)
  }

  remove(id: string, projectId: string): boolean {
    const res = this.stmts.delete.run(id, projectId)
    return res.changes > 0
  }

  setImportance(id: string, projectId: string, importance: number): AgentMemory | null {
    this.stmts.updateImportance.run(
      Math.min(5, Math.max(1, importance)),
      new Date().toISOString(),
      id,
      projectId
    )
    return this.get(id)
  }
}

/** 把记忆格式化成可注入 system prompt 的 markdown 块。 */
export function formatMemoriesBlock(memories: AgentMemory[]): string {
  if (!memories.length) return ''
  const lines = memories.map((m, i) => {
    const tag = m.kind === 'lesson'
      ? '教训'
      : m.kind === 'preference'
      ? '偏好'
      : m.kind === 'fact'
      ? '事实'
      : '方法'
    const source = m.source === 'agent' ? '（智能体自沉淀）' : m.source === 'system' ? '（系统）' : ''
    return `${i + 1}. [${tag}${source}] ${m.content}`
  })
  return [
    '## 创作记忆（跨会话记住的偏好与教训）',
    '',
    '以下是本项目此前沉淀下来的创作偏好与教训，来自用户的纠正或智能体的总结。',
    '请在你的工作与修改中遵守这些约定，除非用户本次明确推翻。',
    ...lines
  ].join('\n')
}
