/**
 * StagedChangeCommitter · 变更 → 业务库写入的分发中枢
 *
 * StagedChangesStore.commit(committer) 逐条调用 committer。
 * 按 change.kind 分发到对应写库函数。
 */

import { randomUUID } from 'node:crypto'
import type {
  StagedChange,
  StagedChangeCommitResult
} from '@shared/assistant-runtime'
import { ensureWorkspaceDb } from '../../workspace-store'
import type { WorkflowDocumentKey } from '../../workspace-types'
import { commitChapterEdit } from '../agent/tools/chapter-data-access'
import type { StagedChangeCommitter } from './staged-changes-store'

/**
 * 缺 projectId 的问题：`commitChapterEdit(projectId, chapterId, ...)` 需要 projectId。
 * 从 change 本身推不出。这里通过依赖注入拿：由 ConversationManager 查 session.projectId。
 */
export interface CreateCommitterDeps {
  resolveProjectId: (sessionId: string) => string | null
  onCommitted?: () => Promise<void> | void
}

const WORKFLOW_DOCUMENT_KEYS = new Set<WorkflowDocumentKey>([
  'task_plan',
  'findings',
  'progress',
  'current_status',
  'novel_setting',
  'character_relationships',
  'pending_hooks',
  'resource_ledger'
])

export function createCommitter(deps: CreateCommitterDeps): StagedChangeCommitter {
  return async (change: StagedChange) => {
    const projectId = deps.resolveProjectId(change.sessionId)
    if (!projectId) {
      return {
        changeId: change.id,
        ok: false,
        error: `找不到 sessionId=${change.sessionId} 对应的 projectId`
      }
    }

    let result: StagedChangeCommitResult
    if (change.action === 'delete') {
      result = await commitDelete(change, projectId)
      if (result.ok) {
        await deps.onCommitted?.()
      }
      return result
    }

    // update 冲突检测：若目标实体已被外部（非暂存区流程）修改，且 before 与
    // 数据库当前内容不一致，则拒绝写回并返回 stale 提示，避免覆盖用户手动修改。
    if (change.action === 'update' && change.entityId && change.before) {
      const conflict = await detectBeforeConflict(change, projectId)
      if (conflict) {
        return {
          changeId: change.id,
          ok: false,
          error: conflict
        }
      }
    }

    switch (change.kind) {
      case 'chapter':
        result = await commitChapter(change, projectId)
        break
      case 'worldview':
        result = await commitWorldview(change, projectId)
        break
      case 'character':
        result = await commitCharacter(change, projectId)
        break
      case 'outline':
        result = await commitOutline(change, projectId)
        break
      case 'organization':
        result = await commitOrganization(change, projectId)
        break
      case 'relationship':
        result = await commitRelationship(change, projectId)
        break
      case 'organization_membership':
        result = await commitOrganizationMembership(change, projectId)
        break
      case 'inspiration':
        result = await commitInspiration(change, projectId)
        break
      case 'constraint':
        result = await commitConstraint(change, projectId)
        break
      case 'outline_volume':
        result = await commitOutlineVolume(change, projectId)
        break
      case 'knowledge_document':
        result = await commitKnowledgeDocument(change, projectId)
        break
      case 'plot_thread':
        result = await commitPlotThread(change, projectId)
        break
      case 'workflow_document':
        result = await commitWorkflowDocument(change, projectId)
        break
      case 'project':
        result = await commitProjectMetadata(change, projectId)
        break
      default:
        result = {
          changeId: change.id,
          ok: false,
          error: `kind="${change.kind}" 的写回尚未实现（Phase 2 后续补齐）`
        }
    }

    if (result.ok) {
      await deps.onCommitted?.()
    }
    return result
  }
}

function readPayload(change: StagedChange): Record<string, unknown> {
  if (!change.entityPayload || typeof change.entityPayload !== 'object') {
    throw new Error('变更缺少结构化 entityPayload，无法写回')
  }
  return change.entityPayload
}

/**
 * update 写回前的冲突检测：读取目标实体当前的完整数据，用与 stage_* 相同的
 * 文本渲染格式重新生成 before 文本，与暂存时的 before 对比。
 * 若不一致说明实体已被外部修改，返回冲突描述；一致返回 null。
 * chapter 类不走这里（chapterHtml.old 已做对比）。
 */
