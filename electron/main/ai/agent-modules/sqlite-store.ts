/**
 * SqliteModuleStore · 全局智能体能力模块的持久化存储（SQLite 版）
 *
 * 能力模块的启停开关、配置、使用统计持久化到 SQLite 的 agent_module_states 表，
 * 应用重启后开关状态依然保留（跨会话持久），满足用户「能力模块打开后要一直保持
 * 打开」的诉求。
 *
 * 表结构：
 *  - module_id：模块唯一 id（主键）
 *  - enabled：是否启用（0/1）
 *  - config_json：模块私有配置（JSON）
 *  - last_used_at：最近一次触发时间（ISO 字符串）
 *  - usage_count：累计触发次数
 */

import type { DatabaseSync } from 'node:sqlite'
import type { AgentModuleStore } from './registry'

/** 初始化 agent_module_states 表。幂等。 */
export function initAgentModuleStatesSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_module_states (
      module_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      last_used_at TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `)
}

/** 基于 SQLite 的模块启停状态存储。 */
export class SqliteModuleStore implements AgentModuleStore {
  private db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
    initAgentModuleStatesSchema(db)
  }

  getEnabled(id: string): boolean | undefined {
    const row = this.db
      .prepare(`SELECT enabled FROM agent_module_states WHERE module_id = ?`)
      .get(id) as { enabled: number } | undefined
    if (!row) return undefined
    return row.enabled === 1
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare(
        `INSERT INTO agent_module_states (module_id, enabled, config_json, last_used_at, usage_count)
         VALUES (?, ?, '{}', NULL, 0)
         ON CONFLICT(module_id) DO UPDATE SET enabled = excluded.enabled`
      )
      .run(id, enabled ? 1 : 0)
  }

  getConfig(id: string): Record<string, unknown> | undefined {
    const row = this.db
      .prepare(`SELECT config_json FROM agent_module_states WHERE module_id = ?`)
      .get(id) as { config_json?: string } | undefined
    if (!row?.config_json) return undefined
    try {
      const parsed = JSON.parse(row.config_json) as Record<string, unknown>
      return parsed && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  }

  setConfig(id: string, config: Record<string, unknown>): void {
    const serialized = JSON.stringify(config ?? {})
    const existing = this.db
      .prepare(`SELECT module_id FROM agent_module_states WHERE module_id = ?`)
      .get(id)
    if (existing) {
      this.db
        .prepare(`UPDATE agent_module_states SET config_json = ? WHERE module_id = ?`)
        .run(serialized, id)
    } else {
      this.db
        .prepare(
          `INSERT INTO agent_module_states (module_id, enabled, config_json, last_used_at, usage_count)
           VALUES (?, 0, ?, NULL, 0)`
        )
        .run(id, serialized)
    }
  }

  touch(id: string): void {
    this.db
      .prepare(
        `INSERT INTO agent_module_states (module_id, enabled, config_json, last_used_at, usage_count)
         VALUES (?, 0, '{}', ?, 1)
         ON CONFLICT(module_id) DO UPDATE SET
           last_used_at = excluded.last_used_at,
           usage_count = usage_count + 1`
      )
      .run(id, new Date().toISOString())
  }

  lastUsedAt(id: string): string | undefined {
    const row = this.db
      .prepare(`SELECT last_used_at FROM agent_module_states WHERE module_id = ?`)
      .get(id) as { last_used_at?: string } | undefined
    return row?.last_used_at ?? undefined
  }

  usageCount(id: string): number {
    const row = this.db
      .prepare(`SELECT usage_count FROM agent_module_states WHERE module_id = ?`)
      .get(id) as { usage_count?: number } | undefined
    return row?.usage_count ?? 0
  }
}

/**
 * 惰性 SQLite 模块存储。
 *
 * AgentModuleRegistry 在应用启动早期（SQLite 尚未就绪）同步创建，因此这里先用
 * 内存 Map 承接所有启停读写，保证注册中心始终可同步工作；当 SQLite 可用时再
 * attach()，把持久化的启停状态合并进内存，并把后续每次写入实时落库。
 *
 * 合并规则：若某模块在 attach 前已被本地修改（dirty），以本地值为准并回写库；
 * 否则以库中持久化的值为准（实现「重启后仍保持上次开关状态」）。
 */
export class LazySqliteModuleStore implements AgentModuleStore {
  private sqlite: SqliteModuleStore | null = null
  private memory: Map<string, boolean> = new Map()
  private configs: Map<string, Record<string, unknown>> = new Map()
  private lastUsed = new Map<string, number>()
  private usage = new Map<string, number>()
  /** attach 前被本地写过的 id，回填时以本地为准。 */
  private dirty = new Set<string>()

  /** 挂载 SQLite，合并持久化状态并开启实时落库。 */
  attach(db: DatabaseSync): void {
    this.sqlite = new SqliteModuleStore(db)
    // 读取全部已持久化的模块状态
    const rows = db
      .prepare(`SELECT module_id, enabled, config_json, last_used_at, usage_count FROM agent_module_states`)
      .all() as Array<{
      module_id: string
      enabled: number
      config_json: string
      last_used_at: string | null
      usage_count: number
    }>
    for (const row of rows) {
      if (this.dirty.has(row.module_id)) {
        // 本地已有修改，以本地为准并回写
        this.sqlite.setEnabled(row.module_id, this.memory.get(row.module_id) ?? row.enabled === 1)
      } else {
        this.memory.set(row.module_id, row.enabled === 1)
      }
      // 使用统计/最近使用以库为准（这些很少在 attach 前发生）
      this.lastUsed.set(
        row.module_id,
        row.last_used_at ? new Date(row.last_used_at).getTime() : 0
      )
      this.usage.set(row.module_id, row.usage_count)
      if (!this.configs.has(row.module_id)) {
        try {
          const parsed = JSON.parse(row.config_json || '{}') as Record<string, unknown>
          if (parsed && typeof parsed === 'object') this.configs.set(row.module_id, parsed)
        } catch {
          /* ignore */
        }
      }
    }
    // attach 前仅在内存改动、尚未落库的模块，一并回写 SQLite，避免丢失
    for (const id of this.dirty) {
      if (this.memory.has(id)) this.sqlite.setEnabled(id, this.memory.get(id) ?? false)
      if (this.configs.has(id)) this.sqlite.setConfig(id, this.configs.get(id) ?? {})
    }
  }

  getEnabled(id: string): boolean | undefined {
    return this.memory.has(id) ? this.memory.get(id) : this.sqlite?.getEnabled(id)
  }

  setEnabled(id: string, enabled: boolean): void {
    this.memory.set(id, enabled)
    this.dirty.add(id)
    this.sqlite?.setEnabled(id, enabled)
  }

  getConfig(id: string): Record<string, unknown> | undefined {
    if (this.configs.has(id)) return this.configs.get(id)
    return this.sqlite?.getConfig(id)
  }

  setConfig(id: string, config: Record<string, unknown>): void {
    this.configs.set(id, { ...config })
    this.dirty.add(id)
    this.sqlite?.setConfig(id, config)
  }

  touch(id: string): void {
    this.lastUsed.set(id, Date.now())
    this.usage.set(id, (this.usage.get(id) ?? 0) + 1)
    this.sqlite?.touch(id)
  }

  lastUsedAt(id: string): string | undefined {
    const t = this.lastUsed.get(id)
    if (t) return new Date(t).toISOString()
    return this.sqlite?.lastUsedAt(id)
  }

  usageCount(id: string): number {
    const c = this.usage.get(id)
    if (c !== undefined) return c
    return this.sqlite?.usageCount(id) ?? 0
  }
}
