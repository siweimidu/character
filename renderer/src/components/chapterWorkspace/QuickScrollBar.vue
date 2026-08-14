<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 章节正文右侧的「快速滑动按钮」。
 *
 * 用于替代旧的 VSCode 风格「预览缩略图」（EditorMinimap）：
 *   - 不再渲染正文缩略预览，只提供一个简洁的纵向滑轨 + 滑块按钮。
 *   - 滑块位置与正文滚动严格同步，实时反映当前可视区域在全文中的位置。
 *   - 点击滑轨任意位置可快速跳转，按住滑块上下拖动可连续滚动到全文任意位置。
 *   - 正文内容 / 滚动 / 切换章节时由父组件调用 redraw() 同步滑块。
 */

const props = defineProps<{
  /** 当前可见状态 */
  visible: boolean
  /** 正文滚动容器 */
  scrollContainer: HTMLDivElement | null
}>()

const emit = defineEmits<{
  close: []
}>()

const trackRef = ref<HTMLDivElement | null>(null)

// ── 滑块状态 ──────────────────────────────────────────────────

const thumbTop = ref(0)
const thumbHeight = ref(0)
let dragging = false
let dragOffset = 0

// ── 计算滑块位置 ──────────────────────────────────────────────

/** 根据正文滚动状态刷新滑块位置与高度。 */
function redraw(): void {
  const el = props.scrollContainer
  const track = trackRef.value
  if (!el || !track || !props.visible) return

  const trackH = track.clientHeight
  if (trackH <= 0) {
    thumbTop.value = 0
    thumbHeight.value = 0
    return
  }

  // 正文不可滚动时隐藏滑块。
  if (el.scrollHeight <= el.clientHeight) {
    thumbTop.value = 0
    thumbHeight.value = 0
    return
  }

  // 可视区域占比 → 滑块高度。
  const visibleFrac = Math.min(1, el.clientHeight / el.scrollHeight)
  const h = Math.max(24, visibleFrac * trackH)
  thumbHeight.value = h

  // 滚动进度 → 滑块位置（保证滑到底时滑块贴底）。
  const scrollable = el.scrollHeight - el.clientHeight
  const scrollFrac = scrollable > 0 ? Math.min(1, Math.max(0, el.scrollTop / scrollable)) : 0
  thumbTop.value = scrollFrac * Math.max(0, trackH - h)
}

// ── 交互（点击跳转 / 拖拽同步）────────────────────────────────

/** 把事件 clientY 换算为正文 scrollTop 并滚动。 */
function jumpToClientY(clientY: number): void {
  const el = props.scrollContainer
  const track = trackRef.value
  if (!el || !track || el.scrollHeight <= el.clientHeight) return
  const rect = track.getBoundingClientRect()
  if (rect.height <= 0) return

  const trackH = rect.height
  const visibleFrac = Math.min(1, el.clientHeight / el.scrollHeight)
  const h = Math.max(24, visibleFrac * trackH)
  const localY = Math.max(0, Math.min(clientY - rect.top, trackH))
  const scrollable = el.scrollHeight - el.clientHeight
  // 将滑块中心对齐到点击位置（拖拽时用按下点的偏移量）。
  const centerY = dragging ? localY - dragOffset : localY - h / 2
  const boxTop = Math.max(0, Math.min(centerY, trackH - h))
  const scrollFrac = boxTop / Math.max(1, trackH - h)
  el.scrollTop = Math.round(scrollFrac * scrollable)
}

function onTrackPointerDown(e: PointerEvent): void {
  const el = props.scrollContainer
  const track = trackRef.value
  if (!el || !track || el.scrollHeight <= el.clientHeight) return
  dragging = true
  const rect = track.getBoundingClientRect()
  const trackH = rect.height
  const visibleFrac = Math.min(1, el.clientHeight / el.scrollHeight)
  const h = Math.max(24, visibleFrac * trackH)
  // 记录按下点相对滑块顶部的偏移，拖拽时保持手感连续。
  const localY = e.clientY - rect.top
  dragOffset = localY - thumbTop.value
  dragOffset = Math.max(0, Math.min(dragOffset, h))
  jumpToClientY(e.clientY)
  track.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  jumpToClientY(e.clientY)
}

function onPointerUp(): void {
  dragging = false
}

/** 滚轮在滑轨上滑动 → 同步主编辑器滚动。 */
function onWheel(e: WheelEvent): void {
  const el = props.scrollContainer
  if (!el) return
  el.scrollTop += e.deltaY
  e.preventDefault()
}

// ── 生命周期 ──────────────────────────────────────────────────

onMounted(() => {
  window.addEventListener('resize', redraw)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', redraw)
})

// 可见性变化或滚动容器就绪时刷新一次滑块位置。
watch(
  () => [props.visible, props.scrollContainer] as const,
  () => {
    if (props.visible) nextTick(() => requestAnimationFrame(redraw))
  },
  { immediate: true }
)

defineExpose({ redraw })
</script>

<template>
  <Transition name="arc-qsb-fade">
    <div
      v-if="visible"
      ref="trackRef"
      class="arc-qsb"
      title="快速滑动（拖动滑块或点击滑轨跳转到正文任意位置）"
      @pointerdown="onTrackPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @wheel="onWheel"
    >
      <div class="arc-qsb-thumb" :style="{ top: thumbTop + 'px', height: thumbHeight + 'px' }" />
      <button
        class="arc-qsb-close"
        title="关闭快速滑动按钮"
        @pointerdown.stop
        @click="$emit('close')"
      >
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.arc-qsb {
  position: relative;
  flex-shrink: 0;
  width: 18px;
  height: 100%;
  z-index: 20;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 16px 0;
  cursor: pointer;
  user-select: none;
  background: color-mix(in srgb, var(--arc-bg-body) 92%, transparent);
  border-left: 1px solid var(--arc-border);
  overflow: hidden;
}

.arc-qsb-thumb {
  position: absolute;
  left: 50%;
  width: 6px;
  transform: translateX(-50%);
  border-radius: 3px;
  background: color-mix(in srgb, var(--arc-text-hint) 55%, transparent);
  transition: background 0.12s, width 0.12s;
}

.arc-qsb:hover .arc-qsb-thumb,
.arc-qsb:active .arc-qsb-thumb {
  width: 8px;
  background: color-mix(in srgb, var(--arc-text-secondary) 70%, transparent);
}

.arc-qsb-close {
  position: absolute;
  top: 4px;
  right: 1px;
  width: 14px;
  height: 14px;
  line-height: 12px;
  text-align: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
}

.arc-qsb:hover .arc-qsb-close {
  opacity: 1;
}

.arc-qsb-close:hover {
  color: var(--arc-text-primary);
}

.arc-qsb-fade-enter-active,
.arc-qsb-fade-leave-active {
  transition: opacity 0.12s;
}

.arc-qsb-fade-enter-from,
.arc-qsb-fade-leave-to {
  opacity: 0;
}
</style>
