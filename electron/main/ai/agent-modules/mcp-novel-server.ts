/**
 * McpNovelServer · 小说项目 MCP 工具集
 *
 * 将小说编辑器项目资源（章节、人物卡、伏笔、世界观、大纲）以 MCP 工具形式
 * 暴露给智能体调用。规则：
 *   1. 凡读取/修改项目资源必须通过 MCP 工具，严禁凭空编造文件内容。
 *   2. 修改前读取原有上下文，保证设定统一。
 *   3. 重大覆盖、批量删除操作需用户确认。
 *
 * 该项目 MCP 服务器提供以下 MCP 命名空间工具：
 *   novel_read_chapter      — 读取章节正文
 *   novel_write_chapter     — 写入章节正文（需先读取上下文）
 *   novel_list_chapters     — 列出章节
 *   novel_read_character    — 读取人物卡
 *   novel_write_character   — 写入人物卡
 *   novel_list_characters   — 列出人物
 *   novel_read_foreshadow   — 读取伏笔
 *   novel_write_foreshadow  — 写入伏笔
 *   novel_read_world        — 读取世界观
 *   novel_write_world       — 写入世界观
 *   novel_read_outline      — 读取大纲
 *   novel_write_outline     — 写入大纲
 */

import type { Tool, ToolHandlerResult, ToolContext } from '../agent/tools/types'
import { ensureWorkspaceDb } from '../../workspace-store'
import type { DatabaseSync } from 'node:sqlite'

type WorkspaceDb = DatabaseSync

// ============================================================================
// 项目资源访问接口（由宿主注入）
// ============================================================================

/** 项目资源访问器：实际由执行计划注入，包装 SQLite 项目数据。 */
export interface NovelProjectAccessor {
  /** 读取章节列表。 */
  listChapters: (projectId: string) => Promise<Array<{
    id: string
    title: string
    volumeTitle?: string
    status?: string
    wordCount?: number
  }>>
  /** 读取章节正文。 */
  readChapter: (projectId: string, chapterId: string) => Promise<{
    id: string
    title: string
    content: string
    outlineItemId?: string
  }>
  /** 写入章节正文。 */
  writeChapter: (projectId: string, chapterId: string, content: string) => Promise<{ ok: boolean }>
  /** 读取人物列表。 */
  listCharacters: (projectId: string) => Promise<Array<{ id: string; name: string; role?: string }>>
  /** 读取人物卡。 */
  readCharacter: (projectId: string, characterId: string) => Promise<{
    id: string
    name: string
    role?: string
    description?: string
    tags?: string[]
  }>
  /** 写入人物卡。 */
  writeCharacter: (
    projectId: string,
    characterId: string,
    data: Record<string, unknown>
  ) => Promise<{ ok: boolean }>
  /** 读取伏笔列表。 */
  listForeshadows: (projectId: string) => Promise<Array<{ id: string; title: string; status?: string }>>
  /** 读取伏笔详情。 */
  readForeshadow: (projectId: string, id: string) => Promise<Record<string, unknown>>
  /** 写入伏笔。 */
  writeForeshadow: (projectId: string, id: string, data: Record<string, unknown>) => Promise<{ ok: boolean }>
  /** 读取世界观条目。 */
  listWorldSettings: (projectId: string) => Promise<Array<{ id: string; title: string; type?: string }>>
  /** 读取世界观详情。 */
  readWorldSetting: (projectId: string, id: string) => Promise<Record<string, unknown>>
  /** 写入世界观条目。 */
  writeWorldSetting: (projectId: string, id: string, data: Record<string, unknown>) => Promise<{ ok: boolean }>
  /** 读取大纲节点列表。 */
  listOutline: (projectId: string) => Promise<Array<{ id: string; title: string; volumeTitle?: string }>>
  /** 读取大纲节点详情。 */
  readOutlineItem: (projectId: string, id: string) => Promise<Record<string, unknown>>
  /** 写入大纲节点。 */
  writeOutlineItem: (projectId: string, id: string, data: Record<string, unknown>) => Promise<{ ok: boolean }>
}

// ============================================================================
// SQLite 版项目访问器（读取 workspace.db 中的真实项目数据）
// ============================================================================

/**
 * 基于 SQLite 的项目访问器。
 * 读取 workspace.db 中当前项目（或指定项目）的章节、人物、世界观、大纲数据。
 */
