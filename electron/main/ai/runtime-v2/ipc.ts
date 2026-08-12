/**
 * Assistant Runtime v2 · IPC 层
 *
 * 注册 `characterarc:assistant:*` 命名空间下的全部通道。
 * 与旧的 `characterarc:ai:*` 并存互不影响，Phase 3 迁移完毕后合并。
 *
 * Phase 1 阶段：Session / Stage 类通道全部就绪；Turn 类通道需要
 * `resolveTurnExecutionPlan` + `commitChange` 依赖，由 Phase 2 注入。
 * 未注入时相关通道返回明确错误，不静默失败。
 */

import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  ASSISTANT_IPC_CHANNELS,
  type AgentCreateRequest,
  type AgentDeleteRequest,
  type AgentGetRequest,
  type AgentListRequest,
  type AgentUpdateRequest,
  type MemoryCreateRequest,
  type MemoryDeleteRequest,
  type MemoryListRequest,
  type AssistantEventPush,
  type AssistantSession,
  type StageAcceptRequest,
  type StageBindTargetRequest,
  type StageClearFinishedRequest,
  type StageCommitRequest,
  type StageRejectRequest,
  type StageRemoveRequest,
  type StagedChange,
  type SurfaceDefinition,
  type TurnEvent,
  type TurnCancelRequest,
  type TurnDeleteRequest,
  type TurnSendRequest,
  type TurnTruncateRequest,
  type TurnTruncateResult
} from '@shared/assistant-runtime'
import { presetAvatarDataUri } from '@shared/agent-avatars'
import { seedBuiltinAgents } from './agent-profile-store'
import type { AiTaskName, AppSettings } from '../shared-types'
import type { Tool } from '../agent/tools/types'
import { buildRunMeta } from '../runtime/run-meta'
import type { ConversationManager } from './conversation-manager'
import { stagedChangesStore, type StagedChangeCommitter } from './staged-changes-store'
import { AgentLoop, type AgentLoopRunResult, type ToolFactory } from './agent-loop'
import { configureRuntimeState, getSharedAgentStore, getSharedConversation, getSharedMemoryStore } from './state'
import type { EvidenceLedger } from './evidence-ledger'
import type { AssistantRuntimePlan } from './planner'

/** Phase 2 才注入的执行计划解析器：把 Surface + user request → prompt + tools。 */
export type ResolveTurnExecutionPlan = (params: {
  session: AssistantSession
  surface: SurfaceDefinition
  request: TurnSendRequest
}) => Promise<{
  systemPrompt: string
  /**
   * 工具集。可给静态数组或工厂函数——工厂会在 Turn 创建后收到 turnId 再构造，
   * 让 `stage_*` 工具能闭包捕获 turnId/sessionId。
   */
  tools: Tool[] | ToolFactory
  settings: AppSettings
  maxOutputTokens?: number
  runtimePlan: AssistantRuntimePlan
  evidenceLedger: EvidenceLedger
}>

/** 外部依赖注入。 */
export interface AssistantIpcDeps {
  /** 惰性拿到 workspace db。首次调用时会 ensure schema。 */
  ensureDb: () => Promise<DatabaseSync>
  /** Phase 2 注入。缺省时 turn 相关通道拒绝服务。 */
  resolveTurnExecutionPlan?: ResolveTurnExecutionPlan
  /** Phase 2 注入。缺省时 stage:commit 通道拒绝服务。 */
  commitChange?: StagedChangeCommitter
  /** 可选：把 v2 turn 记录到既有 AI 运行日志。 */
  emitAiRunEvent?: (payload: { projectId: string; meta: Record<string, unknown> }) => void
}

// ============================================================================
// 模块状态
// ============================================================================

let deps: AssistantIpcDeps | null = null

/** 每个 in-flight turn 的 AbortController，用于 TURN_CANCEL。 */
interface ActiveTurn {
  controller: AbortController
  sessionId: string
}

const activeTurns = new Map<string, ActiveTurn>()