async function detectBeforeConflict(
  change: StagedChange,
  projectId: string
): Promise<string | null> {
  if (!change.entityId) return null
  const db = await ensureWorkspaceDb()

  const checkText = (dbBefore: string, label: string): string | null => {
    if (dbBefore.trim() !== change.before.trim()) {
      return `${label}「${change.entityTitle}」已被外部修改，请重新审阅后再确认`
    }
    return null
  }

  switch (change.kind) {
    case 'worldview': {
      const row = db.prepare('SELECT type, title, content FROM worldview_entries WHERE id = ? AND project_id = ?')
        .get(change.entityId, projectId) as { type: string; title: string; content: string } | undefined
      if (!row) return `目标世界观条目已不存在（${change.entityId}）`
      return checkText(renderWorldviewText(row), '世界观')
    }
    case 'character': {
      const row = db.prepare('SELECT name, role, description, tags_json FROM characters WHERE id = ? AND project_id = ?')
        .get(change.entityId, projectId) as { name: string; role: string; description: string; tags_json: string } | undefined
      if (!row) return `目标人物已不存在（${change.entityId}）`
      const tags = parseJson<Array<{ label?: string }>>(row.tags_json, [])
      return checkText(renderCharacterText({ ...row, tags }), '人物')
    }
    case 'organization': {
      const row = db.prepare('SELECT name, type, description, motto FROM organizations WHERE id = ? AND project_id = ?')
        .get(change.entityId, projectId) as { name: string; type: string; description: string; motto: string } | undefined
      if (!row) return `目标组织已不存在（${change.entityId}）`
      return checkText(renderOrganizationText(row), '组织')
    }
    case 'outline': {
      const row = db.prepare(`
        SELECT oi.title, oi.word_target, oi.conflict, oi.summary, ov.title AS volumeTitle,
          oi.related_character_ids_json, oi.related_organization_ids_json, oi.related_worldview_ids_json
        FROM outline_items oi
        LEFT JOIN outline_volumes ov ON ov.id = oi.volume_id AND ov.project_id = oi.project_id
        WHERE oi.id = ? AND oi.project_id = ?
      `).get(change.entityId, projectId) as {
        title: string; word_target: string; conflict: string; summary: string
        volumeTitle: string | null
        related_character_ids_json: string; related_organization_ids_json: string; related_worldview_ids_json: string
      } | undefined
      if (!row) return `目标大纲节点已不存在（${change.entityId}）`
      return checkText(renderOutlineText({
        title: row.title,
        wordTarget: row.word_target,
        conflict: row.conflict,
        summary: row.summary,
        volumeTitle: row.volumeTitle ?? '',
        relatedCharacterIds: parseJson<string[]>(row.related_character_ids_json, []),
        relatedOrganizationIds: parseJson<string[]>(row.related_organization_ids_json, []),
        relatedWorldviewIds: parseJson<string[]>(row.related_worldview_ids_json, [])
      }), '大纲')
    }
    case 'inspiration': {
      const row = db.prepare('SELECT type, title, content, source, tags_json FROM inspiration_entries WHERE id = ? AND project_id = ?')
        .get(change.entityId, projectId) as { type: string; title: string; content: string; source: string; tags_json: string } | undefined
      if (!row) return `目标灵感卡片已不存在（${change.entityId}）`
      return checkText(renderInspirationText({
        type: row.type,
        title: row.title,
        content: row.content,
        source: row.source,
        tags: parseJson<string[]>(row.tags_json, [])
      }), '灵感')
    }
    case 'outline_volume': {
      const row = db.prepare('SELECT title, word_target, summary FROM outline_volumes WHERE id = ? AND project_id = ?')
        .get(change.entityId, projectId) as { title: string; word_target: string; summary: string } | undefined
      if (!row) return `目标分卷已不存在（${change.entityId}）`
      return checkText(renderVolumeText({ title: row.title, wordTarget: row.word_target, summary: row.summary }), '分卷')
    }
    case 'constraint': {
      const row = db.prepare(`
        SELECT title, content, keywords_json, metadata_json FROM knowledge_documents
        WHERE id = ? AND project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
      `).get(change.entityId, projectId) as { title: string; content: string; keywords_json: string; metadata_json: string } | undefined
      if (!row) return `目标项目约束已不存在（${change.entityId}）`
      const meta = parseJson<{ scope?: string; weight?: string; locked?: boolean }>(row.metadata_json, {})
      return checkText(renderConstraintText({
        title: row.title,
        content: row.content,
        scope: meta.scope ?? 'project',
        weight: meta.weight ?? 'core',
        locked: meta.locked !== false,
        keywords: parseJson<string[]>(row.keywords_json, [])
      }), '项目约束')
    }
    case 'plot_thread': {
      const row = db.prepare(`
        SELECT title, description, status, opened_in_chapter_id, closed_in_chapter_id, tags_json
        FROM plot_threads WHERE id = ? AND project_id = ?
      `).get(change.entityId, projectId) as {
        title: string; description: string; status: string
        opened_in_chapter_id: string | null; closed_in_chapter_id: string | null; tags_json: string
      } | undefined
      if (!row) return `目标伏笔已不存在（${change.entityId}）`
      const tags = parseJson<string[]>(row.tags_json, [])
      return checkText(renderPlotThreadText({
        title: row.title,
        description: row.description,
        status: row.status,
        openedInChapterId: row.opened_in_chapter_id ?? undefined,
        closedInChapterId: row.closed_in_chapter_id ?? undefined,
        tags
      }), '伏笔')
    }
    case 'knowledge_document': {
      const row = db.prepare(`
        SELECT title, source_type, source_label, content, summary, keywords_json, metadata_json
        FROM knowledge_documents
        WHERE id = ? AND project_id = ?
          AND NOT (source_type = 'canon-fact' AND source_label = 'global-constraint')
      `).get(change.entityId, projectId) as {
        title: string; source_type: string; source_label: string; content: string; summary: string
        keywords_json: string; metadata_json: string
      } | undefined
      if (!row) return `目标知识文档已不存在（${change.entityId}）`
      return checkText(renderKnowledgeText({
        title: row.title,
        sourceType: row.source_type,
        sourceLabel: row.source_label,
        content: row.content,
        summary: row.summary,
        keywords: parseJson<string[]>(row.keywords_json, []),
        metadata: parseJson<Record<string, unknown>>(row.metadata_json, {})
      }), '知识文档')
    }
    default:
      return null
  }
}

// ============================================================================
// before 文本渲染（与 stage_* 工具保持一致，用于冲突检测）
// ============================================================================

