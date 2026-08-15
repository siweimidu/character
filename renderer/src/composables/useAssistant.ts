/**
 * useAssistant · Runtime v2 通用 composable
 *
 * 取代旧的 useGlobalAssistant / useChapterAi 双套实现。所有 Surface（global-page /
 * chapter-panel / inline-selection）共享同一份 composable，通过 SurfaceDefinition 区分行为。
 *
 * 完全绕开 appStore.messages / globalAssistantSessions —— 消息、会话、暂存变更
 * 全部由 Runtime v2 IPC 提供，前端只做响应式转换和渲染。
 */

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import type {
  AssistantEventPush,
  AssistantSession,
  AssistantTurn,
  PersistedTurnEvent,
  StagedChange,
  SurfaceDefinition,
  SurfaceId,
  TurnAttachment,
  TurnEvent,
  TurnTruncateResult
} from '@shared/assistant-runtime'

// ============================================================================
// UI 消息模型
// ============================================================================

export interface AssistantToolCallView {
  toolUseId: string
  toolName: string
  args: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  resultPreview?: string
  durationMs?: number
}

export type AssistantMessageBlock =
  | {
      id: string
      kind: 'reasoning' | 'assistant'
      content: string
    }
  | {
      id: string
      kind: 'commands'
      commands: AssistantToolCallView[]
    }
  | {
      id: string
      kind: 'staged'
      changeIds: string[]
    }

export interface AssistantMessageView {
  turnId: string
  userMessage: string
  assistantMessage: string
  reasoning: string
  toolCalls: AssistantToolCallView[]
  flowBlocks: AssistantMessageBlock[]
  stagedChangeIds: string[]
  resumable?: {
    label: string
    prompt: string
    reason?: string
  }
  status: 'streaming' | 'done' | 'canceled' | 'error'
  error?: string
  activityText?: string
  createdAt: string
}

// ============================================================================
// composable
// ============================================================================

export interface UseAssistantOptions {
  /** 项目 ID。响应式引用；切项目时会自动刷新会话列表。 */
  projectId: () => string
  /** 该 Surface 的声明。 */
  surface: SurfaceDefinition
  /** 上下文锚点，如 'chapter:cha_042'；切换章节时会刷新。 */
  scopeRef?: () => string | undefined
}

export interface AssistantSendOptions {
  intentHint?: string
  attachments?: TurnAttachment[]
  /** 智能体 ID。不传时使用当前会话绑定的智能体。 */
  agentId?: string
  /** 智能体作用范围：'local' 项目局部智能体 / 'global' 全局智能体。缺省由 Runtime 决定。 */
  agentScope?: 'local' | 'global'
  /** 局部智能体归属项目（每项目/小说隔离）。缺省取 options.projectId()。 */
  agentProjectId?: string
  /** 全局智能体「文件区」工作目录（绝对路径）。设置后对话产物默认保存到该目录。 */
  fileAreaPath?: string
}

