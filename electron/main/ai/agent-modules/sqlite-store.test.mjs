import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  initAgentModuleStatesSchema,
  LazySqliteModuleStore,
  SqliteModuleStore
} from './sqlite-store.ts'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  initAgentModuleStatesSchema(db)
  return db
}

test('SqliteModuleStore 持久化启停开关', () => {
  const db = makeDb()
  const store = new SqliteModuleStore(db)

  assert.equal(store.getEnabled('speech.asr'), undefined)
  store.setEnabled('speech.asr', true)
  store.setEnabled('mcp.market', false)
  assert.equal(store.getEnabled('speech.asr'), true)
  assert.equal(store.getEnabled('mcp.market'), false)

  // 用新的 store 实例模拟「重启」，应能读到上次持久化的状态
  const store2 = new SqliteModuleStore(db)
  assert.equal(store2.getEnabled('speech.asr'), true)
  assert.equal(store2.getEnabled('mcp.market'), false)

  // 覆盖已存在的开关
  store2.setEnabled('speech.asr', false)
  const store3 = new SqliteModuleStore(db)
  assert.equal(store3.getEnabled('speech.asr'), false)
})

test('SqliteModuleStore 持久化配置', () => {
  const db = makeDb()
  const store = new SqliteModuleStore(db)

  store.setConfig('mcp.market', { imported: { a: 1 } })
  const store2 = new SqliteModuleStore(db)
  assert.deepEqual(store2.getConfig('mcp.market'), { imported: { a: 1 } })

  // 更新配置
  store2.setConfig('mcp.market', { imported: { a: 2 } })
  const store3 = new SqliteModuleStore(db)
  assert.deepEqual(store3.getConfig('mcp.market'), { imported: { a: 2 } })
})

test('SqliteModuleStore 使用统计持久化', () => {
  const db = makeDb()
  const store = new SqliteModuleStore(db)

  store.setEnabled('exec.shell', true)
  store.touch('exec.shell')
  store.touch('exec.shell')
  assert.equal(store.usageCount('exec.shell'), 2)

  const store2 = new SqliteModuleStore(db)
  assert.equal(store2.usageCount('exec.shell'), 2)
  assert.ok(store2.lastUsedAt('exec.shell'))
})

test('LazySqliteModuleStore attach 前走内存、attach 后合并持久化状态', () => {
  const db = makeDb()

  // 先有历史持久化状态
  const seed = new SqliteModuleStore(db)
  seed.setEnabled('speech.asr', true)

  // 惰性存储：attach 前启用一个模块（模拟 DB 就绪前用户操作）
  const lazy = new LazySqliteModuleStore()
  assert.equal(lazy.getEnabled('speech.asr'), undefined)
  lazy.setEnabled('network.http', true)

  // attach：合并 SQLite 历史状态
  lazy.attach(db)
  assert.equal(lazy.getEnabled('speech.asr'), true) // 来自 SQLite 历史
  assert.equal(lazy.getEnabled('network.http'), true) // 来自 attach 前本地操作

  // 后续写入实时落库
  lazy.setEnabled('speech.asr', false)
  const fresh = new SqliteModuleStore(db)
  assert.equal(fresh.getEnabled('speech.asr'), false)
  assert.equal(fresh.getEnabled('network.http'), true)
})