/**
 * 惰性拿到 ConversationManager 单例。委托给 runtime-v2/state.ts 的共享实例。
 * committer / provider / plan 等模块可通过 `getSharedConversation` 拿同一份。
 */
export async function getConversation(): Promise<ConversationManager> {
  return getSharedConversation()
}

/** 抛清晰错误：Phase 2 依赖未注入。 */
function requireDep<K extends keyof AssistantIpcDeps>(
  key: K
): NonNullable<AssistantIpcDeps[K]> {
  const value = deps?.[key]
  if (!value) {
    throw new Error(
      `[Assistant Runtime v2] dependency "${String(key)}" not injected yet. ` +
        `This channel becomes available after Phase 2 wiring.`
    )
  }
  return value as NonNullable<AssistantIpcDeps[K]>
}

function taskForSurface(surface: SurfaceDefinition): AiTaskName {
  return surface.id === 'chapter-panel' || surface.id === 'inline-selection'
    ? 'chapter-assistant'
    : 'global-assistant'
}

function chapterIdFromScope(scopeRef?: string): string | undefined {
  const ref = String(scopeRef ?? '').trim()
  if (!ref) return undefined
  const match = ref.match(/chapter:([^#]+)/)
  if (match?.[1]) return match[1]
  return ref.startsWith('chapter-') ? ref : undefined
}

function runStatusFromTurn(status: AgentLoopRunResult['status']): 'running' | 'success' | 'error' | 'canceled' {
  if (status === 'done') return 'success'
  if (status === 'error' || status === 'canceled') return status
  return 'running'
}

function emitTurnRunLog(params: {
  session: AssistantSession
  surface: SurfaceDefinition
  request: TurnSendRequest
  settings: AppSettings
  startedAt: string
  result: AgentLoopRunResult
}): void {
  const emit = deps?.emitAiRunEvent
  if (!emit) return
  const finishedAt = new Date().toISOString()
  const meta = buildRunMeta(
    taskForSurface(params.surface),
    params.session.projectId,
    chapterIdFromScope(params.request.scopeRef ?? params.session.scopeRef),
    params.settings,
    runStatusFromTurn(params.result.status),
    params.startedAt,
    finishedAt,
    params.result.usage,
    [],
    [],
    false,
    params.result.finalText || params.result.error || params.request.userMessage,
    params.result.error ?? '',
    `assistant-v2:${params.surface.id}:${params.session.id}`
  )
  emit({
    projectId: params.session.projectId,
    meta: {
      id: randomUUID(),
      ...meta,
      toolCalls: params.result.toolCalls,
      agentIterations: params.result.agentIterations
    }
  })
}

function shouldOfferContinuation(
  runtimePlan: AssistantRuntimePlan,
  ledger: ReturnType<EvidenceLedger['snapshot']>,
  result: AgentLoopRunResult
): boolean {
  return result.status === 'done' && (runtimePlan.requiresBatching || ledger.budgetExhausted)
}

function persistTurnRuntimeState(params: {
  conversation: ConversationManager
  sessionId: string
  turnId: string
  runtimePlan: AssistantRuntimePlan
  ledger: ReturnType<EvidenceLedger['snapshot']>
  resumable: boolean
}): void {
  params.conversation.upsertTurnState({
    turnId: params.turnId,
    sessionId: params.sessionId,
    phase: params.resumable ? 'awaiting-continue' : 'done',
    planJson: JSON.stringify(params.runtimePlan),
    ledgerJson: JSON.stringify(params.ledger),
    resumable: params.resumable,
    continuationPrompt: params.resumable ? params.runtimePlan.continuationPrompt : ''
  })
}

function appendRuntimeEvent(
  conversation: ConversationManager,
  push: (evt: AssistantEventPush) => void,
  sessionId: string,
  turnId: string,
  event: TurnEvent
): void {
  const persisted = conversation.appendEvent(turnId, event)
  push({
    sessionId,
    turnId,
    event: { ...event, seq: persisted.seq } as TurnEvent
  })
}

// ============================================================================
// 注册入口
// ============================================================================

export function registerAssistantIpcHandlers(injected: AssistantIpcDeps): void {
  deps = injected
  configureRuntimeState(injected.ensureDb)
  registerSessionHandlers()
  registerTurnHandlers()
  registerStageHandlers()
  registerAgentHandlers()
  registerMemoryHandlers()
}

// ============================================================================
// Session handlers
// ============================================================================

interface SessionListRequest {
  projectId: string
  surfaceId?: string
  scopeRef?: string
  limit?: number
}
interface SessionCreateRequest {
  projectId: string
  surfaceId: string
  scopeRef?: string
  title: string
}
interface SessionDeleteRequest { sessionId: string }
interface SessionLoadRequest { sessionId: string; withReplay?: boolean }
interface SessionRenameRequest { sessionId: string; title: string }
interface SessionRestoreRequest {
  id?: string
  projectId: string
  surfaceId: string
  scopeRef?: string
  title: string
  createdAt?: string
  updatedAt?: string
  turns?: unknown[]
  events?: unknown[]
}

function registerSessionHandlers(): void {
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_LIST,
    async (_event, payload: SessionListRequest) => {
      const cm = await getConversation()
      return cm.listSessions({
        projectId: payload.projectId,
        surfaceId: payload.surfaceId as never,
        scopeRef: payload.scopeRef,
        limit: payload.limit
      })
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_CREATE,
    async (_event, payload: SessionCreateRequest) => {
      const cm = await getConversation()
      return cm.createSession({
        projectId: payload.projectId,
        surfaceId: payload.surfaceId as never,
        scopeRef: payload.scopeRef,
        title: payload.title
      })
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_DELETE,
    async (_event, payload: SessionDeleteRequest) => {
      const cm = await getConversation()
      cm.deleteSession(payload.sessionId)
      stagedChangesStore.clearSession(payload.sessionId)
      return { ok: true }
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_LOAD,
    async (_event, payload: SessionLoadRequest) => {
      const cm = await getConversation()
      const session = cm.getSession(payload.sessionId)
      if (!session) return { session: null, turns: [], events: [] }
      const turns = cm.listTurns(payload.sessionId)
      // withReplay=true 时把每个 turn 的完整事件流也一起返回，供前端还原状态
      const events = payload.withReplay
        ? turns.flatMap((t) => cm.listEvents(t.id))
        : []
      return { session, turns, events }
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_RENAME,
    async (_event, payload: SessionRenameRequest) => {
      const cm = await getConversation()
      cm.renameSession(payload.sessionId, payload.title)
      return { ok: true }
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.SESSION_RESTORE,
    async (_event, payload: SessionRestoreRequest) => {
      const cm = await getConversation()
      return cm.restoreSession({
        id: payload.id,
        projectId: payload.projectId,
        surfaceId: payload.surfaceId as never,
        scopeRef: payload.scopeRef,
        title: payload.title,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        turns: payload.turns as never,
        events: payload.events as never
      })
    }
  )
}

// ============================================================================
// Turn handlers（含流式事件推送）
// ============================================================================

/**
 * 把引用附件（章节/分卷）展开为一段上下文块，追加到用户消息末尾，
 * 让模型直接拿到被引用章节/分卷的正文，而不用依赖工具按需读取。
 */
async function expandAttachmentReferences(
  payload: TurnSendRequest,
  userMessage: string
): Promise<string> {
  const attachments = payload.attachments
  if (!attachments || attachments.length === 0) return userMessage
  const session = (await getConversation()).getSession(payload.sessionId)
  if (!session) return userMessage
  const db = await requireDep('ensureDb')()

  const blocks: string[] = []
  const seen = new Set<string>()

  for (const att of attachments) {
    const [kind, id] = String(att.ref ?? '').split(':', 2)
    if (!id || seen.has(`${kind}:${id}`)) continue
    seen.add(`${kind}:${id}`)

    if (kind === 'chapter') {
      const row = db
        .prepare(
          `SELECT title, content FROM chapters WHERE id = ? AND project_id = ?`
        )
        .get(id, session.projectId) as { title: string; content: string } | undefined
      if (!row) continue
      const body = String(row.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (!body) continue
      blocks.push(`【引用章节《${row.title}》】\n${body.slice(0, 4000)}`)
    } else if (kind === 'volume') {
      // 分卷：把该卷下所有章节正文拼接
      const rows = db
        .prepare(
          `SELECT title, content FROM chapters WHERE volume_id = ? AND project_id = ? ORDER BY sort_order`
        )
        .all(id, session.projectId) as Array<{ title: string; content: string }>
      if (rows.length === 0) continue
      const parts = rows.map((r) => {
        const body = String(r.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        return body ? `《${r.title}》：${body.slice(0, 1200)}` : ''
      }).filter(Boolean)
      if (parts.length === 0) continue
      blocks.push(`【引用分卷 ${rows.length} 章】\n${parts.join('\n\n')}`)
    } else if (kind === 'file') {
      // 上传文件：直接使用内联 content（若为空则给出占位说明）。
      const content = typeof att.content === 'string' && att.content.trim()
        ? att.content.slice(0, 60000)
        : ''
      const name = att.label || att.ref.replace(/^file:/, '') || '上传文件'
      blocks.push(
        `【上传文件：${name}】` +
        (content ? `\n${content}` : '\n（文件内容为空或为二进制格式，无法以文本直接携带。如有需要请告诉我文件里应包含的内容。）')
      )
    }
  }

  if (blocks.length === 0) return userMessage
  return `${userMessage}\n\n以下是被引用的章节/分卷内容，供你参考（无需重复调用读取工具）：\n\n${blocks.join('\n\n---\n\n')}`
}

function registerTurnHandlers(): void {
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.TURN_SEND,
    async (event, payload: TurnSendRequest) => {
      const controller = new AbortController()
      const activeKeys = new Set<string>()
      const registerActiveKey = (key?: string): void => {
        if (!key) return
        activeTurns.set(key, { controller, sessionId: payload.sessionId })
        activeKeys.add(key)
      }
      registerActiveKey(payload.clientRequestId)

      try {
        const resolvePlan = requireDep('resolveTurnExecutionPlan')
        const cm = await getConversation()
        const session = cm.getSession(payload.sessionId)
        if (!session) throw new Error(`session not found: ${payload.sessionId}`)
        const startedAt = new Date().toISOString()

        // 组装执行计划（Phase 2 实现），拿到 systemPrompt + tools + settings
        const plan = await resolvePlan({
          session,
          surface: payload.surface,
          request: payload
        })

        // 展开引用附件（章节/分卷）的正文到用户消息，供模型直接参考
        const expandedUserMessage = await expandAttachmentReferences(payload, payload.userMessage)

        // Emitter：把 TurnEvent 通过 EVENT_STREAM 通道 push 到发起方 window
        const emitter = (evt: AssistantEventPush): void => {
          try {
            event.sender.send(ASSISTANT_IPC_CHANNELS.EVENT_STREAM, evt)
          } catch {
            // renderer 已销毁则忽略
          }
        }

        const loop = new AgentLoop(cm, stagedChangesStore, emitter)
        const result = await loop.run({
          session,
          surface: payload.surface,
          turnInput: {
            userMessage: expandedUserMessage,
            intentHint: payload.intentHint,
            attachments: payload.attachments
          },
          systemPrompt: plan.systemPrompt,
          tools: plan.tools,
          settings: plan.settings,
          signal: controller.signal,
          maxSteps: payload.surface.maxSteps,
          maxOutputTokens: plan.maxOutputTokens,
          onTurnCreated: registerActiveKey
        })
        const ledgerSnapshot = plan.evidenceLedger.snapshot()
        const resumable = shouldOfferContinuation(plan.runtimePlan, ledgerSnapshot, result)
        persistTurnRuntimeState({
          conversation: cm,
          sessionId: session.id,
          turnId: result.turnId,
          runtimePlan: plan.runtimePlan,
          ledger: ledgerSnapshot,
          resumable
        })
        if (resumable) {
          appendRuntimeEvent(cm, emitter, session.id, result.turnId, {
            kind: 'resumable',
            seq: 0,
            label: plan.runtimePlan.continuationLabel,
            prompt: plan.runtimePlan.continuationPrompt,
            reason: ledgerSnapshot.budgetExhausted
              ? '本批读取预算已用完，建议进入下一批。'
              : '这是分批任务，建议按下一批继续推进。'
          })
        }
        emitTurnRunLog({
          session,
          surface: payload.surface,
          request: payload,
          settings: plan.settings,
          startedAt,
          result
        })
        return result
      } finally {
        for (const key of activeKeys) {
          if (activeTurns.get(key)?.controller === controller) activeTurns.delete(key)
        }
      }
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.TURN_CANCEL,
    async (_event, payload: TurnCancelRequest) => {
      const active = activeTurns.get(payload.turnId)
      if (!active) return { ok: false, reason: 'turn not active or already finished' }
      active.controller.abort()
      activeTurns.delete(payload.turnId)
      return { ok: true }
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.TURN_DELETE,
    async (_event, payload: TurnDeleteRequest) => {
      const cm = await getConversation()
      cm.deleteTurn(payload.sessionId, payload.turnId)
      stagedChangesStore.clearSession(payload.sessionId)
      return { ok: true }
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.TURN_TRUNCATE,
    async (_event, payload: TurnTruncateRequest): Promise<TurnTruncateResult> => {
      const hasActiveTurn = Array.from(activeTurns.values()).some(
        (active) => active.sessionId === payload.sessionId
      )
      if (hasActiveTurn) throw new Error('请先停止当前生成，再撤回或编辑历史对话。')

      const cm = await getConversation()
      const result = cm.truncateFrom(payload.sessionId, payload.fromTurnId)
      const staged = stagedChangesStore.clearTurns(result.removedTurnIds)
      return {
        ...result,
        discardedStaged: staged.discarded,
        keptCommitted: staged.keptCommitted
      }
    }
  )
}

// ============================================================================
// Stage handlers
// ============================================================================

interface StageListRequest {
  sessionId?: string
  status?: readonly string[]
  kind?: readonly string[]
  turnId?: string
}

function registerStageHandlers(): void {
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_LIST,
    async (_event, payload: StageListRequest) => {
      await getConversation()
      return stagedChangesStore.list(
        {
          status: payload.status as never,
          kind: payload.kind as never,
          turnId: payload.turnId
        },
        payload.sessionId
      )
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_ACCEPT,
    async (_event, payload: StageAcceptRequest) => {
      await getConversation()
      return stagedChangesStore.accept(payload.changeIds)
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_REJECT,
    async (_event, payload: StageRejectRequest) => {
      await getConversation()
      const rejected = stagedChangesStore.reject(payload.changeIds)
      // 学习闭环：用户拒绝了暂存变更 → 把"这次方向不对"沉淀为教训记忆。
      await captureRejectionMemories(rejected)
      return rejected
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_BIND_TARGET,
    async (_event, payload: StageBindTargetRequest) => {
      await getConversation()
      const updated = stagedChangesStore.bindTarget(payload.changeId, payload.entityId)
      return updated ?? null
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_COMMIT,
    async (_event, payload: StageCommitRequest) => {
      await getConversation()
      const committer = requireDep('commitChange')
      if ((!payload.changeIds || payload.changeIds.length === 0) && !payload.sessionId) {
        throw new Error('stage commit requires sessionId when changeIds is omitted')
      }
      return stagedChangesStore.commit(committer, {
        sessionId: payload.sessionId,
        changeIds: payload.changeIds
      })
    }
  )

  // 批量硬删除暂存变更（清理已提交/已忽略，或用户主动移除单条）
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_REMOVE,
    async (_event, payload: StageRemoveRequest) => {
      await getConversation()
      return stagedChangesStore.removeMany(payload.changeIds)
    }
  )

  // 清理已提交与已忽略的变更，保持暂存区列表清爽
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.STAGE_CLEAR_FINISHED,
    async (_event, payload: StageClearFinishedRequest) => {
      await getConversation()
      return stagedChangesStore.clearFinished(payload?.sessionId)
    }
  )
}

// ============================================================================
// Agent（智能体）handlers
// ============================================================================

/**
 * 注册智能体 CRUD 通道。
 * 首次访问时确保内置智能体已 seed。
 */
function registerAgentHandlers(): void {
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.AGENT_LIST,
    async (_event, payload: AgentListRequest) => {
      const store = await getSharedAgentStore()
      return store.list({
        builtinOnly: payload?.builtinOnly ?? false,
        scope: payload?.scope,
        projectId: payload?.projectId
      })
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.AGENT_GET,
    async (_event, payload: AgentGetRequest) => {
      const store = await getSharedAgentStore()
      return store.get(payload.id)
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.AGENT_CREATE,
    async (_event, payload: AgentCreateRequest) => {
      const store = await getSharedAgentStore()
      return store.create({
        name: payload.name,
        description: payload.description,
        systemPrompt: payload.systemPrompt,
        avatar: payload.avatar,
        avatarType: payload.avatarType,
        presetIndex: payload.presetIndex,
        scope: payload.scope,
        projectId: payload.projectId,
        skillIds: payload.skillIds
      })
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.AGENT_UPDATE,
    async (_event, payload: AgentUpdateRequest) => {
      const store = await getSharedAgentStore()
      return store.update(payload.id, {
        name: payload.name,
        description: payload.description,
        systemPrompt: payload.systemPrompt,
        avatar: payload.avatar,
        avatarType: payload.avatarType,
        presetIndex: payload.presetIndex,
        scope: payload.scope,
        projectId: payload.projectId,
        skillIds: payload.skillIds
      })
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.AGENT_DELETE,
    async (_event, payload: AgentDeleteRequest) => {
      const store = await getSharedAgentStore()
      return { ok: store.delete(payload.id) }
    }
  )
}

// ============================================================================
// 创作记忆（Agent Memory / 学习闭环）handlers
// ============================================================================

function registerMemoryHandlers(): void {
  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.MEMORY_LIST,
    async (_event, payload: MemoryListRequest) => {
      const store = await getSharedMemoryStore()
      return store.list(payload.projectId, payload.limit)
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.MEMORY_CREATE,
    async (_event, payload: MemoryCreateRequest) => {
      const store = await getSharedMemoryStore()
      return store.create({
        projectId: payload.projectId,
        kind: payload.kind,
        content: payload.content,
        source: payload.source,
        importance: payload.importance,
        sourceTurnId: payload.sourceTurnId
      })
    }
  )

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.MEMORY_DELETE,
    async (_event, payload: MemoryDeleteRequest) => {
      const store = await getSharedMemoryStore()
      return { ok: store.remove(payload.id, payload.projectId) }
    }
  )
}

/**
 * 学习闭环：把被用户拒绝的暂存变更沉淀为"教训"记忆。
 *
 * 用户拒绝 = 强信号，说明智能体这次的改法/方向不合意。把变更的
 * 目标实体与失败原因记成一条 lesson，后续 turn 会自动召回，避免重复犯错。
 */
async function captureRejectionMemories(rejected: StagedChange[]): Promise<void> {
  for (const change of rejected) {
    const cm = await getConversation()
    const session = cm.getSession(change.sessionId)
    if (!session) continue

    const store = await getSharedMemoryStore()
    const kindLabel = change.kind
    const content = [
      `用户拒绝了智能体对「${change.entityTitle}」的${kindLabel}变更（操作：${change.action}）。`,
      `智能体的理由/改法：${change.reason}`,
      '请后续避免重蹈覆辙：除非用户再次明确要求，不要以同样的方向再次修改该项目标。'
    ].join('\n')

    store.create({
      projectId: session.projectId,
      kind: 'lesson',
      content,
      source: 'system',
      importance: 4,
      sourceTurnId: change.turnId
    })
  }
}