export function useAssistant(options: UseAssistantOptions) {
  const A = window.characterArc.assistant
  const appStore = useAppStore()

  // 会话存储作用域：chapter-panel / inline-selection 等章节级 Surface 也共享同一个项目级
  // 会话，保证用户在不同分卷/章节之间切换时右侧智能体始终是同一个对话。
  // 章节上下文（current-chapter provider）仍通过 turn 的 scopeRef 单独传入，不受影响。
  const isChapterSurface =
    options.surface.id === 'chapter-panel' || options.surface.id === 'inline-selection'
  const sessionScopeRef = (): string | undefined => (isChapterSurface ? undefined : options.scopeRef?.())
  // 会话存储统一的 surface：章节创作等入口与项目工作台智能体共用同一份项目级会话历史，
  // 保证「章节创作里的对话」与「项目工作台里的智能体对话」完全同步。
  const sessionSurfaceId: SurfaceId = isChapterSurface ? 'global-page' : options.surface.id

  // === 会话 ===
  const sessions = ref<AssistantSession[]>([])
  const activeSessionId = ref<string | null>(null)
  /**
   * 尚未写入历史的新建对话（草稿会话）。
   * 用户点「新建对话」后先只在前端生成，不持久化、不进入历史列表；
   * 只有当真正向 AI 发送了第一条消息时才写入后端并加入历史。
   */
  const draftSession = ref<AssistantSession | null>(null)
  const activeSession = computed(() =>
    draftSession.value && draftSession.value.id === activeSessionId.value
      ? draftSession.value
      : (sessions.value.find((s) => s.id === activeSessionId.value) ?? null)
  )

  // === Turn 序列 + 事件流 ===
  const turns = shallowRef<AssistantTurn[]>([])
  // 每个 turn 累积的事件；用于 replay 和消息 view 计算
  const eventsByTurn = shallowRef<Map<string, TurnEvent[]>>(new Map())

  // === Streaming 状态 ===
  const streamingTurnId = ref<string | null>(null)
  const isStreaming = computed(() => streamingTurnId.value !== null)
  /** 是否存在真实活跃的流式生成（streamingTurnId 残留但 turns 里无 streaming 轮次时视为已结束）。 */
  function hasLiveStreaming(): boolean {
    return isStreaming.value && turns.value.some((t) => t.status === 'streaming')
  }
  const isCanceling = ref(false)

  // 流式生成时已累积的 assistant 文字数（用于 Composer 进度提示）
  const streamingCharCount = computed(() => {
    if (!streamingTurnId.value) return 0
    const events = eventsByTurn.value.get(streamingTurnId.value) ?? []
    return events.reduce((sum, e) => (e.kind === 'chunk' ? sum + (e.delta?.length ?? 0) : sum), 0)
  })

  // === 初始化加载状态 ===
  const isInitializing = ref(true)

  // === 暂存变更 ===
  const stagedChanges = ref<StagedChange[]>([])
  const pendingStaged = computed(() =>
    stagedChanges.value.filter((c) => c.status === 'pending' || c.status === 'streaming')
  )
  const acceptedStaged = computed(() =>
    stagedChanges.value.filter((c) => c.status === 'accepted')
  )

  // === Composer ===
  const composerValue = ref('')
  const editingTurnId = ref<string | null>(null)
  const editingDraft = ref('')
  const restoredDraftLabel = ref('')
  const isTruncating = ref(false)
  /** 每个 turn 发送时所携带的意图（如 global-assistant-v2:standard），用于撤回/回退时恢复对话框模式状态。 */
  const turnIntentMap = new Map<string, string>()
  /** 撤回/回退后需要恢复的意图（供 Composer 还原「标准模式」等模式芯片）。 */
  const restoredIntentHint = ref<string | null>(null)

  // === 待发送的引用附件（章节/分卷/Skill），以可叉掉的芯片显示在输入框内 ===
  const pendingAttachments = ref<TurnAttachment[]>([])

  function addPendingAttachment(att: TurnAttachment): void {
    // 同一引用不重复添加
    if (pendingAttachments.value.some((a) => a.kind === att.kind && a.ref === att.ref)) return
    pendingAttachments.value = [...pendingAttachments.value, att]
  }

  /** 更新某个待发送附件（如后台加载完文件内容/保存路径后回填）。 */
  function updatePendingAttachment(refKey: string, patch: Partial<Omit<TurnAttachment, 'kind' | 'ref'>>): void {
    pendingAttachments.value = pendingAttachments.value.map((a) =>
      `${a.kind}:${a.ref}` === refKey ? { ...a, ...patch } : a
    )
  }

  function removePendingAttachment(refKey: string): void {
    pendingAttachments.value = pendingAttachments.value.filter((a) => `${a.kind}:${a.ref}` !== refKey)
  }

  function clearPendingAttachments(): void {
    pendingAttachments.value = []
  }

  // === 错误 ===
  const lastError = ref<string | null>(null)

  // ==========================================================================
  // 事件 → 消息 view 转换
  // ==========================================================================

  /** 从事件序列中折叠出 assistant 文本、reasoning、工具调用。 */
  function foldTurnEvents(events: TurnEvent[]): {
    assistantMessage: string
    reasoning: string
    toolCalls: AssistantToolCallView[]
    flowBlocks: AssistantMessageBlock[]
    stagedChangeIds: string[]
    resumable?: AssistantMessageView['resumable']
    finalError?: string
    activityText?: string
  } {
    let assistantMessage = ''
    let reasoning = ''
    const toolCalls: AssistantToolCallView[] = []
    const flowBlocks: AssistantMessageBlock[] = []
    const toolById = new Map<string, AssistantToolCallView>()
    const stagedChangeIds: string[] = []
    let resumable: AssistantMessageView['resumable']
    let finalError: string | undefined
    let activityText: string | undefined
    let forceNewCommandBlock = false

    function appendTextBlock(kind: 'reasoning' | 'assistant', seq: number, delta: string): void {
      forceNewCommandBlock = false
      const last = flowBlocks[flowBlocks.length - 1]
      if (last?.kind === kind) {
        last.content += delta
        return
      }
      flowBlocks.push({
        id: `${kind}-${seq}`,
        kind,
        content: delta
      })
    }

    function appendCommand(call: AssistantToolCallView, seq: number): void {
      const last = flowBlocks[flowBlocks.length - 1]
      if (last?.kind === 'commands' && !forceNewCommandBlock) {
        last.commands.push(call)
        forceNewCommandBlock = false
        return
      }
      flowBlocks.push({
        id: `commands-${seq}`,
        kind: 'commands',
        commands: [call]
      })
      forceNewCommandBlock = false
    }

    function appendStaged(changeId: string, seq: number): void {
      const last = flowBlocks[flowBlocks.length - 1]
      if (last?.kind === 'staged') {
        if (!last.changeIds.includes(changeId)) last.changeIds.push(changeId)
        return
      }
      flowBlocks.push({ id: `staged-${seq}`, kind: 'staged', changeIds: [changeId] })
    }

    function normalizeActivity(message: string): string {
      const normalized = message.trim()
      if (/整理最终答案/.test(normalized)) return '整理回复'
      if (/第\s*\d+\s*轮推理/.test(normalized)) return '核对资料与工具结果'
      if (/思考|分析/.test(normalized)) return '分析请求'
      return normalized.replace(/[.。…]+$/, '') || '处理中'
    }

    for (const evt of events) {
      switch (evt.kind) {
        case 'chunk':
          assistantMessage += evt.delta
          appendTextBlock('assistant', evt.seq, evt.delta)
          break
        case 'reasoning':
          reasoning += evt.delta
          appendTextBlock('reasoning', evt.seq, evt.delta)
          break
        case 'tool_use_start': {
          const call: AssistantToolCallView = {
            toolUseId: evt.toolUseId,
            toolName: evt.toolName,
            args: evt.args,
            status: 'running'
          }
          toolCalls.push(call)
          toolById.set(evt.toolUseId, call)
          appendCommand(call, evt.seq)
          break
        }
        case 'tool_result': {
          const existing = toolById.get(evt.toolUseId)
          if (existing) {
            existing.status = evt.isError ? 'error' : 'ok'
            existing.resultPreview = evt.content.slice(0, 200)
            existing.durationMs = evt.durationMs
          }
          break
        }
        case 'staged_change':
          if (!stagedChangeIds.includes(evt.changeId)) stagedChangeIds.push(evt.changeId)
          appendStaged(evt.changeId, evt.seq)
          break
        case 'resumable':
          if (options.surface.scope === 'project') break
          resumable = {
            label: evt.label,
            prompt: evt.prompt,
            reason: evt.reason
          }
          break
        case 'agent_status': {
          const last = flowBlocks[flowBlocks.length - 1]
          if (last?.kind === 'commands') forceNewCommandBlock = true
          activityText = normalizeActivity(evt.message)
          break
        }
        case 'done':
          if (evt.content && !assistantMessage) {
            assistantMessage = evt.content
            appendTextBlock('assistant', evt.seq, evt.content)
          }
          break
        case 'error':
          finalError = evt.error
          break
        default:
          break
      }
    }

    return { assistantMessage, reasoning, toolCalls, flowBlocks, stagedChangeIds, resumable, finalError, activityText }
  }

  const messages = computed<AssistantMessageView[]>(() => {
    return turns.value.map((turn) => {
      const events = eventsByTurn.value.get(turn.id) ?? []
      const folded = foldTurnEvents(events)
      const assistantMessage = folded.assistantMessage || turn.assistantMessage
      const status = turn.status === 'streaming' && streamingTurnId.value !== turn.id
        ? 'canceled'
        : turn.status
      const flowBlocks = folded.flowBlocks.length > 0
        ? folded.flowBlocks
        : assistantMessage
          ? [{ id: `assistant-${turn.id}`, kind: 'assistant' as const, content: assistantMessage }]
          : []
      return {
        turnId: turn.id,
        userMessage: turn.userMessage,
        assistantMessage,
        reasoning: folded.reasoning,
        toolCalls: folded.toolCalls,
        flowBlocks,
        stagedChangeIds: folded.stagedChangeIds,
        resumable: folded.resumable,
        status,
        error: folded.finalError,
        activityText: status === 'streaming' ? folded.activityText : undefined,
        createdAt: turn.createdAt
      }
    })
  })

  // ==========================================================================
  // 事件订阅
  // ==========================================================================

  /** 把 PersistedTurnEvent（含 payloadJson）转成 TurnEvent 结构。 */
  function persistedToEvent(p: PersistedTurnEvent): TurnEvent {
    try {
      return JSON.parse(p.payloadJson) as TurnEvent
    } catch {
      return { kind: p.kind, seq: p.seq } as TurnEvent
    }
  }

  function appendEventToTurn(turnId: string, event: TurnEvent): void {
    const map = new Map(eventsByTurn.value)
    const list = [...(map.get(turnId) ?? [])]
    appendCoalescedEvent(list, event)
    map.set(turnId, list)
    eventsByTurn.value = map
  }

  /** 合并相邻文本事件，避免长回复按 token 累积成数千个响应式节点。 */
  function appendCoalescedEvent(list: TurnEvent[], event: TurnEvent): void {
    const last = list[list.length - 1]
    if (last?.kind === 'chunk' && event.kind === 'chunk') {
      list[list.length - 1] = { ...last, delta: last.delta + event.delta }
      return
    }
    if (last?.kind === 'reasoning' && event.kind === 'reasoning') {
      list[list.length - 1] = { ...last, delta: last.delta + event.delta }
      return
    }
    list.push(event)
  }

  const unsubscribe = A.onEvent((push: AssistantEventPush) => {
    if (push.sessionId !== activeSessionId.value) return

    // 首次遇到真实 turnId 时：把乐观 turn 替换为真实 placeholder，让后续
    // chunk 事件能挂到正确的 turn 上，UI 才能实时渲染流式内容。
    const knownTurn = turns.value.find((t) => t.id === push.turnId)
    if (!knownTurn) {
      const optimisticIdx = turns.value.findIndex((t) => t.id.startsWith('optimistic-'))
      const optimisticTurnId = optimisticIdx >= 0 ? turns.value[optimisticIdx].id : null
      const userMessage = optimisticIdx >= 0 ? turns.value[optimisticIdx].userMessage : ''
      // 乐观 turn 已确认为真实 turnId：把记录的意图一并转移，供后续撤回时恢复模式
      if (optimisticTurnId && turnIntentMap.has(optimisticTurnId)) {
        turnIntentMap.set(push.turnId, turnIntentMap.get(optimisticTurnId)!)
        turnIntentMap.delete(optimisticTurnId)
      }
      const placeholder: AssistantTurn = {
        id: push.turnId,
        sessionId: push.sessionId,
        userMessage,
        assistantMessage: '',
        status: 'streaming',
        createdAt: new Date().toISOString()
      }
      if (optimisticIdx >= 0) {
        const arr = [...turns.value]
        arr[optimisticIdx] = placeholder
        turns.value = arr
      } else {
        turns.value = [...turns.value, placeholder]
      }
      streamingTurnId.value = push.turnId
    }

    appendEventToTurn(push.turnId, push.event)

    // 终态事件：更新 turn 状态但不需要 reload（本地已经累积好）
    if (push.event.kind === 'done' || push.event.kind === 'error' || push.event.kind === 'canceled') {
      const nextStatus =
        push.event.kind === 'done' ? 'done'
        : push.event.kind === 'canceled' ? 'canceled'
        : 'error'
      turns.value = turns.value.map((t) =>
        t.id === push.turnId ? { ...t, status: nextStatus } : t
      )
      if (streamingTurnId.value === push.turnId) streamingTurnId.value = null
      isCanceling.value = false
    } else if (turns.value.find((turn) => turn.id === push.turnId)?.status === 'streaming') {
      streamingTurnId.value = push.turnId
    }

    // 暂存变更相关：任一 staged_change 事件都重拉一次 stageList，保持简单可靠
    if (push.event.kind === 'staged_change' || push.event.kind === 'staged_change_updated') {
      void reloadStaged()
    }
  })

  onBeforeUnmount(() => {
    unsubscribe()
  })

  // ==========================================================================
  // 数据拉取
  // ==========================================================================

  async function reloadSessions(): Promise<void> {
    const pid = options.projectId()
    if (!pid) {
      sessions.value = []
      isInitializing.value = false
      return
    }
    // 章节级 Surface 共享项目级会话，不再因章节切换而清空；
    // 仅对「声明了 scopeRef 但当前无作用域」的非章节 Surface 清空状态。
    if (!isChapterSurface && options.scopeRef && !sessionScopeRef()) {
      sessions.value = []
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
      streamingTurnId.value = null
      cancelEditing()
      restoredDraftLabel.value = ''
      restoredIntentHint.value = null
      turnIntentMap.clear()
      isInitializing.value = false
      return
    }
    isInitializing.value = true
    try {
      const list = await A.sessionList({ projectId: pid, surfaceId: sessionSurfaceId, scopeRef: sessionScopeRef() })
      sessions.value = list
      if (!activeSessionId.value && list.length > 0) {
        await switchSession(list[0].id)
      } else {
        // 没有会话时也标记加载完成
        isInitializing.value = false
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      isInitializing.value = false
    }
  }

  async function reloadTurns(): Promise<void> {
    if (!activeSessionId.value) return
    const loaded = await A.sessionLoad({
      sessionId: activeSessionId.value,
      withReplay: true
    })
    turns.value = loaded.turns

    // 用 replay 事件重建 eventsByTurn（覆盖，保证与后端一致）
    const map = new Map<string, TurnEvent[]>()
    for (const p of loaded.events) {
      const evt = persistedToEvent(p)
      const list = map.get(p.turnId) ?? []
      appendCoalescedEvent(list, evt)
      map.set(p.turnId, list)
    }
    eventsByTurn.value = map
    streamingTurnId.value = [...loaded.turns].reverse().find((turn) => turn.status === 'streaming')?.id ?? null
    isCanceling.value = false

    // 首次加载完成
    isInitializing.value = false
  }

  async function reloadStaged(): Promise<void> {
    if (!activeSessionId.value) return
    try {
      const list = await A.stageList({ sessionId: activeSessionId.value })
      stagedChanges.value = list
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    }
  }

  // ==========================================================================
  // 会话操作
  // ==========================================================================

  /** 生成默认会话标题：完整时间（某年某月某日 某时某分某秒）。 */
  function defaultSessionTitle(date: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${p(date.getHours())}时${p(date.getMinutes())}分${p(date.getSeconds())}秒`
  }

  async function createSession(title?: string): Promise<AssistantSession | null> {
    // 支持多任务并行：即使当前有会话正在生成，也允许新建对话，旧的生成在后台继续执行。
    const pid = options.projectId()
    if (!pid) return null
    // 新建对话默认不写入历史：先以前端生成的 ID 在内存中创建「草稿会话」，
    // 只有当用户真正向 AI 发送了第一条消息时才持久化并进入历史列表。
    const now = new Date().toISOString()
    const session: AssistantSession = {
      id: crypto.randomUUID(),
      projectId: pid,
      surfaceId: sessionSurfaceId,
      scopeRef: sessionScopeRef(),
      title: title || defaultSessionTitle(),
      createdAt: now,
      updatedAt: now
    }
    draftSession.value = session
    activeSessionId.value = session.id
    turns.value = []
    eventsByTurn.value = new Map()
    stagedChanges.value = []
    streamingTurnId.value = null
    isCanceling.value = false
    cancelEditing()
    restoredDraftLabel.value = ''
    composerValue.value = ''
    pendingAttachments.value = []
    isInitializing.value = false
    return session
  }

  /**
   * 将「草稿会话」正式写入后端并加入历史列表，返回持久化后的会话。
   * 若当前活跃会话不是草稿（已是持久化会话）则直接返回。
   */
  async function persistDraftSession(title: string): Promise<AssistantSession | null> {
    if (!draftSession.value) return null
    const pid = options.projectId()
    if (!pid) return null
    const draft = draftSession.value
    // 用前端生成的同一 ID 通过 sessionRestore 创建后端会话（该接口支持指定 id）。
    const res = await A.sessionRestore({
      id: draft.id,
      projectId: pid,
      surfaceId: draft.surfaceId,
      scopeRef: draft.scopeRef,
      title
    })
    if (!res.ok) {
      lastError.value = res.error || '新建对话写入历史失败'
      return null
    }
    const persisted: AssistantSession = {
      ...draft,
      title,
      updatedAt: new Date().toISOString()
    }
    draftSession.value = null
    // 新会话置顶，与「发送首条消息即成为最近对话」的习惯一致。
    sessions.value = [persisted, ...sessions.value]
    return persisted
  }

  async function switchSession(sessionId: string): Promise<void> {
    // 支持多任务并行：允许在生成中切换会话，后台生成继续执行，切回时自动 replay 最新状态。
    if (!sessions.value.some((s) => s.id === sessionId)) {
      return
    }
    // 切换到其他会话时，丢弃尚未写入历史的草稿会话（从未持久化，无需后端清理）。
    if (draftSession.value && draftSession.value.id === activeSessionId.value) {
      draftSession.value = null
    }
    activeSessionId.value = sessionId
    turns.value = []
    eventsByTurn.value = new Map()
    stagedChanges.value = []
    streamingTurnId.value = null
    isCanceling.value = false
    cancelEditing()
    restoredDraftLabel.value = ''
    // 切换到/新建对话时清空输入框草稿与待发送的引用/上传附件，避免残留上一个对话的内容
    composerValue.value = ''
    pendingAttachments.value = []
    await Promise.all([reloadTurns(), reloadStaged()])
  }

  async function deleteSession(sessionId: string): Promise<void> {
    if (isStreaming.value) {
      lastError.value = '请先停止当前生成，再删除会话。'
      return
    }

    // 删除前先将会话快照写入回收站（Runtime v2 会话保存在后端 SQLite，需在此处记录）
    const target = sessions.value.find((s) => s.id === sessionId)
    if (target) {
      try {
        const loaded = await A.sessionLoad({ sessionId, withReplay: true })
        appStore.recordDeletedAssistantSessionV2({
          ...target,
          turns: loaded?.turns ?? [],
          events: loaded?.events ?? []
        })
      } catch (e) {
        // 快照失败不阻断删除，仅记录日志
        console.error('[useAssistant] 记录删除会话到回收站失败:', e)
      }
    }

    await A.sessionDelete({ sessionId })
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
      cancelEditing()
      restoredDraftLabel.value = ''
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].id)
      }
    }
  }

  /**
   * 批量删除多个会话。逐个把会话快照写入回收站后，调用后端批量删除接口（级联删除 turns / events / 暂存变更）。
   */
  async function deleteSessions(sessionIds: string[]): Promise<void> {
    const ids = [...new Set(sessionIds)].filter((id) =>
      sessions.value.some((s) => s.id === id)
    )
    if (ids.length === 0) return
    if (isStreaming.value) {
      lastError.value = '请先停止当前生成，再删除会话。'
      return
    }

    // 逐个把会话快照写入回收站，失败不阻断删除
    await Promise.all(ids.map(async (id) => {
      const target = sessions.value.find((s) => s.id === id)
      if (!target) return
      try {
        const loaded = await A.sessionLoad({ sessionId: id, withReplay: true })
        appStore.recordDeletedAssistantSessionV2({
          ...target,
          turns: loaded?.turns ?? [],
          events: loaded?.events ?? []
        })
      } catch (e) {
        console.error('[useAssistant] 记录删除会话到回收站失败:', e)
      }
    }))

    await A.sessionDeleteBatch({ sessionIds: ids })
    sessions.value = sessions.value.filter((s) => !ids.includes(s.id))

    // 若活动会话被批量删除，切到剩余的第一个会话；没有剩余则重置为空会话
    if (activeSessionId.value && ids.includes(activeSessionId.value)) {
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
      cancelEditing()
      restoredDraftLabel.value = ''
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].id)
      }
    }
  }

  /**
   * 退出全局智能体页面时清理「空会话」：没有任何对话内容（没有任何 turn）的会话。
   * 这些会话会被自动永久删除，且不记入回收站（直接调用后端批量删除，不写回收站快照）。
   * @returns 被删除的空会话数量
   */
  async function deleteEmptySessionsPermanent(): Promise<number> {
    const ids: string[] = []
    for (const s of sessions.value) {
      try {
        const loaded = await A.sessionLoad({ sessionId: s.id })
        const turns = (loaded?.turns ?? []) as Array<{
          userMessage?: string
          assistantMessage?: string
        }>
        // 没有任何 turn，或 turn 均无实际内容（用户/助手消息均为空白）视为空会话
        const isEmpty =
          turns.length === 0 ||
          turns.every(
            (t) =>
              !(t.userMessage && t.userMessage.trim()) &&
              !(t.assistantMessage && t.assistantMessage.trim())
          )
        if (isEmpty) ids.push(s.id)
      } catch (e) {
        // 单个会话检测失败不阻断整体清理，仅记录日志
        console.error('[useAssistant] 检测空会话失败:', e)
      }
    }

    if (ids.length === 0) return 0

    // 直接调用后端批量删除（级联删除 turns / events / 暂存变更），不写回收站快照。
    await A.sessionDeleteBatch({ sessionIds: ids })
    sessions.value = sessions.value.filter((s) => !ids.includes(s.id))
    if (activeSessionId.value && ids.includes(activeSessionId.value)) {
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
      cancelEditing()
      restoredDraftLabel.value = ''
    }
    return ids.length
  }

  async function renameSession(sessionId: string, title: string): Promise<void> {
    await A.sessionRename({ sessionId, title })
    sessions.value = sessions.value.map((s) =>
      s.id === sessionId ? { ...s, title } : s
    )
  }

  /** 会话标题是否仍是系统默认值（未被用户或自动摘要覆盖）。 */
  function isDefaultTitle(title: string): boolean {
    // 默认标题为时间格式：xxxx年x月x日 xx时xx分xx秒
    return !title || /^\d{4}年\d{1,2}月\d{1,2}日 \d{2}时\d{2}分\d{2}秒$/.test(title)
  }

  /** 从用户首条提问摘要出简短会话标题。 */
  function deriveSessionTitle(text: string): string {
    // 压平空白，取首句（中英文标点断句），再截断到合理长度
    const flat = text.replace(/\s+/g, ' ').trim()
    const firstSentence = flat.split(/[。！？.!?\n]/)[0]?.trim() || flat
    const base = firstSentence || flat
    const MAX = 18
    return base.length > MAX ? base.slice(0, MAX) + '…' : base
  }

  // ==========================================================================
  // Turn 操作
  // ==========================================================================

  async function sendText(text: string, sendOptions: AssistantSendOptions = {}): Promise<void> {
    const trimmedText = text.trim()
    const hasAttachments = (sendOptions.attachments ?? []).length > 0
    // 允许仅携带附件（如上传文件）而正文为空的发送。
    if ((!trimmedText && !hasAttachments) || hasLiveStreaming()) return
    const effectiveText = trimmedText || (hasAttachments ? '请处理我上传/引用的文件。' : '')
    let sessionId = activeSessionId.value
    const derivedTitle = deriveSessionTitle(effectiveText)
    if (!sessionId) {
      const session = await createSession(derivedTitle)
      if (!session) return
      sessionId = session.id
    }

    if (!await appStore.flushAppSettings()) {
      lastError.value = appStore.persistenceError ?? 'AI 设置保存失败，未发送本次请求。'
      return
    }

    // 新建对话（草稿会话）在用户真正发送首条消息时才写入历史，标题用首条提问摘要。
    // 放到 flushAppSettings 之后，避免设置保存失败时留下空的草稿会话。
    if (draftSession.value && draftSession.value.id === sessionId) {
      const persisted = await persistDraftSession(derivedTitle)
      if (!persisted) return
      sessionId = persisted.id
    } else {
      // 已有会话但仍是默认标题（如历史会话未命名）：用首条提问摘要覆盖
      const current = sessions.value.find((s) => s.id === sessionId)
      if (current && isDefaultTitle(current.title)) {
        void renameSession(sessionId, derivedTitle)
      }
    }

    if (composerValue.value.trim() === trimmedText) {
      composerValue.value = ''
    }
    restoredDraftLabel.value = ''
    lastError.value = null
    // 已把引用芯片随消息发出，清空待发送附件列表
    clearPendingAttachments()

    // 先乐观塞一个 streaming turn（真实 turnId 由后端事件确认）
    const optimisticTurnId = `optimistic-${Date.now()}`
    turns.value = [
      ...turns.value,
      {
        id: optimisticTurnId,
        sessionId,
        userMessage: effectiveText,
        assistantMessage: '',
        status: 'streaming',
        createdAt: new Date().toISOString()
      }
    ]
    streamingTurnId.value = optimisticTurnId
    isCanceling.value = false
    if (sendOptions.intentHint) {
      turnIntentMap.set(optimisticTurnId, sendOptions.intentHint)
    }

    try {
      // 附件可能以 Vue reactive proxy 形式存在；Electron IPC 无法结构化克隆
      // Proxy 对象（报 "An object could not be cloned"）。这里显式收敛为纯 JSON，
      // 确保跨 IPC 传输的附件始终是可克隆的普通对象（兜底防御，preload 同样有净化）。
      const plainAttachments = sendOptions.attachments
        ? JSON.parse(JSON.stringify(sendOptions.attachments)) as TurnAttachment[]
        : undefined
      const result = await A.turnSend({
        sessionId,
        clientRequestId: optimisticTurnId,
        surface: options.surface,
        scopeRef: options.scopeRef?.(),
        userMessage: effectiveText,
        intentHint: sendOptions.intentHint,
        attachments: plainAttachments,
        agentId: sendOptions.agentId,
        agentScope: sendOptions.agentScope,
        agentProjectId: sendOptions.agentProjectId ?? options.projectId(),
        fileAreaPath: sendOptions.fileAreaPath
      })
      // 事件流已经在 handler 里做了乐观 turn 的替换 + 状态更新，
      // 这里只兜底：若乐观 turn 依然存在（没有任何事件推来），清理掉。
      const optimisticStill = turns.value.find((t) => t.id === optimisticTurnId)
      if (optimisticStill) {
        turns.value = turns.value.filter((t) => t.id !== optimisticTurnId)
        if (streamingTurnId.value === optimisticTurnId) streamingTurnId.value = null
      }
      turnIntentMap.delete(optimisticTurnId)
      if (result.error) lastError.value = result.error
    } catch (e) {
      streamingTurnId.value = null
      isCanceling.value = false
      turns.value = turns.value.filter((t) => t.id !== optimisticTurnId)
      turnIntentMap.delete(optimisticTurnId)
      if (!composerValue.value.trim()) composerValue.value = trimmedText
      lastError.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function send(sendOptions: AssistantSendOptions = {}): Promise<void> {
    const attachments = pendingAttachments.value.length > 0
      ? pendingAttachments.value
      : sendOptions.attachments
    await sendText(composerValue.value, { ...sendOptions, attachments })
  }

  async function continueWithPrompt(prompt: string): Promise<void> {
    await sendText(prompt, {
      intentHint: `assistant-v2:continue`
    })
  }

  /**
   * 回退到某轮对话之前：删除该 turn 及其之后的所有 turn（及其暂存变更）。
   * 用于"回退到本轮对话之前"的撤销操作。
   */
  async function rollbackTurn(turnId: string, prompt?: string): Promise<void> {
    if (!activeSessionId.value || hasLiveStreaming()) return
    // 被回退的这轮若曾携带模式/命令意图，回退后需连带恢复该模式状态（如“标准模式”芯片）
    const rollbackIntent = turnIntentMap.get(turnId)
    await A.turnDelete({ sessionId: activeSessionId.value, turnId })
    // 清理已被删除轮次（该轮及之后）的意图记录
    const order = turns.value.map((t) => t.id)
    const removedIdx = order.indexOf(turnId)
    const removedIds = removedIdx >= 0 ? order.slice(removedIdx) : [turnId]
    for (const rid of removedIds) turnIntentMap.delete(rid)
    // 回退后把被回退的那轮对话提示词自动填入问答框，并标记为“已回填”，方便继续基于它调整
    if (typeof prompt === 'string' && prompt.trim()) {
      composerValue.value = prompt
      restoredDraftLabel.value = '已回填 · 回退的对话原文'
    }
    restoredIntentHint.value = rollbackIntent ?? null
    // 重拉本轮之后的对话与暂存区，保持一致
    await reloadTurns()
    await reloadStaged()
  }

  /**
   * 批量删除选中的多轮对话。
   *
   * 后端 turn 删除为级联语义（删除某一轮会连带删除它之后的所有轮次，以保持对话连续），
   * 因此批量删除时取“最早被选中”的那一轮作为删除起点，一次级联删除即可覆盖全部选中轮次。
   */
  async function deleteTurns(turnIds: string[]): Promise<void> {
    if (!activeSessionId.value || hasLiveStreaming() || turnIds.length === 0) return
    const order = turns.value.map((t) => t.id)
    const valid = turnIds.filter((id) => order.includes(id))
    if (valid.length === 0) return
    const earliest = valid.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]
    await A.turnDelete({ sessionId: activeSessionId.value, turnId: earliest })
    // 清理被删除轮次的意图记录
    const removedIdx = order.indexOf(earliest)
    for (const rid of order.slice(removedIdx)) turnIntentMap.delete(rid)
    await reloadTurns()
    await reloadStaged()
  }

  async function cancel(): Promise<void> {
    if (!streamingTurnId.value || !activeSessionId.value || isCanceling.value) return
    isCanceling.value = true
    try {
      const result = await A.turnCancel({
        sessionId: activeSessionId.value,
        turnId: streamingTurnId.value
      })
      if (!result.ok) {
        isCanceling.value = false
        lastError.value = result.reason || '当前生成未能停止，请稍后重试。'
      }
    } catch (error) {
      isCanceling.value = false
      lastError.value = error instanceof Error ? error.message : '停止生成失败'
    }
  }

  function startEditingTurn(turnId: string): void {
    if (hasLiveStreaming() || isTruncating.value) {
      lastError.value = '请先停止当前生成，再编辑历史对话。'
      return
    }
    // streamingTurnId 若残留（无真实 streaming 轮次）先复位，避免编辑被误拦截
    if (isStreaming.value && !hasLiveStreaming()) streamingTurnId.value = null
    const turn = turns.value.find((item) => item.id === turnId)
    if (!turn) return
    // 编辑对象始终是用户发送的提示词，而不是 AI 的回复
    editingTurnId.value = turnId
    editingDraft.value = turn.userMessage
    restoredDraftLabel.value = ''
    lastError.value = null
  }

  function startEditingLastTurn(): void {
    const last = turns.value[turns.value.length - 1]
    if (last) startEditingTurn(last.id)
  }

  function updateEditingDraft(value: string): void {
    editingDraft.value = value
  }

  function cancelEditing(): void {
    editingTurnId.value = null
    editingDraft.value = ''
  }

  function clearRestoredDraft(): void {
    composerValue.value = ''
    restoredDraftLabel.value = ''
    restoredIntentHint.value = null
  }

  /** 供 Composer 消费撤回/回退后需要恢复的模式意图，消费后立即清空，避免重复触发。 */
  function consumeRestoredIntent(): string | null {
    const v = restoredIntentHint.value
    restoredIntentHint.value = null
    return v
  }

  async function truncateTurn(turnId: string): Promise<TurnTruncateResult | null> {
    const sessionId = activeSessionId.value
    if (!sessionId || hasLiveStreaming() || isTruncating.value) {
      if (hasLiveStreaming()) lastError.value = '请先停止当前生成，再撤回或编辑历史对话。'
      return null
    }
    // streamingTurnId 若残留（无真实 streaming 轮次）先复位，避免截断被误拦截
    if (isStreaming.value && !hasLiveStreaming()) streamingTurnId.value = null

    isTruncating.value = true
    try {
      const result = await A.turnTruncate({ sessionId, fromTurnId: turnId })
      const removed = new Set(result.removedTurnIds)
      turns.value = turns.value.filter((turn) => !removed.has(turn.id))
      for (const rid of removed) turnIntentMap.delete(rid)

      const nextEvents = new Map(eventsByTurn.value)
      for (const removedTurnId of removed) nextEvents.delete(removedTurnId)
      eventsByTurn.value = nextEvents
      stagedChanges.value = stagedChanges.value.filter((change) => !removed.has(change.turnId))
      await reloadStaged()
      lastError.value = null
      return result
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '撤回对话失败'
      return null
    } finally {
      isTruncating.value = false
    }
  }

  async function undoTurn(turnId: string): Promise<TurnTruncateResult | null> {
    const index = turns.value.findIndex((turn) => turn.id === turnId)
    if (index < 0 || index !== turns.value.length - 1) {
      lastError.value = '只能撤回最后一轮对话。'
      return null
    }
    // 记录被撤回这轮携带的模式/命令意图，撤回后连带恢复（如“标准模式”芯片）
    const undoIntent = turnIntentMap.get(turnId)
    const result = await truncateTurn(turnId)
    if (!result) return null
    for (const rid of result.removedTurnIds) turnIntentMap.delete(rid)
    cancelEditing()
    composerValue.value = result.restoredUserMessage
    restoredDraftLabel.value = `已回填 · 撤回的第 ${index + 1} 轮原文`
    restoredIntentHint.value = undoIntent ?? null
    return result
  }

  /**
   * 重新生成某一轮的 AI 回复：截断该轮及其后的对话，并用该轮的用户提问重新发起请求。
   */
  async function regenerateTurn(turnId: string): Promise<TurnTruncateResult | null> {
    if (!activeSessionId.value || hasLiveStreaming() || isTruncating.value) {
      if (hasLiveStreaming()) lastError.value = '请先停止当前生成，再重新生成回复。'
      return null
    }
    const msg = turns.value.find((t) => t.id === turnId)
    const prompt = msg?.userMessage?.trim()
    if (!prompt) return null

    const result = await truncateTurn(turnId)
    if (!result) return null
    cancelEditing()
    await sendText(prompt)
    return result
  }

  async function resendEditedTurn(
    sendOptions: AssistantSendOptions = {}
  ): Promise<TurnTruncateResult | null> {
    const turnId = editingTurnId.value
    const draft = editingDraft.value.trim()
    if (!turnId || !draft) return null

    const result = await truncateTurn(turnId)
    if (!result) return null
    cancelEditing()
    composerValue.value = draft
    void sendText(draft, sendOptions)
    return result
  }

  // ==========================================================================
  // 暂存变更操作
  // ==========================================================================

  async function acceptChanges(ids: string[]): Promise<void> {
    await A.stageAccept({ changeIds: ids })
    await reloadStaged()
  }

  async function rejectChanges(ids: string[]): Promise<void> {
    await A.stageReject({ changeIds: ids })
    await reloadStaged()
  }

  async function commitAccepted(ids?: string[]): Promise<{ committed: number; failed: number }> {
    if (!activeSessionId.value) return { committed: 0, failed: 0 }
    const expectedAcceptedCount = ids?.length
      ? stagedChanges.value.filter((change) =>
        ids.includes(change.id) && change.status === 'accepted'
      ).length
      : acceptedStaged.value.length
    const results = await A.stageCommit({
      sessionId: activeSessionId.value,
      changeIds: ids
    })
    const errors = results.filter((r) => !r.ok)
    if (results.length === 0 && expectedAcceptedCount > 0) {
      lastError.value = '没有变更被写回：暂存区状态可能已过期，请刷新后重试。'
    } else if (errors.length > 0) {
      lastError.value = `${errors.length} 项提交失败：${errors.map((e) => e.error).join('; ')}`
    } else {
      lastError.value = null
    }
    await reloadStaged()
    return { committed: results.length - errors.length, failed: errors.length }
  }

  async function bindTarget(changeId: string, entityId: string): Promise<void> {
    await A.stageBindTarget({ changeId, entityId })
    await reloadStaged()
  }

  /** 批量硬删除暂存变更（已提交/已忽略的历史记录，或用户主动移除单条）。 */
  async function removeChanges(ids: string[]): Promise<number> {
    if (!ids.length) return 0
    const removed = await A.stageRemove({ changeIds: ids })
    await reloadStaged()
    return removed
  }

  /** 清理当前会话中已提交与已忽略的变更，保持暂存区列表清爽。 */
  async function clearFinishedStaged(): Promise<number> {
    if (!activeSessionId.value) return 0
    const cleared = await A.stageClearFinished({ sessionId: activeSessionId.value })
    await reloadStaged()
    return cleared
  }

  // ==========================================================================
  // 生命周期
  // ==========================================================================

  // projectId 变化 → 重新拉会话列表
  watch(
    () => options.projectId(),
    async () => {
      draftSession.value = null
      activeSessionId.value = null
      turns.value = []
      eventsByTurn.value = new Map()
      stagedChanges.value = []
      streamingTurnId.value = null
      cancelEditing()
      restoredDraftLabel.value = ''
      await reloadSessions()
    },
    { immediate: true }
  )

  // scopeRef 变化（切换章节）→ 重新拉会话列表
  if (options.scopeRef) {
    watch(
      () => options.scopeRef!(),
      async (newRef, oldRef) => {
        if (newRef === oldRef) return
        // 章节级 Surface 共享项目级会话：切换章节/分卷时保持同一个对话，仅保留原会话。
        if (isChapterSurface) return
        draftSession.value = null
        activeSessionId.value = null
        turns.value = []
        eventsByTurn.value = new Map()
        stagedChanges.value = []
        streamingTurnId.value = null
        cancelEditing()
        restoredDraftLabel.value = ''
        await reloadSessions()
      }
    )
  }

  return {
    // state
    sessions,
    activeSessionId,
    activeSession,
    messages,
    isStreaming,
    isCanceling,
    isInitializing,
    streamingCharCount,
    stagedChanges,
    pendingStaged,
    acceptedStaged,
    composerValue,
    pendingAttachments,
    addPendingAttachment,
    updatePendingAttachment,
    removePendingAttachment,
    clearPendingAttachments,
    editingTurnId,
    editingDraft,
    restoredDraftLabel,
    restoredIntentHint,
    consumeRestoredIntent,
    isTruncating,
    lastError,
    // actions
    createSession,
    switchSession,
    deleteSession,
    deleteSessions,
    deleteEmptySessionsPermanent,
    renameSession,
    send,
    continueWithPrompt,
    rollbackTurn,
    deleteTurns,
    cancel,
    startEditingTurn,
    startEditingLastTurn,
    updateEditingDraft,
    cancelEditing,
    clearRestoredDraft,
    undoTurn,
    resendEditedTurn,
    regenerateTurn,
    acceptChanges,
    rejectChanges,
    commitAccepted,
    bindTarget,
    removeChanges,
    clearFinishedStaged,
    reloadSessions,
    reloadStaged
  }
}
