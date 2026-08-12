/**
 * ConversationManager
 *
 * 会话 / Turn / Event 的 SQLite 持久化层。
 *
 * 四张新表（与旧 `assistant_sessions` 并存，Phase 3 迁移后合并）：
 *   - assistant_sessions_v2   会话元数据（surface / scope / title）
 *   - assistant_turns         一次用户输入 → 一次 agent loop 的顶层记录
 *   - assistant_events        Turn 内的流式事件 append-only 日志（支持刷新 replay）
 *   - assistant_staged_changes 统一变更暂存区（支持重启恢复待处理卡片）
 *   - assistant_turn_states   Planner / Evidence Ledger / 可续跑状态
 *
 * 所有事件（reasoning/chunk/tool_use/tool_result/staged_change/done…）都落到
 * assistant_events。断线/刷新后前端只需 `replayTurn(turnId)` 拉全量事件即可还原状态。
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type {
  AssistantSession,
  AssistantTurn,
  PersistedTurnEvent,
  SurfaceId,
  TurnEvent,
  TurnStatus
} from '@shared/assistant-runtime'

/**
 * 初始化 v2 三张表。幂等：若已存在则跳过。
 * 由 workspace-store.ts 的 ensureWorkspaceDb() 在 db 就绪后调用。
 */