export class SqliteNovelAccessor implements NovelProjectAccessor {
  private dbPromise: Promise<WorkspaceDb> | null = null

  private getDb(): Promise<WorkspaceDb> {
    if (!this.dbPromise) {
      this.dbPromise = ensureWorkspaceDb()
    }
    return this.dbPromise
  }

  async listChapters(projectId: string) {
    const db = await this.getDb()
    const rows = db.prepare(
      `SELECT id, title, status, word_target FROM chapters WHERE project_id = ? ORDER BY sort_order`
    ).all(projectId) as Array<{
      id: string; title: string; status: string; word_target: string
    }>
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      wordCount: Number.parseInt(r.word_target, 10) || 0
    }))
  }

  async readChapter(projectId: string, chapterId: string) {
    const db = await this.getDb()
    const row = db.prepare(
      `SELECT id, title, content FROM chapters WHERE project_id = ? AND id = ?`
    ).get(projectId, chapterId) as { id: string; title: string; content: string } | undefined
    if (!row) throw new Error(`章节 ${chapterId} 不存在。`)
    return { id: row.id, title: row.title, content: row.content }
  }

  async writeChapter(projectId: string, chapterId: string, content: string) {
    const db = await this.getDb()
    const result = db.prepare(
      `UPDATE chapters SET content = ? WHERE project_id = ? AND id = ?`
    ).run(content, projectId, chapterId)
    if (result.changes === 0) throw new Error(`章节 ${chapterId} 不存在。`)
    return { ok: true }
  }

  async listCharacters(projectId: string) {
    const db = await this.getDb()
    const rows = db.prepare(
      `SELECT id, name, role FROM characters WHERE project_id = ? ORDER BY rowid`
    ).all(projectId) as Array<{ id: string; name: string; role: string }>
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.role || undefined }))
  }

  async readCharacter(projectId: string, characterId: string) {
    const db = await this.getDb()
    const row = db.prepare(
      `SELECT id, name, role, description, tags_json FROM characters WHERE project_id = ? AND id = ?`
    ).get(projectId, characterId) as {
      id: string; name: string; role: string; description: string; tags_json: string
    } | undefined
    if (!row) throw new Error(`人物卡 ${characterId} 不存在。`)
    let tags: string[] = []
    try { tags = JSON.parse(row.tags_json) as string[] } catch { /* ignore */ }
    return {
      id: row.id,
      name: row.name,
      role: row.role || undefined,
      description: row.description || undefined,
      tags
    }
  }

  async writeCharacter(projectId: string, characterId: string, data: Record<string, unknown>) {
    const db = await this.getDb()
    const current = await this.readCharacter(projectId, characterId).catch(() => null)
    if (!current) throw new Error(`人物卡 ${characterId} 不存在。`)

    const name = String(data.name ?? current.name)
    const role = String(data.role ?? current.role ?? '')
    const description = String(data.description ?? current.description ?? '')
    const tags = (data.tags as string[]) ?? current.tags

    db.prepare(
      `UPDATE characters SET name = ?, role = ?, description = ?, tags_json = ? WHERE project_id = ? AND id = ?`
    ).run(name, role, description, JSON.stringify(tags), projectId, characterId)
    return { ok: true }
  }

  async listForeshadows(projectId: string) {
    // 伏笔存储在 plot_threads 表中（type='foreshadow' 或类似）
    const db = await this.getDb()
    const rows = db.prepare(
      `SELECT id, title, type FROM plot_threads WHERE project_id = ? ORDER BY rowid`
    ).all(projectId) as Array<{ id: string; title: string; type: string }>
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.type || 'open'
    }))
  }

  async readForeshadow(projectId: string, id: string) {
    const db = await this.getDb()
    const row = db.prepare(
      `SELECT * FROM plot_threads WHERE project_id = ? AND id = ?`
    ).get(projectId, id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`伏笔 ${id} 不存在。`)
    return row
  }

  async writeForeshadow(projectId: string, id: string, data: Record<string, unknown>) {
    const db = await this.getDb()
    const current = await this.readForeshadow(projectId, id).catch(() => null)
    if (!current) throw new Error(`伏笔 ${id} 不存在。`)

    const title = String(data.title ?? current.title ?? '')
    const type = String(data.status ?? current.type ?? 'foreshadow')
    const content = String(data.content ?? current.content ?? '')

    db.prepare(
      `UPDATE plot_threads SET title = ?, type = ?, content = ? WHERE project_id = ? AND id = ?`
    ).run(title, type, content, projectId, id)
    return { ok: true }
  }

  async listWorldSettings(projectId: string) {
    const db = await this.getDb()
    const rows = db.prepare(
      `SELECT id, title, type FROM worldview_entries WHERE project_id = ? ORDER BY sort_order`
    ).all(projectId) as Array<{ id: string; title: string; type: string }>
    return rows.map((r) => ({ id: r.id, title: r.title, type: r.type }))
  }

  async readWorldSetting(projectId: string, id: string) {
    const db = await this.getDb()
    const row = db.prepare(
      `SELECT * FROM worldview_entries WHERE project_id = ? AND id = ?`
    ).get(projectId, id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`世界观条目 ${id} 不存在。`)
    return row
  }

  async writeWorldSetting(projectId: string, id: string, data: Record<string, unknown>) {
    const db = await this.getDb()
    const current = await this.readWorldSetting(projectId, id).catch(() => null)
    if (!current) throw new Error(`世界观条目 ${id} 不存在。`)

    const title = String(data.title ?? current.title ?? '')
    const type = String(data.type ?? current.type ?? '')
    const content = String(data.content ?? current.content ?? '')

    db.prepare(
      `UPDATE worldview_entries SET title = ?, type = ?, content = ? WHERE project_id = ? AND id = ?`
    ).run(title, type, content, projectId, id)
    return { ok: true }
  }

  async listOutline(projectId: string) {
    const db = await this.getDb()
    const rows = db.prepare(
      `SELECT oi.id, oi.title, ov.title AS volume_title FROM outline_items oi
       LEFT JOIN outline_volumes ov ON oi.volume_id = ov.id
       WHERE oi.project_id = ? ORDER BY oi.sort_order`
    ).all(projectId) as Array<{ id: string; title: string; volume_title: string | null }>
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      volumeTitle: r.volume_title ?? undefined
    }))
  }

  async readOutlineItem(projectId: string, id: string) {
    const db = await this.getDb()
    const row = db.prepare(
      `SELECT * FROM outline_items WHERE project_id = ? AND id = ?`
    ).get(projectId, id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`大纲节点 ${id} 不存在。`)
    return row
  }

  async writeOutlineItem(projectId: string, id: string, data: Record<string, unknown>) {
    const db = await this.getDb()
    const current = await this.readOutlineItem(projectId, id).catch(() => null)
    if (!current) throw new Error(`大纲节点 ${id} 不存在。`)

    const title = String(data.title ?? current.title ?? '')
    const summary = String(data.summary ?? current.summary ?? '')
    const conflict = String(data.conflict ?? current.conflict ?? '')

    db.prepare(
      `UPDATE outline_items SET title = ?, summary = ?, conflict = ? WHERE project_id = ? AND id = ?`
    ).run(title, summary, conflict, projectId, id)
    return { ok: true }
  }
}

