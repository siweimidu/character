<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, CornerDownLeft, Search } from 'lucide-vue-next'
import type { CommandPaletteAction } from './editorCommandPalette'

const props = defineProps<{
  visible: boolean
  actions: CommandPaletteAction[]
  /** 当前搜索关键词（用于在列表项里高亮匹配） */
}>()

const emit = defineEmits<{
  close: []
  select: [action: CommandPaletteAction]
}>()

const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const selectedIndex = ref(0)

function resetState(): void {
  query.value = ''
  selectedIndex.value = 0
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.actions
  return props.actions.filter((a) => {
    const haystack = `${a.title} ${a.keywords ?? ''} ${a.section ?? ''}`.toLowerCase()
    return haystack.includes(q)
  })
})

function move(delta: number): void {
  const list = filtered.value
  if (list.length === 0) return
  const next = (selectedIndex.value + delta + list.length) % list.length
  selectedIndex.value = next
  // 让选中项滚动到可视区域
  requestAnimationFrame(() => {
    document.querySelector('[data-cmd-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

function run(action: CommandPaletteAction | undefined): void {
  if (!action) return
  emit('select', action)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    run(filtered.value[selectedIndex.value])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      resetState()
      nextTick(() => inputRef.value?.focus())
    }
  }
)

// 命令数量变化时把选中索引钳制在范围内
watch(filtered, (list) => {
  if (selectedIndex.value >= list.length) selectedIndex.value = Math.max(0, list.length - 1)
})

onBeforeUnmount(() => {
  // noop
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="cmd-palette-overlay"
      @mousedown.self="emit('close')"
      @keydown="onKeydown"
    >
      <div class="cmd-palette" role="dialog" aria-label="命令面板">
        <div class="cmd-input-row">
          <Search :size="16" class="cmd-search-icon" />
          <input
            ref="inputRef"
            v-model="query"
            class="cmd-input"
            placeholder="输入命令或关键词…（Ctrl+Shift+P 呼出）"
            @keydown="onKeydown"
          />
          <kbd class="cmd-esc">esc</kbd>
        </div>
        <div class="cmd-list">
          <template v-if="filtered.length > 0">
            <div
              v-for="(action, idx) in filtered"
              :key="`${action.id}-${idx}`"
              class="cmd-item"
              :class="{ selected: idx === selectedIndex }"
              :data-cmd-selected="idx === selectedIndex ? 'true' : 'false'"
              @mousedown.prevent="run(action)"
              @mouseenter="selectedIndex = idx"
            >
              <span class="cmd-item-title">
                <component :is="action.icon" v-if="action.icon" :size="14" class="cmd-item-icon" />
                {{ action.title }}
              </span>
              <span class="cmd-item-meta">
                <kbd v-if="action.keyHint" class="cmd-key">{{ action.keyHint }}</kbd>
                <CornerDownLeft v-else :size="12" />
              </span>
            </div>
          </template>
          <div v-else class="cmd-empty">没有匹配的命令</div>
        </div>
        <div class="cmd-footer">
          <span><CornerDownLeft :size="12" /> 执行</span>
          <span><ArrowRight :size="12" /> ↑↓ 导航</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmd-palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}

.cmd-palette {
  width: min(560px, 92vw);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--arc-bg, #1e1e1e);
  border: 1px solid var(--arc-border, #3c3c3c);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.cmd-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--arc-border, #3c3c3c);
}

.cmd-search-icon {
  color: var(--arc-text-muted, #9d9d9d);
  flex-shrink: 0;
}

.cmd-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--arc-text, #e6e6e6);
  font-size: 14px;
}

.cmd-esc {
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--arc-border, #3c3c3c);
  border-radius: 4px;
  color: var(--arc-text-muted, #9d9d9d);
}

.cmd-list {
  overflow-y: auto;
  padding: 6px;
  max-height: calc(60vh - 88px);
}

.cmd-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 5px;
  cursor: pointer;
  gap: 8px;
}

.cmd-item.selected {
  background: var(--arc-accent-soft, rgba(56, 132, 255, 0.2));
}

.cmd-item-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text, #e6e6e6);
  font-size: 13px;
  min-width: 0;
}

.cmd-item-icon {
  color: var(--arc-text-muted, #9d9d9d);
  flex-shrink: 0;
}

.cmd-item-meta {
  display: inline-flex;
  align-items: center;
  color: var(--arc-text-hint, #6e6e6e);
  flex-shrink: 0;
}

.cmd-key {
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid var(--arc-border, #3c3c3c);
  border-radius: 3px;
  color: var(--arc-text-muted, #9d9d9d);
}

.cmd-empty {
  padding: 24px;
  text-align: center;
  color: var(--arc-text-hint, #6e6e6e);
  font-size: 13px;
}

.cmd-footer {
  display: flex;
  gap: 16px;
  padding: 7px 14px;
  border-top: 1px solid var(--arc-border, #3c3c3c);
  color: var(--arc-text-hint, #6e6e6e);
  font-size: 11px;
  align-items: center;
}
</style>