export function initAssistantRuntimeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_sessions_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      scope_ref TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS assistant_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_message TEXT NOT NULL,
      assistant_message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES assistant_sessions_v2 (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS assistant_events (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (turn_id) REFERENCES assistant_turns (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS assistant_staged_changes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      tool_use_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      entity_title TEXT NOT NULL,
      reason TEXT NOT NULL,
      before_text TEXT NOT NULL,
      after_text TEXT NOT NULL,
      chapter_html_json TEXT NOT NULL DEFAULT '',
      entity_payload_json TEXT NOT NULL DEFAULT '',
      candidates_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES assistant_sessions_v2 (id) ON DELETE CASCADE,
      FOREIGN KEY (turn_id) REFERENCES assistant_turns (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS assistant_turn_states (
      turn_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      batch_index INTEGER NOT NULL DEFAULT 0,
      plan_json TEXT NOT NULL DEFAULT '{}',
      ledger_json TEXT NOT NULL DEFAULT '{}',
      resumable INTEGER NOT NULL DEFAULT 0,
      continuation_prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (turn_id) REFERENCES assistant_turns (id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES assistant_sessions_v2 (id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_assistant_sessions_v2_project
      ON assistant_sessions_v2 (project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assistant_turns_session
      ON assistant_turns (session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_events_turn_seq
      ON assistant_events (turn_id, seq);
    CREATE INDEX IF NOT EXISTS idx_assistant_staged_changes_session
      ON assistant_staged_changes (session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_staged_changes_turn
      ON assistant_staged_changes (turn_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_assistant_staged_changes_tool
      ON assistant_staged_changes (tool_use_id);
    CREATE INDEX IF NOT EXISTS idx_assistant_turn_states_session
      ON assistant_turn_states (session_id, updated_at DESC);
  `)
}

// ============================================================================
// 入参 / 出参
// ============================================================================

export interface CreateSessionInput {
  projectId: string
  surfaceId: SurfaceId
  scopeRef?: string
  title: string
}

export interface ListSessionsFilter {
  projectId: string
  surfaceId?: SurfaceId
  scopeRef?: string
  limit?: number
}

export interface CreateTurnInput {
  sessionId: string
  userMessage: string
}

export interface UpsertTurnStateInput {
  turnId: string
  sessionId: string
  phase: string
  batchIndex?: number
  planJson: string
  ledgerJson: string
  resumable: boolean
  continuationPrompt?: string
}

// ============================================================================
// 内部行类型
// ============================================================================

interface SessionRow {
  id: string
  project_id: string
  surface_id: string
  scope_ref: string
  title: string
  created_at: string
  updated_at: string
}

interface TurnRow {
  id: string
  session_id: string
  user_message: string
  assistant_message: string
  status: string
  created_at: string
}

interface EventRow {
  id: string
  turn_id: string
  seq: number
  kind: string
  payload_json: string
  created_at: string
}

function rowToSession(row: SessionRow): AssistantSession {
  return {
    id: row.id,
    projectId: row.project_id,
    surfaceId: row.surface_id as SurfaceId,
    scopeRef: row.scope_ref || undefined,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function rowToTurn(row: TurnRow): AssistantTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    userMessage: row.user_message,
    assistantMessage: row.assistant_message,
    status: row.status as TurnStatus,
    createdAt: row.created_at
  }
}

function rowToEvent(row: EventRow): PersistedTurnEvent {
  return {
    id: row.id,
    turnId: row.turn_id,
    seq: row.seq,
    kind: row.kind as TurnEvent['kind'],
    payloadJson: row.payload_json,
    createdAt: row.created_at
  }
}

// ============================================================================
// ConversationManager
// ============================================================================

/**
 * 会话/Turn/Event CRUD。构造时注入 DatabaseSync 引用，所有方法同步。
 * 上层 IPC handler 需先 `await ensureWorkspaceDb()` 拿到 db，再 `new ConversationManager(db)`。
 * seq 号在内存维护 next 计数，首次访问某 turn 时懒加载 max(seq)+1。
 */
export class ConversationManager {
  private readonly db: DatabaseSync
  private readonly nextSeqByTurn = new Map<string, number>()

  // 预编译语句缓存
  private readonly stmts: {
    insertSession: StatementSync
    updateSessionTitle: StatementSync
    touchSession: StatementSync
    getSession: StatementSync
    listSessionsByProject: StatementSync
    listSessionsByProjectSurface: StatementSync
    deleteSession: StatementSync
    insertTurn: StatementSync
    updateTurnStatus: StatementSync
    getTurn: StatementSync
    listTurnsBySession: StatementSync
    /** 删除某 turn 之后（含该 turn）的所有 turn，用于"回退到本轮对话之前"。 */
    getTurnOrder: StatementSync
    listTurnIdsFrom: StatementSync
    deleteTurnsFrom: StatementSync
    insertEvent: StatementSync
    listEventsByTurn: StatementSync
    maxSeqByTurn: StatementSync
    upsertTurnState: StatementSync
  }

  constructor(db: DatabaseSync) {
    this.db = db
    this.stmts = {
      insertSession: db.prepare(
        `INSERT INTO assistant_sessions_v2
         (id, project_id, surface_id, scope_ref, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ),
      updateSessionTitle: db.prepare(
        `UPDATE assistant_sessions_v2 SET title = ?, updated_at = ? WHERE id = ?`
      ),
      touchSession: db.prepare(
        `UPDATE assistant_sessions_v2 SET updated_at = ? WHERE id = ?`
      ),
      getSession: db.prepare(
        `SELECT * FROM assistant_sessions_v2 WHERE id = ?`
      ),
      listSessionsByProject: db.prepare(
        `SELECT * FROM assistant_sessions_v2
         WHERE project_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`
      ),
      listSessionsByProjectSurface: db.prepare(
        `SELECT * FROM assistant_sessions_v2
         WHERE project_id = ? AND surface_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`
      ),
      deleteSession: db.prepare(
        `DELETE FROM assistant_sessions_v2 WHERE id = ?`
      ),
      insertTurn: db.prepare(
        `INSERT INTO assistant_turns
         (id, session_id, user_message, assistant_message, status, created_at)
         VALUES (?, ?, ?, '', ?, ?)`
      ),
      updateTurnStatus: db.prepare(
        `UPDATE assistant_turns
         SET status = ?, assistant_message = ?
         WHERE id = ?`
      ),
      getTurn: db.prepare(
        `SELECT * FROM assistant_turns WHERE id = ?`
      ),
      listTurnsBySession: db.prepare(
        `SELECT * FROM assistant_turns WHERE session_id = ? ORDER BY rowid ASC`
      ),
      getTurnOrder: db.prepare(
        `SELECT rowid AS row_no, user_message
         FROM assistant_turns
         WHERE id = ? AND session_id = ?`
      ),
      listTurnIdsFrom: db.prepare(
        `SELECT id FROM assistant_turns
         WHERE session_id = ? AND rowid >= ?
         ORDER BY rowid ASC`
      ),
      deleteTurnsFrom: db.prepare(
        `DELETE FROM assistant_turns WHERE session_id = ? AND rowid >= ?`
      ),
      insertEvent: db.prepare(
        `INSERT INTO assistant_events
         (id, turn_id, seq, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ),
      listEventsByTurn: db.prepare(
        `SELECT * FROM assistant_events WHERE turn_id = ? ORDER BY seq ASC`
      ),
      maxSeqByTurn: db.prepare(
        `SELECT MAX(seq) AS max_seq FROM assistant_events WHERE turn_id = ?`
      ),
      upsertTurnState: db.prepare(
        `INSERT INTO assistant_turn_states
         (turn_id, session_id, phase, batch_index, plan_json, ledger_json, resumable, continuation_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(turn_id) DO UPDATE SET
           session_id = excluded.session_id,
           phase = excluded.phase,
           batch_index = excluded.batch_index,
           plan_json = excluded.plan_json,
           ledger_json = excluded.ledger_json,
           resumable = excluded.resumable,
           continuation_prompt = excluded.continuation_prompt,
           updated_at = excluded.updated_at`
      )
    }
  }

  // -------- Session --------

  createSession(input: CreateSessionInput): AssistantSession {
    const now = new Date().toISOString()
    const session: AssistantSession = {
      id: randomUUID(),
      projectId: input.projectId,
      surfaceId: input.surfaceId,
      scopeRef: input.scopeRef,
      title: input.title,
      createdAt: now,
      updatedAt: now
    }
    this.stmts.insertSession.run(
      session.id,
      session.projectId,
      session.surfaceId,
      session.scopeRef ?? '',
      session.title,
      session.createdAt,
      session.updatedAt
    )
    return session
  }

  renameSession(id: string, title: string): void {
    this.stmts.updateSessionTitle.run(title, new Date().toISOString(), id)
  }

  touchSession(id: string): void {
    this.stmts.touchSession.run(new Date().toISOString(), id)
  }

  getSession(id: string): AssistantSession | null {
    const row = this.stmts.getSession.get(id) as SessionRow | undefined
    return row ? rowToSession(row) : null
  }

  listSessions(filter: ListSessionsFilter): AssistantSession[] {
    const limit = filter.limit ?? 100
    const rows = filter.surfaceId
      ? (this.stmts.listSessionsByProjectSurface.all(
          filter.projectId,
          filter.surfaceId,
          limit
        ) as unknown as SessionRow[])
      : (this.stmts.listSessionsByProject.all(
          filter.projectId,
          limit
        ) as unknown as SessionRow[])
    const items = rows.map(rowToSession)
    if (filter.scopeRef) {
      return items.filter((s) => s.scopeRef === filter.scopeRef)
    }
    return items
  }

  deleteSession(id: string): void {
    // CASCADE 会自动删掉 turns / events
    this.stmts.deleteSession.run(id)
    // 清理 seq 缓存中所有与该 session 相关的 turnId
    // （无索引反查，简单起见直接扫内存缓存）
    // 数据量不大不需要优化
    for (const turnId of Array.from(this.nextSeqByTurn.keys())) {
      // 快速检查：若该 turn 已不存在于 db 就清掉
      const row = this.stmts.getTurn.get(turnId) as TurnRow | undefined
      if (!row) this.nextSeqByTurn.delete(turnId)
    }
  }

  /**
   * 从回收站恢复完整会话（含 turns / events）。
   * input 应来自 recycle bin 的 snapshot。若 sessionId 已存在则跳过。
   */
  restoreSession(input: {
    id?: string
    projectId: string
    surfaceId: SurfaceId
    scopeRef?: string
    title: string
    createdAt?: string
    updatedAt?: string
    turns?: Array<{
      id: string
      userMessage: string
      assistantMessage?: string
      status?: TurnStatus
      createdAt?: string
    }>
    events?: Array<{
      turnId: string
      seq: number
      kind: TurnEvent['kind']
      payloadJson: string
      createdAt?: string
    }>
  }): { ok: boolean; sessionId?: string; error?: string } {
    // 若传入 id 且该会话已存在，直接返回成功（幂等恢复）
    if (input.id && this.getSession(input.id)) {
      return { ok: true, sessionId: input.id }
    }
    // 否则使用传入 id 或生成新 id
    const sessionId = input.id || randomUUID()
    const now = new Date().toISOString()

    this.stmts.insertSession.run(
      sessionId,
      input.projectId,
      input.surfaceId,
      input.scopeRef ?? '',
      input.title,
      input.createdAt ?? now,
      input.updatedAt ?? now
    )

    for (const turn of input.turns ?? []) {
      const turnId = turn.id
      const status = turn.status ?? 'done'
      this.stmts.insertTurn.run(
        turnId,
        sessionId,
        turn.userMessage,
        turn.assistantMessage ?? '',
        status,
        turn.createdAt ?? now
      )
      // 恢复该 turn 的 events
      for (const ev of input.events?.filter((e) => e.turnId === turn.id) ?? []) {
        this.stmts.insertEvent.run(
          randomUUID(),
          turnId,
          ev.seq,
          ev.kind,
          ev.payloadJson,
          ev.createdAt ?? now
        )
      }
      // 更新 seq 缓存
      const maxSeq = input.events?.filter((e) => e.turnId === turn.id).reduce((max, e) => Math.max(max, e.seq), -1) ?? -1
      this.nextSeqByTurn.set(turnId, maxSeq + 1)
    }

    return { ok: true, sessionId }
  }

  // -------- Turn --------

  createTurn(input: CreateTurnInput): AssistantTurn {
    const now = new Date().toISOString()
    const turn: AssistantTurn = {
      id: randomUUID(),
      sessionId: input.sessionId,
      userMessage: input.userMessage,
      assistantMessage: '',
      status: 'streaming',
      createdAt: now
    }
    this.stmts.insertTurn.run(
      turn.id,
      turn.sessionId,
      turn.userMessage,
      turn.status,
      turn.createdAt
    )
    this.touchSession(turn.sessionId)
    this.nextSeqByTurn.set(turn.id, 0)
    return turn
  }

  updateTurnStatus(
    id: string,
    status: TurnStatus,
    assistantMessage: string = ''
  ): void {
    this.stmts.updateTurnStatus.run(status, assistantMessage, id)
    // 同步 session 时间戳
    const turn = this.getTurn(id)
    if (turn) this.touchSession(turn.sessionId)
  }

  getTurn(id: string): AssistantTurn | null {
    const row = this.stmts.getTurn.get(id) as TurnRow | undefined
    return row ? rowToTurn(row) : null
  }

  listTurns(sessionId: string): AssistantTurn[] {
    const rows = this.stmts.listTurnsBySession.all(sessionId) as unknown as TurnRow[]
    return rows.map(rowToTurn)
  }

  /**
   * 回退到某轮对话之前：删除该 turn 及其之后的所有 turn（及其事件、暂存变更）。
   * CASCADE 会自动级联清理关联的 events / staged_changes / turn_states。
   */
  deleteTurn(sessionId: string, turnId: string): void {
    const anchor = this.stmts.getTurnOrder.get(turnId, sessionId) as
      | { row_no: number }
      | undefined
    if (!anchor) return
    // CASCADE 会自动删掉关联的 events / staged_changes / turn_states
    this.stmts.deleteTurnsFrom.run(sessionId, anchor.row_no)
    // 清理 seq 缓存中已删除的 turnId
    for (const id of Array.from(this.nextSeqByTurn.keys())) {
      if (!this.getTurn(id)) this.nextSeqByTurn.delete(id)
    }
    this.touchSession(sessionId)
  }

  /** 删除指定轮次及其后的全部轮次。事件、暂存变更和运行状态由外键级联清理。 */
  truncateFrom(sessionId: string, fromTurnId: string): {
    removedTurnIds: string[]
    restoredUserMessage: string
  } {
    const anchor = this.stmts.getTurnOrder.get(fromTurnId, sessionId) as
      | { row_no: number; user_message: string }
      | undefined
    if (!anchor) throw new Error('找不到要撤回的对话轮次。')

    const rows = this.stmts.listTurnIdsFrom.all(sessionId, anchor.row_no) as unknown as Array<{ id: string }>
    const removedTurnIds = rows.map((row) => row.id)
    if (removedTurnIds.length === 0) throw new Error('没有可撤回的对话轮次。')

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.stmts.deleteTurnsFrom.run(sessionId, anchor.row_no)
      this.touchSession(sessionId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    for (const turnId of removedTurnIds) this.nextSeqByTurn.delete(turnId)
    return {
      removedTurnIds,
      restoredUserMessage: anchor.user_message
    }
  }

  // -------- Events --------

  /** 分配下一个 seq，惰性初始化。 */
  private allocSeq(turnId: string): number {
    let next = this.nextSeqByTurn.get(turnId)
    if (next === undefined) {
      const row = this.stmts.maxSeqByTurn.get(turnId) as
        | { max_seq: number | null }
        | undefined
      next = (row?.max_seq ?? -1) + 1
    }
    this.nextSeqByTurn.set(turnId, next + 1)
    return next
  }

  /**
   * 追加事件到 assistant_events。
   * 返回落盘后的记录（含分配的 seq/id/createdAt）。
   */
  appendEvent(turnId: string, event: TurnEvent): PersistedTurnEvent {
    const seq = this.allocSeq(turnId)
    const now = new Date().toISOString()
    // event 携带的 seq 是内部编号（如果调用方给了就以其为准，否则用 alloc 的）
    // 简单起见：alloc 分配的 seq 覆盖传入值，保证单调
    const persistedEvent = { ...event, seq }
    const record: PersistedTurnEvent = {
      id: randomUUID(),
      turnId,
      seq,
      kind: event.kind,
      payloadJson: JSON.stringify(persistedEvent),
      createdAt: now
    }
    this.stmts.insertEvent.run(
      record.id,
      record.turnId,
      record.seq,
      record.kind,
      record.payloadJson,
      record.createdAt
    )
    return record
  }

  /** 列出某 turn 的全部事件（按 seq 升序）。 */
  listEvents(turnId: string): PersistedTurnEvent[] {
    const rows = this.stmts.listEventsByTurn.all(turnId) as unknown as EventRow[]
    return rows.map(rowToEvent)
  }

  /**
   * 一次性 replay 某 turn 的完整状态：turn 元数据 + 全部事件。
   * 前端刷新/切换会话时用一次调用还原整个流式过程。
   */
  replayTurn(turnId: string): {
    turn: AssistantTurn | null
    events: PersistedTurnEvent[]
  } {
    return {
      turn: this.getTurn(turnId),
      events: this.listEvents(turnId)
    }
  }

  upsertTurnState(input: UpsertTurnStateInput): void {
    const now = new Date().toISOString()
    this.stmts.upsertTurnState.run(
      input.turnId,
      input.sessionId,
      input.phase,
      input.batchIndex ?? 0,
      input.planJson,
      input.ledgerJson,
      input.resumable ? 1 : 0,
      input.continuationPrompt ?? '',
      now,
      now
    )
  }
}
