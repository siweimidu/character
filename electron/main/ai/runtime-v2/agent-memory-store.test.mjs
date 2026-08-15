import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { AgentMemoryStore, formatMemoriesBlock, initAgentMemoriesSchema } from './agent-memory-store.ts'

function makeStore() {
  const db = new DatabaseSync(':memory:')
  initAgentMemoriesSchema(db)
  const store = new AgentMemoryStore(db)
  return { store, db }
}

test('创作记忆 CRUD 与排序', () => {
  const { store } = makeStore()

  const low = store.create({
    projectId: 'p1',
    kind: 'preference',
    content: '主角要冷峻克制',
    source: 'user',
    importance: 2
  })
  const high = store.create({
    projectId: 'p1',
    kind: 'lesson',
    content: '不要给设定校对用户改世界观',
    source: 'system',
    importance: 5
  })

  // 按 importance 降序排列
  const list = store.list('p1', 50)
  assert.equal(list.length, 2)
  assert.equal(list[0].id, high.id)
  assert.equal(list[1].id, low.id)

  // get
  assert.equal(store.get(high.id)?.kind, 'lesson')

  // remove
  assert.equal(store.remove(low.id, 'p1'), true)
  assert.equal(store.list('p1', 50).length, 1)
})

test('按 kind 过滤召回', () => {
  const { store } = makeStore()
  store.create({ projectId: 'p1', kind: 'preference', content: '偏好A', source: 'user' })
  store.create({ projectId: 'p1', kind: 'fact', content: '事实B', source: 'agent' })
  store.create({ projectId: 'p1', kind: 'preference', content: '偏好C', source: 'user' })

  const prefs = store.listByKind('p1', 'preference', 50)
  assert.equal(prefs.length, 2)
})

test('记忆格式化为注入块', () => {
  const { store } = makeStore()
  store.create({
    projectId: 'p1',
    kind: 'lesson',
    content: '用户拒绝过整章改写',
    source: 'system',
    importance: 4
  })
  const block = formatMemoriesBlock(store.list('p1', 10))
  assert.match(block, /创作记忆/)
  assert.match(block, /用户拒绝过整章改写/)
  // 教训类型会带来源标注，如 `[教训（系统）]` 或 `[教训]`
  assert.match(block, /\[教训/)
})

test('跨项目隔离', () => {
  const { store } = makeStore()
  store.create({ projectId: 'p1', kind: 'preference', content: 'A', source: 'user' })
  store.create({ projectId: 'p2', kind: 'preference', content: 'B', source: 'user' })
  assert.equal(store.list('p1', 50).length, 1)
  assert.equal(store.list('p2', 50).length, 1)
})

test('超过上限时裁剪最不重要条目', () => {
  const { store } = makeStore()
  for (let i = 0; i < 210; i += 1) {
    store.create({ projectId: 'p1', kind: 'fact', content: `记忆${i}`, source: 'agent', importance: 1 })
  }
  assert.ok(store.list('p1', 500).length <= 200)
})