// ============================================================================
// 默认内存实现（无宿主注入时的回退）
// ============================================================================

/** 内存版访问器：用于开发/测试，不持久化。 */
class InMemoryNovelAccessor implements NovelProjectAccessor {
  private data: Record<string, Record<string, unknown>> = {}

  private getBucket(projectId: string, type: string): Record<string, unknown> {
    const key = `${projectId}:${type}`
    if (!this.data[key]) this.data[key] = {}
    return this.data[key]
  }

  async listChapters(projectId: string) {
    const bucket = this.getBucket(projectId, 'chapters')
    return Object.entries(bucket).map(([id, v]) => ({
      id,
      title: String((v as Record<string, unknown>).title ?? id),
      status: String((v as Record<string, unknown>).status ?? 'draft')
    }))
  }

  async readChapter(projectId: string, chapterId: string) {
    const bucket = this.getBucket(projectId, 'chapters')
    const item = bucket[chapterId] as Record<string, unknown>
    if (!item) throw new Error(`章节 ${chapterId} 不存在。`)
    return {
      id: chapterId,
      title: String(item.title ?? chapterId),
      content: String(item.content ?? '')
    }
  }

  async writeChapter(projectId: string, chapterId: string, content: string) {
    const bucket = this.getBucket(projectId, 'chapters')
    const item = (bucket[chapterId] as Record<string, unknown>) ?? {}
    bucket[chapterId] = { ...item, content, updatedAt: new Date().toISOString() }
    return { ok: true }
  }