function parseJson<T>(text: string | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function renderWorldviewText(entry: { type?: string; title?: string; content?: string }): string {
  return [
    entry.type ? `分类：${entry.type}` : '',
    entry.title ? `标题：${entry.title}` : '',
    entry.content ? `内容：${entry.content}` : ''
  ].filter(Boolean).join('\n')
}

function renderCharacterText(c: {
  name?: string; role?: string; description?: string; tags?: Array<{ label?: string } | string>
}): string {
  const tagsStr = (c.tags ?? [])
    .map((t) => (typeof t === 'string' ? t : t.label))
    .join(' / ')
  return [
    c.name ? `姓名：${c.name}` : '',
    c.role ? `定位：${c.role}` : '',
    c.description ? `描述：${c.description}` : '',
    tagsStr ? `标签：${tagsStr}` : ''
  ].filter(Boolean).join('\n')
}

function renderOutlineText(item: {
  title?: string; conflict?: string; summary?: string; wordTarget?: string; volumeTitle?: string
  relatedCharacterIds?: string[]; relatedOrganizationIds?: string[]; relatedWorldviewIds?: string[]
}): string {
  return [
    item.volumeTitle ? `所属分卷：${item.volumeTitle}` : '',
    item.title ? `标题：${item.title}` : '',
    item.wordTarget ? `字数目标：${item.wordTarget}` : '',
    item.conflict ? `核心冲突：${item.conflict}` : '',
    item.summary ? `摘要：${item.summary}` : '',
    item.relatedCharacterIds?.length ? `关联角色 ID：${item.relatedCharacterIds.join(' / ')}` : '',
    item.relatedOrganizationIds?.length ? `关联组织 ID：${item.relatedOrganizationIds.join(' / ')}` : '',
    item.relatedWorldviewIds?.length ? `关联设定 ID：${item.relatedWorldviewIds.join(' / ')}` : ''
  ].filter(Boolean).join('\n')
}

function renderOrganizationText(entry: { name?: string; type?: string; description?: string; motto?: string }): string {
  return [
    entry.name ? `名称：${entry.name}` : '',
    entry.type ? `类型：${entry.type}` : '',
    entry.motto ? `信条：${entry.motto}` : '',
    entry.description ? `描述：${entry.description}` : ''
  ].filter(Boolean).join('\n')
}

function renderInspirationText(item: {
  type?: string; title?: string; content?: string; source?: string; tags?: string[]
}): string {
  return [
    `类型：${item.type ?? ''}`,
    `标题：${item.title ?? ''}`,
    `来源：${item.source ?? ''}`,
    `标签：${(item.tags ?? []).join(' / ') || '（空）'}`,
    `内容：${item.content ?? ''}`
  ].join('\n')
}

function renderVolumeText(item: { title?: string; wordTarget?: string; summary?: string }): string {
  return [
    `标题：${item.title ?? ''}`,
    `字数目标：${item.wordTarget ?? ''}`,
    `摘要：${item.summary || '（空）'}`
  ].join('\n')
}

function renderConstraintText(item: {
  title?: string; content?: string; scope?: string; weight?: string; locked?: boolean; keywords?: string[]
}): string {
  return [
    item.title ? `标题：${item.title}` : '',
    item.scope ? `范围：${item.scope}` : '',
    item.weight ? `权重：${item.weight}` : '',
    typeof item.locked === 'boolean' ? `锁定：${item.locked ? '是' : '否'}` : '',
    item.keywords?.length ? `关键词：${item.keywords.join(' / ')}` : '',
    item.content ? `内容：${item.content}` : ''
  ].filter(Boolean).join('\n')
}

function renderPlotThreadText(item: {
  title?: string; description?: string; status?: string; openedInChapterId?: string; closedInChapterId?: string; tags?: string[]
}): string {
  return [
    item.title ? `标题：${item.title}` : '',
    item.status ? `状态：${item.status}` : '',
    item.openedInChapterId ? `埋设章节：${item.openedInChapterId}` : '',
    item.closedInChapterId ? `收束章节：${item.closedInChapterId}` : '',
    item.tags?.length ? `标签：${item.tags.join(' / ')}` : '',
    item.description ? `描述：${item.description}` : ''
  ].filter(Boolean).join('\n')
}

function renderKnowledgeText(item: {
  title?: string; sourceType?: string; sourceLabel?: string; content?: string; summary?: string
  keywords?: string[]; metadata?: Record<string, unknown>
}): string {
  return [
    `标题：${item.title ?? ''}`,
    `类型：${item.sourceType ?? ''}`,
    `来源：${item.sourceLabel || '（空）'}`,
    `摘要：${item.summary || '（空）'}`,
    `关键词：${(item.keywords ?? []).join(' / ') || '（空）'}`,
    `元数据：${JSON.stringify(item.metadata ?? {})}`,
    `内容：${item.content ?? ''}`
  ].join('\n')
}

/** 各实体 kind 对应的删除目标表（constraint 复用 knowledge_documents，需额外 scope 约束）。 */
const DELETE_TABLE: Record<string, string> = {
  chapter: 'chapters',
  worldview: 'worldview_entries',
  character: 'characters',
  organization: 'organizations',
  relationship: 'character_relationships',
  organization_membership: 'organization_memberships',
  inspiration: 'inspiration_entries',
  outline: 'outline_items',
  plot_thread: 'plot_threads',
  workflow_document: 'workflow_documents'
}

/**
 * 删除写回：按 kind 定位表，DELETE by id + project_id。
 * chapter 删除会级联删除 chapter_versions（外键 ON DELETE CASCADE）。
 * constraint 存于 knowledge_documents，额外限定 canon-fact/global-constraint，避免误删普通知识文档。
 */
async function commitDelete(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: 'delete 缺少 entityId' }
  }
  const db = await ensureWorkspaceDb()

  if (change.kind === 'chapter') {
    const existing = db.prepare('SELECT id FROM chapters WHERE id = ? AND project_id = ?')
      .get(change.entityId, projectId) as { id: string } | undefined
    if (!existing) {
      return { changeId: change.id, ok: false, error: `章节不存在或已删除：${change.entityId}` }
    }
    // 允许删除最后一个章节：不再强制保留一个章节（删除前由 UI/工具层提示确认）。

    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM chapters WHERE id = ? AND project_id = ?').run(change.entityId, projectId)
      db.prepare(`
        DELETE FROM story_embeddings
        WHERE project_id = ? AND source_type = 'chapter_segment' AND source_id = ?
      `).run(projectId, change.entityId)
      db.exec('COMMIT')
      return { changeId: change.id, ok: true, entityId: change.entityId }
    } catch (error) {
      db.exec('ROLLBACK')
      return {
        changeId: change.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  if (change.kind === 'outline_volume') {
    const volume = db.prepare('SELECT id, sort_order FROM outline_volumes WHERE id = ? AND project_id = ?')
      .get(change.entityId, projectId) as { id: string; sort_order: number } | undefined
    if (!volume) return { changeId: change.id, ok: false, error: `分卷不存在或已删除：${change.entityId}` }
    const count = db.prepare('SELECT COUNT(*) AS value FROM outline_volumes WHERE project_id = ?')
      .get(projectId) as { value: number }
    const payload = readPayload(change)
    // 允许删除最后一个分卷：不再强制保留一个分卷（删除前由 UI/工具层提示确认）。
    // 若删除的是最后一个分卷，其下章节/大纲一并删除；否则迁移到承接分卷。
    const isLastVolume = Number(count.value) <= 1
    const requestedFallbackId = stringField(payload, 'fallbackVolumeId') || stringField(payload, 'fallback_volume_id')
    const fallback = isLastVolume
      ? undefined
      : requestedFallbackId
        ? db.prepare('SELECT id FROM outline_volumes WHERE id = ? AND project_id = ? AND id <> ?')
          .get(requestedFallbackId, projectId, change.entityId) as { id: string } | undefined
        : db.prepare(`
            SELECT id FROM outline_volumes
            WHERE project_id = ? AND id <> ?
            ORDER BY ABS(sort_order - ?), sort_order
            LIMIT 1
          `).get(projectId, change.entityId, volume.sort_order) as { id: string } | undefined

    db.exec('BEGIN')
    try {
      if (fallback) {
        db.prepare('UPDATE outline_items SET volume_id = ? WHERE project_id = ? AND volume_id = ?')
          .run(fallback.id, projectId, change.entityId)
        db.prepare('UPDATE chapters SET volume_id = ? WHERE project_id = ? AND volume_id = ?')
          .run(fallback.id, projectId, change.entityId)
      } else {
        // 删除最后一个分卷：级联删除其下章节与大纲节点，并清理向量索引。
        const removedChapterIds = (db.prepare('SELECT id FROM chapters WHERE project_id = ? AND volume_id = ?')
          .all(projectId, change.entityId) as Array<{ id: string }>).map((r) => r.id)
        for (const cid of removedChapterIds) {
          db.prepare(`
            DELETE FROM story_embeddings
            WHERE project_id = ? AND source_type = 'chapter_segment' AND source_id = ?
          `).run(projectId, cid)
        }
        db.prepare('DELETE FROM chapters WHERE project_id = ? AND volume_id = ?').run(projectId, change.entityId)
        db.prepare('DELETE FROM outline_items WHERE project_id = ? AND volume_id = ?').run(projectId, change.entityId)
      }
      db.prepare('DELETE FROM outline_volumes WHERE id = ? AND project_id = ?').run(change.entityId, projectId)
      db.exec('COMMIT')
      return { changeId: change.id, ok: true, entityId: change.entityId }
    } catch (error) {
      db.exec('ROLLBACK')
      return { changeId: change.id, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  if (change.kind === 'constraint') {
    const result = db.prepare(`
      DELETE FROM knowledge_documents
      WHERE id = ? AND project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
    `).run(change.entityId, projectId)
    if (result.changes === 0) {
      return { changeId: change.id, ok: false, error: `项目约束不存在或已删除：${change.entityId}` }
    }
    return { changeId: change.id, ok: true, entityId: change.entityId }
  }

  if (change.kind === 'knowledge_document') {
    const result = db.prepare(`
      DELETE FROM knowledge_documents
      WHERE id = ? AND project_id = ?
        AND NOT (source_type = 'canon-fact' AND source_label = 'global-constraint')
    `).run(change.entityId, projectId)
    if (result.changes === 0) {
      return { changeId: change.id, ok: false, error: `知识文档不存在、已删除或属于项目约束：${change.entityId}` }
    }
    return { changeId: change.id, ok: true, entityId: change.entityId }
  }

  if (change.kind === 'character' || change.kind === 'organization' || change.kind === 'outline') {
    db.exec('BEGIN')
    try {
      if (change.kind === 'character') {
        db.prepare(`
          DELETE FROM character_relationships
          WHERE project_id = ? AND (from_character_id = ? OR to_character_id = ?)
        `).run(projectId, change.entityId, change.entityId)
        db.prepare('DELETE FROM organization_memberships WHERE project_id = ? AND character_id = ?')
          .run(projectId, change.entityId)
      } else if (change.kind === 'organization') {
        db.prepare('DELETE FROM organization_memberships WHERE project_id = ? AND organization_id = ?')
          .run(projectId, change.entityId)
      } else {
        db.prepare("UPDATE chapters SET outline_item_id = '' WHERE project_id = ? AND outline_item_id = ?")
          .run(projectId, change.entityId)
      }
      const table = DELETE_TABLE[change.kind]
      const result = db.prepare(`DELETE FROM ${table} WHERE id = ? AND project_id = ?`)
        .run(change.entityId, projectId)
      if (result.changes === 0) throw new Error(`目标不存在或已删除：${change.entityId}`)
      db.exec('COMMIT')
      return { changeId: change.id, ok: true, entityId: change.entityId }
    } catch (error) {
      db.exec('ROLLBACK')
      return { changeId: change.id, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const table = DELETE_TABLE[change.kind]
  if (!table) {
    return { changeId: change.id, ok: false, error: `kind="${change.kind}" 不支持删除` }
  }
  const result = db.prepare(`DELETE FROM ${table} WHERE id = ? AND project_id = ?`)
    .run(change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `目标不存在或已删除：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

function stringField(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : fallback
}

function tagLabels(payload: Record<string, unknown>): Array<{ label: string; tone?: string }> {
  const raw = payload.tags
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return { label: item.trim() }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const label = typeof record.label === 'string' ? record.label.trim() : ''
        const tone = typeof record.tone === 'string' ? record.tone.trim() : ''
        return tone ? { label, tone } : { label }
      }
      return { label: '' }
    })
    .filter((tag) => tag.label)
}

function defaultAvatar(name: string): string {
  const seed = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const hueA = seed % 360
  const hueB = (hueA + 42) % 360
  return `linear-gradient(135deg, hsl(${hueA} 72% 68%) 0%, hsl(${hueB} 72% 56%) 100%)`
}

function defaultColor(name: string): string {
  const seed = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const hueA = (seed + 160) % 360
  const hueB = (hueA + 36) % 360
  return `linear-gradient(135deg, hsl(${hueA} 65% 62%) 0%, hsl(${hueB} 62% 48%) 100%)`
}

function stringArrayField(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

/**
 * create 前的同名冲突拦截（对齐 v1 canApply=false 语义）：
 * 命中已有同名实体时返回冲突结果，提示用户忽略或改为手动更新，避免静默产生重复实体。
 */
function conflictResult(change: StagedChange, kindLabel: string, name: string): StagedChangeCommitResult {
  return {
    changeId: change.id,
    ok: false,
    error: `同名${kindLabel}「${name}」已存在，请忽略或改为手动更新`
  }
}

async function commitWorldview(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const title = stringField(payload, 'title')
  const content = stringField(payload, 'content')
  const type = stringField(payload, 'type', '设定')

  if (!title || !content) {
    return { changeId: change.id, ok: false, error: '世界观变更缺少 title 或 content' }
  }

  if (change.action === 'create') {
    const duplicate = db.prepare('SELECT id FROM worldview_entries WHERE project_id = ? AND TRIM(title) = ?')
      .get(projectId, title) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '世界观条目', title)
    const id = `world-${randomUUID()}`
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM worldview_entries WHERE project_id = ?')
      .get(projectId) as { value: number } | undefined
    db.prepare(`
      INSERT INTO worldview_entries (id, project_id, type, title, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, type, title, content, Number(maxOrder?.value ?? -1) + 1, now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '世界观 update 缺少 entityId' }
  }

  const existing = db.prepare('SELECT content FROM worldview_entries WHERE id = ? AND project_id = ?')
    .get(change.entityId, projectId) as { content: string } | undefined
  if (!existing) {
    return { changeId: change.id, ok: false, error: `世界观条目不存在：${change.entityId}` }
  }

  const result = db.prepare(`
    UPDATE worldview_entries
    SET type = ?, title = ?, content = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(type, title, content, now, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `世界观条目不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitCharacter(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const name = stringField(payload, 'name')
  const role = stringField(payload, 'role')
  const description = stringField(payload, 'description')
  const tags = tagLabels(payload)

  if (!name || !description) {
    return { changeId: change.id, ok: false, error: '人物变更缺少 name 或 description' }
  }

  if (change.action === 'create') {
    const duplicate = db.prepare('SELECT id FROM characters WHERE project_id = ? AND TRIM(name) = ?')
      .get(projectId, name) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '人物', name)
    const id = `character-${randomUUID()}`
    db.prepare(`
      INSERT INTO characters (id, project_id, name, role, description, avatar, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, role, description, defaultAvatar(name), JSON.stringify(tags))
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '人物 update 缺少 entityId' }
  }

  const existing = db.prepare('SELECT avatar FROM characters WHERE id = ? AND project_id = ?')
    .get(change.entityId, projectId) as { avatar: string } | undefined
  if (!existing) {
    return { changeId: change.id, ok: false, error: `人物不存在：${change.entityId}` }
  }

  const result = db.prepare(`
    UPDATE characters
    SET name = ?, role = ?, description = ?, avatar = ?, tags_json = ?
    WHERE id = ? AND project_id = ?
  `).run(name, role, description, existing.avatar || defaultAvatar(name), JSON.stringify(tags), change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `人物不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function ensureOutlineVolume(projectId: string, requestedVolumeId: string): Promise<string> {
  const db = await ensureWorkspaceDb()
  if (requestedVolumeId) {
    const existing = db.prepare('SELECT id FROM outline_volumes WHERE id = ? AND project_id = ?')
      .get(requestedVolumeId, projectId) as { id: string } | undefined
    if (existing) return existing.id
  }

  const first = db.prepare('SELECT id FROM outline_volumes WHERE project_id = ? ORDER BY sort_order ASC LIMIT 1')
    .get(projectId) as { id: string } | undefined
  if (first) return first.id

  const id = `volume-${randomUUID()}`
  db.prepare(`
    INSERT INTO outline_volumes (id, project_id, title, word_target, summary, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, '故事开端', '目标 5万字', '用于承载当前项目的默认分卷。', 0)
  return id
}

async function commitOutline(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const title = stringField(payload, 'title')
  const summary = stringField(payload, 'summary')
  const conflict = stringField(payload, 'conflict')
  const wordTarget = stringField(payload, 'wordTarget') || stringField(payload, 'word_target', '预估 3000字')
  const volumeId = stringField(payload, 'volumeId') || stringField(payload, 'volume_id')
  const relatedCharacterIds = [...new Set(stringArrayField(payload, 'relatedCharacterIds').length
    ? stringArrayField(payload, 'relatedCharacterIds')
    : stringArrayField(payload, 'related_character_ids'))].slice(0, 12)
  const relatedOrganizationIds = [...new Set(stringArrayField(payload, 'relatedOrganizationIds').length
    ? stringArrayField(payload, 'relatedOrganizationIds')
    : stringArrayField(payload, 'related_organization_ids'))].slice(0, 12)
  const relatedWorldviewIds = [...new Set(stringArrayField(payload, 'relatedWorldviewIds').length
    ? stringArrayField(payload, 'relatedWorldviewIds')
    : stringArrayField(payload, 'related_worldview_ids'))].slice(0, 12)

  if (!title || !summary) {
    return { changeId: change.id, ok: false, error: '大纲变更缺少 title 或 summary' }
  }
  if (!volumeId) {
    return { changeId: change.id, ok: false, error: '大纲变更缺少 volumeId，已拒绝默认写入第一个分卷' }
  }
  const volume = db.prepare('SELECT id FROM outline_volumes WHERE id = ? AND project_id = ?')
    .get(volumeId, projectId) as { id: string } | undefined
  if (!volume) {
    return { changeId: change.id, ok: false, error: `大纲目标分卷不存在：${volumeId}` }
  }

  const validCharacterIds = new Set((db.prepare('SELECT id FROM characters WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id))
  const validOrganizationIds = new Set((db.prepare('SELECT id FROM organizations WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id))
  const validWorldviewIds = new Set((db.prepare('SELECT id FROM worldview_entries WHERE project_id = ?').all(projectId) as Array<{ id: string }>).map((row) => row.id))
  const invalidReferenceIds = [
    ...relatedCharacterIds.filter((id) => !validCharacterIds.has(id)),
    ...relatedOrganizationIds.filter((id) => !validOrganizationIds.has(id)),
    ...relatedWorldviewIds.filter((id) => !validWorldviewIds.has(id))
  ]
  if (invalidReferenceIds.length) {
    return { changeId: change.id, ok: false, error: `大纲关联 ID 不属于当前项目：${invalidReferenceIds.join('、')}` }
  }

  if (change.action === 'create') {
    const duplicate = db.prepare('SELECT id FROM outline_items WHERE project_id = ? AND TRIM(title) = ?')
      .get(projectId, title) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '大纲节点', title)
    const id = `outline-${randomUUID()}`
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM outline_items WHERE project_id = ? AND volume_id = ?')
      .get(projectId, volumeId) as { value: number } | undefined
    db.prepare(`
      INSERT INTO outline_items (
        id, project_id, volume_id, title, word_target, conflict, summary,
        related_character_ids_json, related_organization_ids_json, related_worldview_ids_json,
        status, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, projectId, volumeId, title, wordTarget, conflict, summary,
      JSON.stringify(relatedCharacterIds), JSON.stringify(relatedOrganizationIds), JSON.stringify(relatedWorldviewIds),
      'planned', Number(maxOrder?.value ?? -1) + 1
    )
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '大纲 update 缺少 entityId' }
  }

  const existing = db.prepare('SELECT summary FROM outline_items WHERE id = ? AND project_id = ?')
    .get(change.entityId, projectId) as { summary: string } | undefined
  if (!existing) {
    return { changeId: change.id, ok: false, error: `大纲节点不存在：${change.entityId}` }
  }

  const result = db.prepare(`
    UPDATE outline_items
    SET volume_id = ?, title = ?, word_target = ?, conflict = ?, summary = ?,
      related_character_ids_json = ?, related_organization_ids_json = ?, related_worldview_ids_json = ?
    WHERE id = ? AND project_id = ?
  `).run(
    volumeId, title, wordTarget, conflict, summary,
    JSON.stringify(relatedCharacterIds), JSON.stringify(relatedOrganizationIds), JSON.stringify(relatedWorldviewIds),
    change.entityId, projectId
  )
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `大纲节点不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitWorkflowDocument(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const rawKey = stringField(payload, 'key') || stringField(payload, 'docKey') || stringField(payload, 'doc_key')
  const key = WORKFLOW_DOCUMENT_KEYS.has(rawKey as WorkflowDocumentKey)
    ? rawKey as WorkflowDocumentKey
    : null
  const title = stringField(payload, 'title')
  const content = stringField(payload, 'content')
  const volumeId = await ensureOutlineVolume(projectId, stringField(payload, 'volumeId') || stringField(payload, 'volume_id'))

  if (!key || !title || !content) {
    return { changeId: change.id, ok: false, error: '创作记忆变更缺少 key、title 或 content' }
  }

  const existing = db.prepare(`
    SELECT id
    FROM workflow_documents
    WHERE project_id = ? AND volume_id = ? AND doc_key = ?
  `).get(projectId, volumeId, key) as { id: string } | undefined

  const id = existing?.id || change.entityId || `${projectId}-${volumeId}-${key}`
  if (existing) {
    db.prepare(`
      UPDATE workflow_documents
      SET title = ?, content = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `).run(title, content, now, existing.id, projectId)
    return { changeId: change.id, ok: true, entityId: existing.id }
  }

  const maxOrder = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) AS value
    FROM workflow_documents
    WHERE project_id = ? AND volume_id = ?
  `).get(projectId, volumeId) as { value: number } | undefined
  db.prepare(`
    INSERT INTO workflow_documents (id, project_id, volume_id, doc_key, title, content, updated_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, volumeId, key, title, content, now, Number(maxOrder?.value ?? -1) + 1)
  return { changeId: change.id, ok: true, entityId: id }
}

async function commitOrganization(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const name = stringField(payload, 'name')
  const type = stringField(payload, 'type')
  const description = stringField(payload, 'description')
  const motto = stringField(payload, 'motto')

  if (!name || !type || !description) {
    return { changeId: change.id, ok: false, error: '组织变更缺少 name、type 或 description' }
  }

  if (change.action === 'create') {
    const duplicate = db.prepare('SELECT id FROM organizations WHERE project_id = ? AND TRIM(name) = ?')
      .get(projectId, name) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '组织', name)
    const id = `organization-${randomUUID()}`
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM organizations WHERE project_id = ?')
      .get(projectId) as { value: number } | undefined
    db.prepare(`
      INSERT INTO organizations (id, project_id, name, type, description, motto, color, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, type, description, motto, defaultColor(name), Number(maxOrder?.value ?? -1) + 1, now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '组织 update 缺少 entityId' }
  }

  const existing = db.prepare('SELECT color FROM organizations WHERE id = ? AND project_id = ?')
    .get(change.entityId, projectId) as { color: string } | undefined
  if (!existing) {
    return { changeId: change.id, ok: false, error: `组织不存在：${change.entityId}` }
  }

  const result = db.prepare(`
    UPDATE organizations
    SET name = ?, type = ?, description = ?, motto = ?, color = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(name, type, description, motto, existing.color || defaultColor(name), now, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `组织不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitConstraint(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const title = stringField(payload, 'title')
  const content = stringField(payload, 'content')
  const scope = stringField(payload, 'scope', 'project')
  const rawWeight = stringField(payload, 'weight', 'core')
  const weight = rawWeight === 'important' || rawWeight === 'supporting' ? rawWeight : 'core'
  const locked = payload.locked === false ? false : true
  const keywords = stringArrayField(payload, 'keywords')

  if (!title || !content) {
    return { changeId: change.id, ok: false, error: '项目约束缺少 title 或 content' }
  }

  const metadata = { scope, weight, locked }

  if (change.action === 'create') {
    const duplicate = db.prepare(`
      SELECT id FROM knowledge_documents
      WHERE project_id = ? AND TRIM(title) = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
    `).get(projectId, title) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '约束', title)
    const summary = content.length > 120 ? `${content.slice(0, 120)}…` : content
    const id = `constraint-${randomUUID()}`
    db.prepare(`
      INSERT INTO knowledge_documents (id, project_id, title, source_type, source_label, content, summary, keywords_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      title,
      'canon-fact',
      'global-constraint',
      content,
      summary,
      JSON.stringify(keywords),
      JSON.stringify(metadata),
      now,
      now
    )
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '项目约束 update 缺少 entityId' }
  }

  const existing = db.prepare(`
    SELECT content FROM knowledge_documents
    WHERE id = ? AND project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
  `).get(change.entityId, projectId) as { content: string } | undefined
  if (!existing) {
    return { changeId: change.id, ok: false, error: `项目约束不存在：${change.entityId}` }
  }
  const summary = content.length > 120 ? `${content.slice(0, 120)}…` : content

  const result = db.prepare(`
    UPDATE knowledge_documents
    SET title = ?, content = ?, summary = ?, keywords_json = ?, metadata_json = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
  `).run(title, content, summary, JSON.stringify(keywords), JSON.stringify(metadata), now, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `项目约束不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitPlotThread(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const title = stringField(payload, 'title')
  const description = stringField(payload, 'description')
  const openedInChapterId = stringField(payload, 'openedInChapterId') || stringField(payload, 'opened_in_chapter_id')
  const closedInChapterId = stringField(payload, 'closedInChapterId') || stringField(payload, 'closed_in_chapter_id')
  const rawStatus = stringField(payload, 'status', 'pending')
  const status = ['pending', 'resolved', 'abandoned'].includes(rawStatus) ? rawStatus : 'pending'
  const priority = stringField(payload, 'priority', 'medium')
  const remark = stringField(payload, 'remark', '')
  const tags = stringArrayField(payload, 'tags')

  if (!title || !description) {
    return { changeId: change.id, ok: false, error: '伏笔缺少 title 或 description' }
  }

  if (change.action === 'create') {
    const duplicate = db.prepare('SELECT id FROM plot_threads WHERE project_id = ? AND TRIM(title) = ?')
      .get(projectId, title) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '伏笔', title)
    const id = `plot-thread-${randomUUID()}`
    db.prepare(`
      INSERT INTO plot_threads (id, project_id, title, description, opened_in_chapter_id, planned_close_chapter_id, status, closed_in_chapter_id, tags_json, priority, remark, character_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, description, openedInChapterId, '', status, closedInChapterId, JSON.stringify(tags), priority, remark, '[]', now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '伏笔 update 缺少 entityId' }
  }

  const existing = db.prepare('SELECT description FROM plot_threads WHERE id = ? AND project_id = ?')
    .get(change.entityId, projectId) as { description: string } | undefined
  if (!existing) {
    return { changeId: change.id, ok: false, error: `伏笔不存在：${change.entityId}` }
  }

  const result = db.prepare(`
    UPDATE plot_threads
    SET title = ?, description = ?, opened_in_chapter_id = ?, status = ?, closed_in_chapter_id = ?, tags_json = ?, priority = ?, remark = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(title, description, openedInChapterId, status, closedInChapterId, JSON.stringify(tags), priority, remark, now, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `伏笔不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitChapter(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  if (change.action === 'create') {
    return commitChapterCreate(change, projectId)
  }
  if (change.action !== 'update') {
    return { changeId: change.id, ok: false, error: `章节暂只支持 create / update` }
  }
  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '章节变更缺少 entityId' }
  }
  const updateType = change.entityPayload ? stringField(change.entityPayload, 'chapterUpdateType') : ''
  if (updateType === 'metadata') {
    return commitChapterMetadata(change, projectId)
  }
  if (updateType === 'restore') {
    return commitChapterRestore(change, projectId)
  }
  if (!change.chapterHtml) {
    return { changeId: change.id, ok: false, error: '章节正文变更缺少 chapterHtml' }
  }
  try {
    await commitChapterEdit(
      projectId,
      change.entityId,
      change.chapterHtml.old,
      change.chapterHtml.new
    )
    return { changeId: change.id, ok: true, entityId: change.entityId }
  } catch (e) {
    return {
      changeId: change.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

async function commitChapterMetadata(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  if (!change.entityId) return { changeId: change.id, ok: false, error: '章节元数据变更缺少 entityId' }
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const title = stringField(payload, 'title')
  const summary = stringField(payload, 'summary')
  const status = stringField(payload, 'status')
  const wordTarget = stringField(payload, 'wordTarget') || stringField(payload, 'word_target')
  let volumeId = stringField(payload, 'volumeId') || stringField(payload, 'volume_id')
  const outlineItemId = stringField(payload, 'outlineItemId') || stringField(payload, 'outline_item_id')
  if (!title || !wordTarget || !['draft', 'review', 'polish', 'final'].includes(status)) {
    return { changeId: change.id, ok: false, error: '章节元数据缺少合法的 title、status 或 wordTarget' }
  }
  const outline = outlineItemId
    ? db.prepare('SELECT id, volume_id FROM outline_items WHERE id = ? AND project_id = ?')
      .get(outlineItemId, projectId) as { id: string; volume_id: string } | undefined
    : undefined
  if (outlineItemId && !outline) {
    return { changeId: change.id, ok: false, error: `大纲节点不存在：${outlineItemId}` }
  }
  if (outline) volumeId = outline.volume_id
  const volume = db.prepare('SELECT id FROM outline_volumes WHERE id = ? AND project_id = ?')
    .get(volumeId, projectId) as { id: string } | undefined
  if (!volume) return { changeId: change.id, ok: false, error: `分卷不存在：${volumeId}` }

  const result = db.prepare(`
    UPDATE chapters
    SET volume_id = ?, outline_item_id = ?, title = ?, summary = ?, status = ?, word_target = ?
    WHERE id = ? AND project_id = ?
  `).run(volumeId, outline?.id || '', title, summary, status, wordTarget, change.entityId, projectId)
  if (result.changes === 0) return { changeId: change.id, ok: false, error: `章节不存在：${change.entityId}` }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitChapterRestore(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  if (!change.entityId || !change.chapterHtml) {
    return { changeId: change.id, ok: false, error: '章节恢复缺少 entityId 或 chapterHtml' }
  }
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const versionId = stringField(payload, 'restoreVersionId') || stringField(payload, 'restore_version_id')
  const current = db.prepare(`
    SELECT title, summary, status, word_target, content
    FROM chapters WHERE id = ? AND project_id = ?
  `).get(change.entityId, projectId) as {
    title: string; summary: string; status: string; word_target: string; content: string
  } | undefined
  if (!current) return { changeId: change.id, ok: false, error: `章节不存在：${change.entityId}` }
  if (current.content !== change.chapterHtml.old) {
    return { changeId: change.id, ok: false, error: '章节正文在暂存后已发生变化，请重新生成恢复提案。' }
  }
  const version = db.prepare(`
    SELECT title, summary, status, word_target, content
    FROM chapter_versions WHERE id = ? AND chapter_id = ? AND project_id = ?
  `).get(versionId, change.entityId, projectId) as {
    title: string; summary: string; status: string; word_target: string; content: string
  } | undefined
  if (!version) return { changeId: change.id, ok: false, error: `历史版本不存在：${versionId}` }

  db.exec('BEGIN')
  try {
    db.prepare(`
      INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), projectId, change.entityId, current.title, current.summary, current.status, current.word_target, current.content, new Date().toISOString())
    db.prepare(`
      UPDATE chapters SET title = ?, summary = ?, status = ?, word_target = ?, content = ?
      WHERE id = ? AND project_id = ?
    `).run(version.title, version.summary, version.status, version.word_target, version.content, change.entityId, projectId)
    db.exec('COMMIT')
    return { changeId: change.id, ok: true, entityId: change.entityId }
  } catch (error) {
    db.exec('ROLLBACK')
    return { changeId: change.id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function commitChapterCreate(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const title = stringField(payload, 'title') || change.entityTitle
  if (!title) {
    return { changeId: change.id, ok: false, error: '新建章节缺少 title' }
  }
  const summary = stringField(payload, 'summary')
  const wordTarget = stringField(payload, 'wordTarget') || stringField(payload, 'word_target', '预估 3000字')
  const content = change.chapterHtml?.new ?? ''
  const outlineItemId = stringField(payload, 'outlineItemId') || stringField(payload, 'outline_item_id')
  const outlineItem = outlineItemId
    ? db.prepare('SELECT id, volume_id FROM outline_items WHERE id = ? AND project_id = ?')
      .get(outlineItemId, projectId) as { id: string; volume_id: string } | undefined
    : undefined
  if (outlineItemId && !outlineItem) {
    return { changeId: change.id, ok: false, error: `大纲节点不存在，无法绑定：${outlineItemId}` }
  }
  const volumeId = await ensureOutlineVolume(
    projectId,
    outlineItem?.volume_id || stringField(payload, 'volumeId') || stringField(payload, 'volume_id')
  )

  const id = `chapter-${randomUUID()}`
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM chapters WHERE project_id = ? AND volume_id = ?')
    .get(projectId, volumeId) as { value: number } | undefined
  db.prepare(`
    INSERT INTO chapters (id, project_id, volume_id, outline_item_id, title, summary, status, word_target, content, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, volumeId, outlineItem?.id || '', title, summary, 'draft', wordTarget, content, Number(maxOrder?.value ?? -1) + 1)
  return { changeId: change.id, ok: true, entityId: id }
}

async function commitRelationship(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const fromId = stringField(payload, 'fromCharacterId') || stringField(payload, 'from_character_id')
  const toId = stringField(payload, 'toCharacterId') || stringField(payload, 'to_character_id')
  const type = stringField(payload, 'type')
  const description = stringField(payload, 'description')
  const intensityValue = Number(payload.intensity)
  const intensity = Number.isFinite(intensityValue) ? Math.min(100, Math.max(0, Math.round(intensityValue))) : -1
  if (!fromId || !toId || !type || !description || intensity < 0) {
    return { changeId: change.id, ok: false, error: '人物关系缺少合法字段' }
  }
  const endpoints = db.prepare(`
    SELECT COUNT(*) AS value FROM characters WHERE project_id = ? AND id IN (?, ?)
  `).get(projectId, fromId, toId) as { value: number }
  const expectedCount = fromId === toId ? 1 : 2
  if (Number(endpoints.value) !== expectedCount) {
    return { changeId: change.id, ok: false, error: '人物关系引用了不存在或不属于当前项目的人物' }
  }
  const now = new Date().toISOString()
  if (change.action === 'create') {
    const duplicate = db.prepare(`
      SELECT id FROM character_relationships
      WHERE project_id = ? AND from_character_id = ? AND to_character_id = ? AND TRIM(type) = ?
    `).get(projectId, fromId, toId, type) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '人物关系', `${fromId} → ${toId} (${type})`)
    const id = `relationship-${randomUUID()}`
    db.prepare(`
      INSERT INTO character_relationships (
        id, project_id, from_character_id, to_character_id, type, description, intensity, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, fromId, toId, type, description, intensity, now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }
  if (!change.entityId) return { changeId: change.id, ok: false, error: '人物关系 update 缺少 entityId' }
  const result = db.prepare(`
    UPDATE character_relationships
    SET from_character_id = ?, to_character_id = ?, type = ?, description = ?, intensity = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(fromId, toId, type, description, intensity, now, change.entityId, projectId)
  if (result.changes === 0) return { changeId: change.id, ok: false, error: `人物关系不存在：${change.entityId}` }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitOrganizationMembership(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const characterId = stringField(payload, 'characterId') || stringField(payload, 'character_id')
  const organizationId = stringField(payload, 'organizationId') || stringField(payload, 'organization_id')
  const role = stringField(payload, 'role')
  const notes = stringField(payload, 'notes')
  if (!characterId || !organizationId || !role) {
    return { changeId: change.id, ok: false, error: '组织成员归属缺少 characterId、organizationId 或 role' }
  }
  const character = db.prepare('SELECT id FROM characters WHERE id = ? AND project_id = ?')
    .get(characterId, projectId) as { id: string } | undefined
  const organization = db.prepare('SELECT id FROM organizations WHERE id = ? AND project_id = ?')
    .get(organizationId, projectId) as { id: string } | undefined
  if (!character || !organization) {
    return { changeId: change.id, ok: false, error: '组织成员归属引用了不存在或不属于当前项目的人物/组织' }
  }
  const now = new Date().toISOString()
  if (change.action === 'create') {
    const duplicate = db.prepare(`
      SELECT id FROM organization_memberships
      WHERE project_id = ? AND character_id = ? AND organization_id = ?
    `).get(projectId, characterId, organizationId) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '组织成员归属', `${characterId} @ ${organizationId}`)
    const id = `membership-${randomUUID()}`
    db.prepare(`
      INSERT INTO organization_memberships (
        id, project_id, character_id, organization_id, role, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, characterId, organizationId, role, notes, now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }
  if (!change.entityId) return { changeId: change.id, ok: false, error: '组织成员归属 update 缺少 entityId' }
  const result = db.prepare(`
    UPDATE organization_memberships
    SET character_id = ?, organization_id = ?, role = ?, notes = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(characterId, organizationId, role, notes, now, change.entityId, projectId)
  if (result.changes === 0) return { changeId: change.id, ok: false, error: `组织成员归属不存在：${change.entityId}` }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitInspiration(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const type = stringField(payload, 'type')
  const title = stringField(payload, 'title')
  const content = stringField(payload, 'content')
  const source = stringField(payload, 'source', 'ai')
  const tags = stringArrayField(payload, 'tags').slice(0, 8)
  if (!type || !title || !content || !['ai', 'manual'].includes(source)) {
    return { changeId: change.id, ok: false, error: '灵感卡片缺少合法字段' }
  }
  const now = new Date().toISOString()
  if (change.action === 'create') {
    const duplicate = db.prepare('SELECT id FROM inspiration_entries WHERE project_id = ? AND TRIM(title) = ?')
      .get(projectId, title) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '灵感卡片', title)
    const id = `inspiration-${randomUUID()}`
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM inspiration_entries WHERE project_id = ?')
      .get(projectId) as { value: number }
    db.prepare(`
      INSERT INTO inspiration_entries (
        id, project_id, type, title, content, tags_json, source, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, type, title, content, JSON.stringify(tags), source, Number(maxOrder.value) + 1, now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }
  if (!change.entityId) return { changeId: change.id, ok: false, error: '灵感 update 缺少 entityId' }
  const result = db.prepare(`
    UPDATE inspiration_entries
    SET type = ?, title = ?, content = ?, tags_json = ?, source = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(type, title, content, JSON.stringify(tags), source, now, change.entityId, projectId)
  if (result.changes === 0) return { changeId: change.id, ok: false, error: `灵感卡片不存在：${change.entityId}` }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitOutlineVolume(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const title = stringField(payload, 'title')
  const wordTarget = stringField(payload, 'wordTarget') || stringField(payload, 'word_target')
  const summary = stringField(payload, 'summary')
  if (!title || !wordTarget) return { changeId: change.id, ok: false, error: '分卷缺少 title 或 wordTarget' }
  if (change.action === 'create') {
    const duplicate = db.prepare('SELECT id FROM outline_volumes WHERE project_id = ? AND TRIM(title) = ?')
      .get(projectId, title) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '分卷', title)
    const id = `volume-${randomUUID()}`
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM outline_volumes WHERE project_id = ?')
      .get(projectId) as { value: number }
    db.prepare(`
      INSERT INTO outline_volumes (id, project_id, title, word_target, summary, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, wordTarget, summary, Number(maxOrder.value) + 1)
    return { changeId: change.id, ok: true, entityId: id }
  }
  if (!change.entityId) return { changeId: change.id, ok: false, error: '分卷 update 缺少 entityId' }
  const result = db.prepare(`
    UPDATE outline_volumes SET title = ?, word_target = ?, summary = ?
    WHERE id = ? AND project_id = ?
  `).run(title, wordTarget, summary, change.entityId, projectId)
  if (result.changes === 0) return { changeId: change.id, ok: false, error: `分卷不存在：${change.entityId}` }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitKnowledgeDocument(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const title = stringField(payload, 'title')
  const sourceType = stringField(payload, 'sourceType') || stringField(payload, 'source_type')
  const sourceLabel = stringField(payload, 'sourceLabel') || stringField(payload, 'source_label')
  const content = stringField(payload, 'content')
  const summary = stringField(payload, 'summary') || content.slice(0, 220)
  const keywords = stringArrayField(payload, 'keywords')
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata
    : {}
  const validSourceTypes = ['reference-summary', 'reference-chunk', 'workflow-document', 'canon-fact', 'chapter-summary']
  if (!title || !content || !validSourceTypes.includes(sourceType)) {
    return { changeId: change.id, ok: false, error: '知识文档缺少合法的 title、sourceType 或 content' }
  }
  if (sourceType === 'canon-fact' && sourceLabel === 'global-constraint') {
    return { changeId: change.id, ok: false, error: '项目约束请使用 stage_constraint 写回' }
  }
  const now = new Date().toISOString()
  if (change.action === 'create') {
    const duplicate = db.prepare(`
      SELECT id FROM knowledge_documents
      WHERE project_id = ? AND TRIM(title) = ? AND source_type = ? AND source_label = ?
    `).get(projectId, title, sourceType, sourceLabel) as { id: string } | undefined
    if (duplicate) return conflictResult(change, '知识文档', title)
    const id = `knowledge-${randomUUID()}`
    db.prepare(`
      INSERT INTO knowledge_documents (
        id, project_id, title, source_type, source_label, content, summary,
        keywords_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, sourceType, sourceLabel, content, summary, JSON.stringify(keywords), JSON.stringify(metadata), now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }
  if (!change.entityId) return { changeId: change.id, ok: false, error: '知识文档 update 缺少 entityId' }
  const existing = db.prepare(`
    SELECT id FROM knowledge_documents
    WHERE id = ? AND project_id = ?
      AND NOT (source_type = 'canon-fact' AND source_label = 'global-constraint')
  `).get(change.entityId, projectId) as { id: string } | undefined
  if (!existing) return { changeId: change.id, ok: false, error: `知识文档不存在或属于项目约束：${change.entityId}` }
  db.prepare(`
    UPDATE knowledge_documents
    SET title = ?, source_type = ?, source_label = ?, content = ?, summary = ?, keywords_json = ?, metadata_json = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(title, sourceType, sourceLabel, content, summary, JSON.stringify(keywords), JSON.stringify(metadata), now, change.entityId, projectId)
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitProjectMetadata(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  if (change.action !== 'update' || change.entityId !== projectId) {
    return { changeId: change.id, ok: false, error: '项目资料仅支持更新当前项目' }
  }
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const title = stringField(payload, 'title')
  const genre = stringField(payload, 'genre')
  const novelLength = stringField(payload, 'novelLength') || stringField(payload, 'novel_length')
  const targetPlatform = stringField(payload, 'targetPlatform') || stringField(payload, 'target_platform')
  const writingStylePresetId = stringField(payload, 'writingStylePresetId') || stringField(payload, 'writing_style_preset_id')
  const writingStylePrompt = stringField(payload, 'writingStylePrompt') || stringField(payload, 'writing_style_prompt')
  if (!title || !genre || !['short', 'long'].includes(novelLength)) {
    return { changeId: change.id, ok: false, error: '项目资料缺少合法的 title、genre 或 novelLength' }
  }
  const result = db.prepare(`
    UPDATE projects
    SET title = ?, genre = ?, novel_length = ?, target_platform = ?,
      writing_style_preset_id = ?, writing_style_prompt = ?, last_edited = ?
    WHERE id = ?
  `).run(title, genre, novelLength, targetPlatform, writingStylePresetId, writingStylePrompt, new Date().toISOString(), projectId)
  if (result.changes === 0) return { changeId: change.id, ok: false, error: `项目不存在：${projectId}` }
  return { changeId: change.id, ok: true, entityId: projectId }
}
