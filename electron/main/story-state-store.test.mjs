import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  applyStateDelta,
  deleteStoryStateItem,
  initStoryStateSchema,
  normalizeStateDelta
} from './story-state-store.ts'

test('畸形状态增量会被规范化为可遍历、可绑定的字段', () => {
  const delta = normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: {
        mental_state: { value: '紧张' },
        arc_progression: ['第一阶段'],
        new_knowledge: ['密道', '密道', { value: '无效' }]
      }
    }],
    foreshadowing_delta: {
      planted: null,
      advanced: { id: '伏笔-1', clue: '旧信出现', method: '侧写' },
      resolved: '无'
    },
    timeline: { events: '抵达城门' }
  })

  assert.deepEqual(delta.foreshadowing_delta.advanced, [{ id: '伏笔-1', clue: '旧信出现', method: '侧写' }])
  assert.equal(delta.characters_updated[0].changes.mental_state, undefined)
  assert.deepEqual(delta.characters_updated[0].changes.new_knowledge, ['密道'])
  assert.deepEqual(delta.timeline.events, [])
})

test('同一章节状态增量重复写入不会重复累积数组字段', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  const delta = normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: {
        mental_state: '警觉',
        inventory_delta: { added: ['旧信'], removed: [] },
        new_knowledge: ['密道入口'],
        goals_update: { completed: [], added: ['找到证人'] }
      }
    }],
    relationships_delta: [{
      relationship_id: '林岚-顾川',
      participants: ['林岚', '顾川'],
      status_change: { from: '陌生', to: '合作', pivot_event: '共同脱险' },
      new_tension_points: ['互不信任']
    }],
    foreshadowing_delta: {
      planted: [{ id: '伏笔-1', type: '暗线', description: '旧信', method: '道具', payoff_chapter: 20 }],
      advanced: [{ id: '伏笔-1', clue: '火漆印', method: '特写' }],
      resolved: []
    },
    timeline: { current_story_date: '第三日', events: ['离城'] }
  })

  applyStateDelta(db, 'project-1', 3, delta)
  applyStateDelta(db, 'project-1', 3, delta)

  const character = db.prepare('SELECT knowledge_json, inventory_json, goals_json FROM story_character_state').get()
  const relationship = db.prepare('SELECT tension_points_json FROM story_relationships').get()
  const foreshadowing = db.prepare('SELECT clues_json FROM story_foreshadowing').get()
  assert.deepEqual(JSON.parse(character.knowledge_json), ['密道入口'])
  assert.deepEqual(JSON.parse(character.inventory_json), ['旧信'])
  assert.deepEqual(JSON.parse(character.goals_json), ['找到证人'])
  assert.deepEqual(JSON.parse(relationship.tension_points_json), ['互不信任'])
  assert.deepEqual(JSON.parse(foreshadowing.clues_json), [{ chapter: 3, clue: '火漆印', method: '特写' }])
})

test('可单独删除单条角色状态/伏笔/时间线卡片并返回快照', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)

  applyStateDelta(db, 'project-1', 3, normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: { mental_state: '警觉', new_knowledge: ['密道'] }
    }],
    foreshadowing_delta: {
      planted: [
        { id: '伏笔-1', type: '暗线', description: '旧信', method: '道具', payoff_chapter: 20 },
        { id: '伏笔-2', type: '明线', description: '玉佩', method: '特写' }
      ],
      advanced: [],
      resolved: []
    },
    timeline: { current_story_date: '第三日', events: ['离城'] }
  }))
  applyStateDelta(db, 'project-1', 4, normalizeStateDelta({
    characters_updated: [{
      character_id: '顾川',
      changes: { mental_state: '焦躁' }
    }]
  }))

  // 删除单个伏笔卡片
  const fsSnapshot = deleteStoryStateItem(db, 'project-1', 'foreshadowing', '伏笔-1')
  assert.equal(fsSnapshot.length, 1)
  assert.equal(fsSnapshot[0].foreshadowing_id, '伏笔-1')
  const fsRemain = db.prepare('SELECT foreshadowing_id FROM story_foreshadowing').all()
  assert.deepEqual(fsRemain.map((r) => r.foreshadowing_id), ['伏笔-2'])

  // 删除单个角色状态卡片（该角色全部状态记录）
  const csSnapshot = deleteStoryStateItem(db, 'project-1', 'characterStates', '林岚')
  assert.equal(csSnapshot.length, 1)
  assert.equal(csSnapshot[0].character_id, '林岚')
  const csRemain = db.prepare('SELECT character_id FROM story_character_state').all()
  assert.deepEqual(csRemain.map((r) => r.character_id), ['顾川'])

  // 删除单条时间线卡片
  const tlSnapshot = deleteStoryStateItem(db, 'project-1', 'timeline', 3)
  assert.equal(tlSnapshot.length, 1)
  assert.equal(tlSnapshot[0].chapter_index, 3)
  const tlRemain = db.prepare('SELECT chapter_index FROM story_timeline').all()
  assert.deepEqual(tlRemain.map((r) => r.chapter_index), [])
})