  async listCharacters(projectId: string) {
    const bucket = this.getBucket(projectId, 'characters')
    return Object.entries(bucket).map(([id, v]) => ({
      id,
      name: String((v as Record<string, unknown>).name ?? id),
      role: String((v as Record<string, unknown>).role ?? '')
    }))
  }

  async readCharacter(projectId: string, characterId: string) {
    const bucket = this.getBucket(projectId, 'characters')
    const item = bucket[characterId] as Record<string, unknown>
    if (!item) throw new Error(`人物卡 ${characterId} 不存在。`)
    return {
      id: characterId,
      name: String(item.name ?? characterId),
      role: item.role as string | undefined,
      description: item.description as string | undefined,
      tags: (item.tags as string[]) ?? []
    }
  }

  async writeCharacter(projectId: string, characterId: string, data: Record<string, unknown>) {
    const bucket = this.getBucket(projectId, 'characters')
    const item = (bucket[characterId] as Record<string, unknown>) ?? {}
    bucket[characterId] = { ...item, ...data, updatedAt: new Date().toISOString() }
    return { ok: true }
  }

  async listForeshadows(projectId: string) {
    const bucket = this.getBucket(projectId, 'foreshadowing')
    return Object.entries(bucket).map(([id, v]) => ({
      id,
      title: String((v as Record<string, unknown>).title ?? id),
      status: String((v as Record<string, unknown>).status ?? 'open')
    }))
  }

  async readForeshadow(projectId: string, id: string) {
    const bucket = this.getBucket(projectId, 'foreshadowing')
    const item = bucket[id]
    if (!item) throw new Error(`伏笔 ${id} 不存在。`)
    return item as Record<string, unknown>
  }

  async writeForeshadow(projectId: string, id: string, data: Record<string, unknown>) {
    const bucket = this.getBucket(projectId, 'foreshadowing')
    const item = (bucket[id] as Record<string, unknown>) ?? {}
    bucket[id] = { ...item, ...data, updatedAt: new Date().toISOString() }
    return { ok: true }
  }

  async listWorldSettings(projectId: string) {
    const bucket = this.getBucket(projectId, 'world_setting')
    return Object.entries(bucket).map(([id, v]) => ({
      id,
      title: String((v as Record<string, unknown>).title ?? id),
      type: String((v as Record<string, unknown>).type ?? '')
    }))
  }

  async readWorldSetting(projectId: string, id: string) {
    const bucket = this.getBucket(projectId, 'world_setting')
    const item = bucket[id]
    if (!item) throw new Error(`世界观条目 ${id} 不存在。`)
    return item as Record<string, unknown>
  }

  async writeWorldSetting(projectId: string, id: string, data: Record<string, unknown>) {
    const bucket = this.getBucket(projectId, 'world_setting')
    const item = (bucket[id] as Record<string, unknown>) ?? {}
    bucket[id] = { ...item, ...data, updatedAt: new Date().toISOString() }
    return { ok: true }
  }

  async listOutline(projectId: string) {
    const bucket = this.getBucket(projectId, 'outline')
    return Object.entries(bucket).map(([id, v]) => ({
      id,
      title: String((v as Record<string, unknown>).title ?? id),
      volumeTitle: String((v as Record<string, unknown>).volumeTitle ?? '')
    }))
  }

  async readOutlineItem(projectId: string, id: string) {
    const bucket = this.getBucket(projectId, 'outline')
    const item = bucket[id]
    if (!item) throw new Error(`大纲节点 ${id} 不存在。`)
    return item as Record<string, unknown>
  }

  async writeOutlineItem(projectId: string, id: string, data: Record<string, unknown>) {
    const bucket = this.getBucket(projectId, 'outline')
    const item = (bucket[id] as Record<string, unknown>) ?? {}
    bucket[id] = { ...item, ...data, updatedAt: new Date().toISOString() }
    return { ok: true }
  }
}

// ============================================================================
// 工具工厂
// ============================================================================

/**
 * 创建小说项目 MCP 工具集。
 * @param accessor 项目数据访问器（缺省时使用内存实现）
 */
