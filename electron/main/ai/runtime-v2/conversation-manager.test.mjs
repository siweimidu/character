import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { ConversationManager, initAssistantRuntimeSchema } from './conversation-manager.ts'
import { StagedChangesStore } from './staged-changes-store.ts'

function createDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT;
    INSERT INTO projects (id) VALUES ('project-1');
  `)
  initAssistantRuntimeSchema(db)
  return db
}

test('从中间轮次截断时级联删除后续事件并统计暂存影响', async () => {
  const db = createDatabase()
  const conversation = new ConversationManager(db)
  const changes = new StagedChangesStore()
  changes.configure(db)

  const session = conversation.createSession({
    projectId: 'project-1',
    surfaceId: 'global-page',
    title: '测试会话'
  })
  const first = conversation.createTurn({ sessionId: session.id, userMessage: '第一轮' })
  const second = conversation.createTurn({ sessionId: session.id, userMessage: '第二轮' })
  const third = conversation.createTurn({ sessionId: session.id, userMessage: '第三轮' })
  conversation.appendEvent(second.id, { kind: 'chunk', seq: 0, delta: '第二轮回复' })
  conversation.appendEvent(third.id, { kind: 'chunk', seq: 0, delta: '第三轮回复' })

  const pending = changes.add({
    sessionId: session.id,
    turnId: second.id,
    kind: 'worldview',
    action: 'create',
    entityTitle: '待确认设定',
    reason: '测试',
    before: '',
    after: '内容'
  })
  const committed = changes.add({
    sessionId: session.id,
    turnId: third.id,
    kind: 'character',
    action: 'update',
    entityTitle: '已写回人物',
    reason: '测试',
    before: '旧',
    after: '新'
  })
  changes.accept([committed.id])
  await changes.commit(
    async (change) => ({ changeId: change.id, ok: true, entityId: 'character-1' }),
    { changeIds: [committed.id] }
  )

  const truncated = conversation.truncateFrom(session.id, second.id)
  const staged = changes.clearTurns(truncated.removedTurnIds)

  assert.deepEqual(truncated.removedTurnIds, [second.id, third.id])
  assert.equal(truncated.restoredUserMessage, '第二轮')
  assert.deepEqual(conversation.listTurns(session.id).map((turn) => turn.id), [first.id])
  assert.equal(conversation.listEvents(second.id).length, 0)
  assert.equal(conversation.listEvents(third.id).length, 0)
  assert.deepEqual(staged, { discarded: 1, keptCommitted: 1 })
  assert.equal(changes.get(pending.id), null)
  assert.equal(changes.get(committed.id), null)
})

test('不能用其他会话的轮次作为截断锚点', () => {
  const db = createDatabase()
  const conversation = new ConversationManager(db)
  const a = conversation.createSession({ projectId: 'project-1', surfaceId: 'global-page', title: 'A' })
  const b = conversation.createSession({ projectId: 'project-1', surfaceId: 'global-page', title: 'B' })
  const turn = conversation.createTurn({ sessionId: a.id, userMessage: 'A 的问题' })

  assert.throws(() => conversation.truncateFrom(b.id, turn.id), /找不到要撤回/)
  assert.equal(conversation.listTurns(a.id).length, 1)
})
