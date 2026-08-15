import assert from 'node:assert/strict'
import test from 'node:test'

import { fuzzyResolveSkill } from './skill-tools.ts'

function skill(id, name, path, description) {
  return {
    id,
    name,
    version: '1.0.0',
    path,
    scope: 'builtin',
    rootDir: `/skills/${id}`,
    description,
    source: 'builtin',
    compatibility: 'native',
    compatibilityNote: '',
    enabled: true,
    referencesCount: 0,
    referenceFiles: [],
    content: '',
    manifest: {
      category: 'tool',
      tasks: [],
      stages: [],
      triggers: [],
      priority: 0,
      references: []
    }
  }
}

const skills = [
  skill('mingli-master', '命理大师', 'skills/divination/mingli-master', '八字算命、紫微斗数等传统命理分析'),
  skill('writing-polish', '润色助手', 'skills/writing/polish', '文本润色、语言打磨'),
  skill('cover-design', '封面设计', 'skills/cover/design', '作品封面设计与排版')
]

test('精确匹配 id 返回自身', () => {
  assert.equal(fuzzyResolveSkill('mingli-master', skills)?.id, 'mingli-master')
})

test('部分匹配 id 命中最高度接近的 skill', () => {
  assert.equal(fuzzyResolveSkill('mingli', skills)?.id, 'mingli-master')
})

test('分隔符/大小写差异也能命中', () => {
  assert.equal(fuzzyResolveSkill('mingli_master', skills)?.id, 'mingli-master')
  assert.equal(fuzzyResolveSkill('Mingli-Master', skills)?.id, 'mingli-master')
})

test('中文名称命中', () => {
  assert.equal(fuzzyResolveSkill('命理', skills)?.id, 'mingli-master')
})

test('完全无关的查询不误配', () => {
  assert.equal(fuzzyResolveSkill('nonexistent-xyz', skills), undefined)
})

test('空查询返回 undefined', () => {
  assert.equal(fuzzyResolveSkill('', skills), undefined)
})