export function createNovelMcpTools(
  accessor?: NovelProjectAccessor
): Tool[] {
  const store: NovelProjectAccessor = accessor ?? new InMemoryNovelAccessor()

  /** 从 ToolContext 提取 projectId。 */
  function pid(ctx: ToolContext): string {
    if (!ctx.projectId) throw new Error('缺少项目 ID，无法访问项目资源。')
    return ctx.projectId
  }

  function fail(message: string): ToolHandlerResult {
    return { content: message, isError: true }
  }

  // ── 章节 ──
  const listChapters: Tool = {
    definition: {
      name: 'novel_list_chapters',
      description:
        '列出当前小说的全部章节（含分卷、状态、字数），用于了解章节结构。',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: async (_args, ctx) => {
      try {
        const chapters = await store.listChapters(pid(ctx))
        if (chapters.length === 0) {
          return { content: '暂无章节。' }
        }
        const lines = chapters.map((c, i) => {
          const parts = [
            `${i + 1}. ${c.title}`,
            c.volumeTitle ? `【${c.volumeTitle}】` : '',
            c.status ? `(${c.status})` : '',
            c.wordCount ? `${c.wordCount}字` : ''
          ]
          return parts.filter(Boolean).join(' ')
        })
        return { content: `当前小说共 ${chapters.length} 个章节：\n${lines.join('\n')}` }
      } catch (e) {
        return fail(`读取章节列表失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const readChapter: Tool = {
    definition: {
      name: 'novel_read_chapter',
      description:
        '读取指定章节的完整正文内容。必须先调用此工具获取原有上下文，才能修改章节。',
      inputSchema: {
        type: 'object',
        properties: {
          chapterId: { type: 'string', description: '章节 ID 或标题关键词。' }
        },
        required: ['chapterId']
      }
    },
    handler: async (args, ctx) => {
      const chapterId = String(args.chapterId ?? '').trim()
      if (!chapterId) return fail('缺少参数 chapterId。')
      try {
        const chapters = await store.listChapters(pid(ctx))
        // 支持按 ID 或标题模糊匹配
        const match = chapters.find(
          (c) => c.id === chapterId || c.title.toLowerCase().includes(chapterId.toLowerCase())
        )
        if (!match) {
          return fail(`未找到章节「${chapterId}」。可用章节：${chapters.map((c) => c.title).join('、') || '（空）'}`)
        }
        const chapter = await store.readChapter(pid(ctx), match.id)
        const truncated = chapter.content.length > 30_000
        return {
          content: `章节《${chapter.title}》\n\n${chapter.content.slice(0, 30_000)}${truncated ? '\n\n…（内容过长已截断，如需完整内容请缩小范围）' : ''}`
        }
      } catch (e) {
        return fail(`读取章节失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const writeChapter: Tool = {
    definition: {
      name: 'novel_write_chapter',
      description:
        '写入/更新章节正文内容。修改前必须先用 novel_read_chapter 读取原有内容，确保设定统一。重大覆盖需用户确认。',
      inputSchema: {
        type: 'object',
        properties: {
          chapterId: { type: 'string', description: '章节 ID 或标题关键词。' },
          content: { type: 'string', description: '新的章节正文内容。' }
        },
        required: ['chapterId', 'content']
      }
    },
    handler: async (args, ctx) => {
      const chapterId = String(args.chapterId ?? '').trim()
      const content = String(args.content ?? '')
      if (!chapterId) return fail('缺少参数 chapterId。')
      if (!content.trim()) return fail('内容为空，拒绝写入。')
      try {
        const chapters = await store.listChapters(pid(ctx))
        const match = chapters.find(
          (c) => c.id === chapterId || c.title.toLowerCase().includes(chapterId.toLowerCase())
        )
        if (!match) {
          return fail(`未找到章节「${chapterId}」。`)
        }
        await store.writeChapter(pid(ctx), match.id, content)
        return { content: `已写入章节《${match.title}》，共 ${content.length} 字。` }
      } catch (e) {
        return fail(`写入章节失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  // ── 人物卡 ──
  const listCharacters: Tool = {
    definition: {
      name: 'novel_list_characters',
      description: '列出当前小说的全部人物卡（含定位），用于了解人物架构。',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: async (_args, ctx) => {
      try {
        const chars = await store.listCharacters(pid(ctx))
        if (chars.length === 0) return { content: '暂无人物卡。' }
        const lines = chars.map((c, i) => {
          const role = c.role ? `（${c.role}）` : ''
          return `${i + 1}. ${c.name}${role}`
        })
        return { content: `当前小说共 ${chars.length} 个人物：\n${lines.join('\n')}` }
      } catch (e) {
        return fail(`读取人物列表失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const readCharacter: Tool = {
    definition: {
      name: 'novel_read_character',
      description: '读取指定人物卡的完整设定。修改前必须先读取，保证人物一致性。',
      inputSchema: {
        type: 'object',
        properties: {
          characterId: { type: 'string', description: '人物 ID 或姓名关键词。' }
        },
        required: ['characterId']
      }
    },
    handler: async (args, ctx) => {
      const cid = String(args.characterId ?? '').trim()
      if (!cid) return fail('缺少参数 characterId。')
      try {
        const chars = await store.listCharacters(pid(ctx))
        const match = chars.find(
          (c) => c.id === cid || c.name.toLowerCase().includes(cid.toLowerCase())
        )
        if (!match) {
          return fail(`未找到人物「${cid}」。可用人物：${chars.map((c) => c.name).join('、') || '（空）'}`)
        }
        const char = await store.readCharacter(pid(ctx), match.id)
        const lines = [
          `姓名：${char.name}`,
          char.role ? `定位：${char.role}` : '',
          char.description ? `描述：${char.description}` : '',
          char.tags?.length ? `标签：${char.tags.join('、')}` : ''
        ]
        return { content: lines.filter(Boolean).join('\n') }
      } catch (e) {
        return fail(`读取人物卡失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const writeCharacter: Tool = {
    definition: {
      name: 'novel_write_character',
      description:
        '更新人物卡设定。修改前必须先读取原有内容，重大覆盖需用户确认。',
      inputSchema: {
        type: 'object',
        properties: {
          characterId: { type: 'string', description: '人物 ID 或姓名关键词。' },
          name: { type: 'string', description: '人物姓名。' },
          role: { type: 'string', description: '人物定位（主角/配角/反派等）。' },
          description: { type: 'string', description: '人物描述与性格设定。' },
          tags: { type: 'array', items: { type: 'string' }, description: '人物标签。' }
        },
        required: ['characterId']
      }
    },
    handler: async (args, ctx) => {
      const cid = String(args.characterId ?? '').trim()
      if (!cid) return fail('缺少参数 characterId。')
      try {
        const chars = await store.listCharacters(pid(ctx))
        const match = chars.find(
          (c) => c.id === cid || c.name.toLowerCase().includes(cid.toLowerCase())
        )
        if (!match) {
          return fail(`未找到人物「${cid}」。`)
        }
        const patch: Record<string, unknown> = {}
        if (args.name !== undefined) patch.name = String(args.name)
        if (args.role !== undefined) patch.role = String(args.role)
        if (args.description !== undefined) patch.description = String(args.description)
        if (args.tags !== undefined) patch.tags = args.tags
        await store.writeCharacter(pid(ctx), match.id, patch)
        return { content: `已更新人物卡「${patch.name ?? match.name}」。` }
      } catch (e) {
        return fail(`写入人物卡失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  // ── 伏笔 ──
  const listForeshadows: Tool = {
    definition: {
      name: 'novel_list_foreshadows',
      description: '列出当前小说的全部伏笔（含状态）。',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: async (_args, ctx) => {
      try {
        const items = await store.listForeshadows(pid(ctx))
        if (items.length === 0) return { content: '暂无伏笔记录。' }
        const lines = items.map((f, i) => {
          const status = f.status ? `(${f.status})` : ''
          return `${i + 1}. ${f.title}${status}`
        })
        return { content: `当前小说共 ${items.length} 个伏笔：\n${lines.join('\n')}` }
      } catch (e) {
        return fail(`读取伏笔列表失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const readForeshadow: Tool = {
    definition: {
      name: 'novel_read_foreshadow',
      description: '读取指定伏笔的详情。修改前必须先读取。',
      inputSchema: {
        type: 'object',
        properties: {
          foreshadowId: { type: 'string', description: '伏笔 ID 或标题关键词。' }
        },
        required: ['foreshadowId']
      }
    },
    handler: async (args, ctx) => {
      const fid = String(args.foreshadowId ?? '').trim()
      if (!fid) return fail('缺少参数 foreshadowId。')
      try {
        const items = await store.listForeshadows(pid(ctx))
        const match = items.find(
          (f) => f.id === fid || f.title.toLowerCase().includes(fid.toLowerCase())
        )
        if (!match) {
          return fail(`未找到伏笔「${fid}」。可用：${items.map((f) => f.title).join('、') || '（空）'}`)
        }
        const detail = await store.readForeshadow(pid(ctx), match.id)
        return { content: JSON.stringify(detail, null, 2) }
      } catch (e) {
        return fail(`读取伏笔失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const writeForeshadow: Tool = {
    definition: {
      name: 'novel_write_foreshadow',
      description: '更新伏笔详情。修改前必须先读取。',
      inputSchema: {
        type: 'object',
        properties: {
          foreshadowId: { type: 'string', description: '伏笔 ID 或标题关键词。' },
          title: { type: 'string', description: '伏笔标题。' },
          content: { type: 'string', description: '伏笔内容描述。' },
          status: { type: 'string', description: '伏笔状态（open/pending/resolved）。' }
        },
        required: ['foreshadowId']
      }
    },
    handler: async (args, ctx) => {
      const fid = String(args.foreshadowId ?? '').trim()
      if (!fid) return fail('缺少参数 foreshadowId。')
      try {
        const items = await store.listForeshadows(pid(ctx))
        const match = items.find(
          (f) => f.id === fid || f.title.toLowerCase().includes(fid.toLowerCase())
        )
        if (!match) return fail(`未找到伏笔「${fid}」。`)
        const patch: Record<string, unknown> = {}
        if (args.title !== undefined) patch.title = String(args.title)
        if (args.content !== undefined) patch.content = String(args.content)
        if (args.status !== undefined) patch.status = String(args.status)
        await store.writeForeshadow(pid(ctx), match.id, patch)
        return { content: `已更新伏笔「${patch.title ?? match.title}」。` }
      } catch (e) {
        return fail(`写入伏笔失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  // ── 世界观 ──
  const listWorldSettings: Tool = {
    definition: {
      name: 'novel_list_world_settings',
      description: '列出当前小说的世界观条目（含分类）。',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: async (_args, ctx) => {
      try {
        const items = await store.listWorldSettings(pid(ctx))
        if (items.length === 0) return { content: '暂无世界观条目。' }
        const lines = items.map((w, i) => {
          const type = w.type ? `（${w.type}）` : ''
          return `${i + 1}. ${w.title}${type}`
        })
        return { content: `当前小说共 ${items.length} 条世界观设定：\n${lines.join('\n')}` }
      } catch (e) {
        return fail(`读取世界观列表失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const readWorldSetting: Tool = {
    definition: {
      name: 'novel_read_world_setting',
      description: '读取指定世界观条目的详情。修改前必须先读取。',
      inputSchema: {
        type: 'object',
        properties: {
          worldSettingId: { type: 'string', description: '世界观条目 ID 或标题关键词。' }
        },
        required: ['worldSettingId']
      }
    },
    handler: async (args, ctx) => {
      const wid = String(args.worldSettingId ?? '').trim()
      if (!wid) return fail('缺少参数 worldSettingId。')
      try {
        const items = await store.listWorldSettings(pid(ctx))
        const match = items.find(
          (w) => w.id === wid || w.title.toLowerCase().includes(wid.toLowerCase())
        )
        if (!match) {
          return fail(`未找到世界观条目「${wid}」。可用：${items.map((w) => w.title).join('、') || '（空）'}`)
        }
        const detail = await store.readWorldSetting(pid(ctx), match.id)
        return { content: JSON.stringify(detail, null, 2) }
      } catch (e) {
        return fail(`读取世界观失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const writeWorldSetting: Tool = {
    definition: {
      name: 'novel_write_world_setting',
      description: '更新世界观条目。修改前必须先读取。',
      inputSchema: {
        type: 'object',
        properties: {
          worldSettingId: { type: 'string', description: '世界观条目 ID 或标题关键词。' },
          title: { type: 'string', description: '条目标题。' },
          content: { type: 'string', description: '条目内容。' },
          type: { type: 'string', description: '条目分类（地理/魔法/科技/社会等）。' }
        },
        required: ['worldSettingId']
      }
    },
    handler: async (args, ctx) => {
      const wid = String(args.worldSettingId ?? '').trim()
      if (!wid) return fail('缺少参数 worldSettingId。')
      try {
        const items = await store.listWorldSettings(pid(ctx))
        const match = items.find(
          (w) => w.id === wid || w.title.toLowerCase().includes(wid.toLowerCase())
        )
        if (!match) return fail(`未找到世界观条目「${wid}」。`)
        const patch: Record<string, unknown> = {}
        if (args.title !== undefined) patch.title = String(args.title)
        if (args.content !== undefined) patch.content = String(args.content)
        if (args.type !== undefined) patch.type = String(args.type)
        await store.writeWorldSetting(pid(ctx), match.id, patch)
        return { content: `已更新世界观条目「${patch.title ?? match.title}」。` }
      } catch (e) {
        return fail(`写入世界观失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  // ── 大纲 ──
  const listOutline: Tool = {
    definition: {
      name: 'novel_list_outline',
      description: '列出当前小说的全部大纲节点（含分卷）。',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: async (_args, ctx) => {
      try {
        const items = await store.listOutline(pid(ctx))
        if (items.length === 0) return { content: '暂无大纲节点。' }
        const lines = items.map((o, i) => {
          const vol = o.volumeTitle ? `【${o.volumeTitle}】` : ''
          return `${i + 1}. ${vol}${o.title}`
        })
        return { content: `当前小说共 ${items.length} 个大纲节点：\n${lines.join('\n')}` }
      } catch (e) {
        return fail(`读取大纲列表失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const readOutlineItem: Tool = {
    definition: {
      name: 'novel_read_outline_item',
      description: '读取指定大纲节点的详情。修改前必须先读取。',
      inputSchema: {
        type: 'object',
        properties: {
          outlineItemId: { type: 'string', description: '大纲节点 ID 或标题关键词。' }
        },
        required: ['outlineItemId']
      }
    },
    handler: async (args, ctx) => {
      const oid = String(args.outlineItemId ?? '').trim()
      if (!oid) return fail('缺少参数 outlineItemId。')
      try {
        const items = await store.listOutline(pid(ctx))
        const match = items.find(
          (o) => o.id === oid || o.title.toLowerCase().includes(oid.toLowerCase())
        )
        if (!match) {
          return fail(`未找到大纲节点「${oid}」。可用：${items.map((o) => o.title).join('、') || '（空）'}`)
        }
        const detail = await store.readOutlineItem(pid(ctx), match.id)
        return { content: JSON.stringify(detail, null, 2) }
      } catch (e) {
        return fail(`读取大纲失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const writeOutlineItem: Tool = {
    definition: {
      name: 'novel_write_outline_item',
      description: '更新大纲节点。修改前必须先读取。',
      inputSchema: {
        type: 'object',
        properties: {
          outlineItemId: { type: 'string', description: '大纲节点 ID 或标题关键词。' },
          title: { type: 'string', description: '节点标题。' },
          summary: { type: 'string', description: '节点摘要。' },
          conflict: { type: 'string', description: '核心冲突。' },
          status: { type: 'string', description: '节点状态。' }
        },
        required: ['outlineItemId']
      }
    },
    handler: async (args, ctx) => {
      const oid = String(args.outlineItemId ?? '').trim()
      if (!oid) return fail('缺少参数 outlineItemId。')
      try {
        const items = await store.listOutline(pid(ctx))
        const match = items.find(
          (o) => o.id === oid || o.title.toLowerCase().includes(oid.toLowerCase())
        )
        if (!match) return fail(`未找到大纲节点「${oid}」。`)
        const patch: Record<string, unknown> = {}
        if (args.title !== undefined) patch.title = String(args.title)
        if (args.summary !== undefined) patch.summary = String(args.summary)
        if (args.conflict !== undefined) patch.conflict = String(args.conflict)
        if (args.status !== undefined) patch.status = String(args.status)
        await store.writeOutlineItem(pid(ctx), match.id, patch)
        return { content: `已更新大纲节点「${patch.title ?? match.title}」。` }
      } catch (e) {
        return fail(`写入大纲失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return [
    listChapters,
    readChapter,
    writeChapter,
    listCharacters,
    readCharacter,
    writeCharacter,
    listForeshadows,
    readForeshadow,
    writeForeshadow,
    listWorldSettings,
    readWorldSetting,
    writeWorldSetting,
    listOutline,
    readOutlineItem,
    writeOutlineItem
  ]
}
