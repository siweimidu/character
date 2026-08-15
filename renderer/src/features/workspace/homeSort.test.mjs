import { describe, it, expect, vi, beforeAll } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomepageProjectCollection from '@/components/home/HomepageProjectCollection.vue'
import { useAppStore } from '@/stores/app'

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

// 简化 HomepageProjectCard，只保留上/下移动按钮的透传与事件
vi.mock('@/components/home/HomepageProjectCard.vue', () => ({
  default: defineComponent({
    name: 'HomepageProjectCard',
    props: ['project', 'menuOptions', 'animationDelay', 'selectMode', 'selected', 'manualSort', 'moveUpDisabled', 'moveDownDisabled'],
    emits: ['open', 'menuSelect', 'toggleSelect', 'moveUp', 'moveDown'],
    setup(props, { emit }) {
      return () =>
        h(
          'article',
          {
            class: 'homepage-project-card',
            'data-project-id': props.project.id
          },
          [
            h('button', {
              class: 'move-up-btn',
              disabled: props.moveUpDisabled || undefined,
              onClick: () => emit('moveUp', props.project.id)
            }),
            h('button', {
              class: 'move-down-btn',
              disabled: props.moveDownDisabled || undefined,
              onClick: () => emit('moveDown', props.project.id)
            })
          ]
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

describe('首页手动排序（上下箭头按钮）', () => {
  it('手动排序模式下点击下移按钮应重排并提交新顺序', async () => {
    const wrapper = makeWrapper()
    const store = useAppStore()
    // 切换到手动排序
    store.setProjectSortMode('manual')
    await wrapper.vm.$nextTick()

    // 点击 p1 卡片的下移按钮 → [p2, p1, p3]
    const downBtn = wrapper.find('.homepage-project-card[data-project-id="p1"] .move-down-btn')
    expect(downBtn.exists()).toBe(true)
    await downBtn.trigger('click')

    const reorderAfter = wrapper.emitted('reorder')
    expect(reorderAfter?.length).toBe(1)
    expect(reorderAfter[0][0]).toEqual(['p2', 'p1', 'p3'])
  })

  it('首卡上移按钮与末卡下移按钮应被禁用（disabled）', async () => {
    const wrapper = makeWrapper()
    const store = useAppStore()
    store.setProjectSortMode('manual')
    await wrapper.vm.$nextTick()

    // 第一张卡：上移禁用
    const p1Up = wrapper.find('.homepage-project-card[data-project-id="p1"] .move-up-btn')
    // 最后一张卡：下移禁用
    const p3Down = wrapper.find('.homepage-project-card[data-project-id="p3"] .move-down-btn')
    expect(p1Up.attributes('disabled')).toBeDefined()
    expect(p3Down.attributes('disabled')).toBeDefined()
  })
})
