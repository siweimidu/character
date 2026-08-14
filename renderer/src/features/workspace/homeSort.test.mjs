import { describe, it, expect, vi, beforeAll } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomepageProjectCollection from '@/components/home/HomepageProjectCollection.vue'

beforeAll(() => {
  // mock Electron API
  window.characterArc = new Proxy({}, {
    get: (target, prop) => {
      if (typeof prop === 'string' && prop.startsWith('on')) {
        return vi.fn()
      }
      return undefined
    }
  })
})

// 简化 HomepageProjectCard，只保留 pointer 事件透传
vi.mock('@/components/home/HomepageProjectCard.vue', () => ({
  default: defineComponent({
    name: 'HomepageProjectCard',
    props: ['project', 'menuOptions', 'animationDelay', 'selectMode', 'selected', 'draggable', 'isDragging', 'suppressClick'],
    emits: ['open', 'menuSelect', 'toggleSelect', 'pointerDown', 'clickConsumed'],
    setup(props, { emit }) {
      return () =>
        h(
          'article',
          {
            class: 'homepage-project-card',
            'data-project-id': props.project.id,
            onPointerdown: (e) => emit('pointerDown', e, props.project.id)
          },
          props.project.title
        )
    }
  })
}))

const projects = [
  { id: 'p1', title: '作品一', createdAt: '2024-01-01', lastEdited: '2024-01-01', wordCount: '100 字', genre: '都市', novelLength: '长篇', cover: null },
  { id: 'p2', title: '作品二', createdAt: '2024-01-02', lastEdited: '2024-01-02', wordCount: '200 字', genre: '都市', novelLength: '长篇', cover: null },
  { id: 'p3', title: '作品三', createdAt: '2024-01-03', lastEdited: '2024-01-03', wordCount: '300 字', genre: '都市', novelLength: '长篇', cover: null }
]

function makeWrapper() {
  setActivePinia(createPinia())
  return mount(HomepageProjectCollection, {
    props: { projects, menuOptions: [] }
  })
}

describe('首页手动拖拽排序', () => {
  it('pointerdown 后移动超过阈值应进入手动排序并重排', async () => {
    const wrapper = makeWrapper()
    await wrapper.vm.$nextTick()

    // 找到第一张卡片
    const card = wrapper.find('.homepage-project-card[data-project-id="p1"]')
    expect(card.exists()).toBe(true)

    // 模拟 pointerdown 在 p1 上
    const down = new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true })
    card.element.dispatchEvent(down)
    await wrapper.vm.$nextTick()

    // 模拟 pointermove 到 p3 的位置，距离超过 6px
    const p1 = wrapper.find('.homepage-project-card[data-project-id="p1"]')
    const p3 = wrapper.find('.homepage-project-card[data-project-id="p3"]')
    p3.element.getBoundingClientRect = () => ({ x: 100, y: 100, width: 200, height: 100, top: 100, right: 300, bottom: 200, left: 100, toJSON: () => ({}) })
    // 被拖拽的 p1（放大置顶）遮挡在 p3 上方：elementsFromPoint 返回 [p1, p3]，
    // 修复前 elementFromPoint 只会命中 p1 自身导致“没反应”，修复后应跳过 p1 命中 p3
    document.elementsFromPoint = () => [p1.element, p3.element]
    const move = new PointerEvent('pointermove', { pointerId: 1, clientX: 105, clientY: 160, bubbles: true })
    window.dispatchEvent(move)
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 50))
    await wrapper.vm.$nextTick()

    // 模拟 pointerup
    const up = new PointerEvent('pointerup', { pointerId: 1, bubbles: true })
    window.dispatchEvent(up)
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 50))
    await wrapper.vm.$nextTick()

    const reorderAfter = wrapper.emitted('reorder')
    expect(reorderAfter?.length).toBe(1)
    if (reorderAfter?.length) {
      // p1 拖到 p3 下方（p3 在 index 2，belowMid=true → 插到末尾）→ 期望 [p2,p3,p1]
      expect(reorderAfter[0][0]).toEqual(['p2', 'p3', 'p1'])
    }
  })
})
