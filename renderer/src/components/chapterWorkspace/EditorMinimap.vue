<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

/**
 * 正文右侧预览缩略图（类似 VSCode minimap）。
 * 将正文内容按行绘制为极小的文字缩略，显示从上到下的整体预览，
 * 并叠加当前可视区域高亮框，支持点击/拖动快速定位。
 */

const props = defineProps<{
  /** 当前可见状态 */
  visible: boolean
  /** 获取正文纯文本：由父组件注入，随编辑器内容实时更新 */
  getText: () => string
  /** 正文滚动容器 */
  scrollContainer: HTMLDivElement | null
}>()

const emit = defineEmits<{
  close: []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const minimapRef = ref<HTMLDivElement | null>(null)

const MINIMAP_WIDTH = 96
const MINIMAP_PADDING = 8
const LINE_HEIGHT_PX = 4 // 每行在缩略图中的固定高度
const FONT_PX = 3.2 // 缩略文字字号

let rafId = 0
let dragging = false

function draw(): void {
  const canvas = canvasRef.value
  const el = props.scrollContainer
  if (!canvas || !el) return
  const text = props.getText()
  const lines = text.split('\n')
  const dpr = window.devicePixelRatio || 1
  const cssW = MINIMAP_WIDTH - MINIMAP_PADDING * 2
  const cssH = Math.max(40, el.clientHeight - 8)
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const total = Math.max(1, el.scrollHeight)
  const usable = cssH - 2
  // 缩放比例：内容总高度 -> 缩略图可用高度
  const scale = usable / total

  ctx.font = `${FONT_PX}px monospace`
  ctx.textBaseline = 'top'
  const color = getComputedStyle(el).color || '#888'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const lineY = (i * LINE_HEIGHT_PX) * scale
    if (lineY > usable) break
    // 绘制当前行文字（截断到可视宽度）
    const maxChars = Math.floor(cssW / FONT_PX)
    const clipped = line.length > maxChars ? line.slice(0, maxChars) : line
    ctx.globalAlpha = 0.55
    ctx.fillStyle = color
    ctx.fillText(clipped, 0, lineY)
    ctx.globalAlpha = 1
  }

  drawViewport(ctx, cssW, cssH, scale)
}

function drawViewport(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, scale: number): void {
  const el = props.scrollContainer
  if (!el) return
  const vp = el.clientHeight
  const total = el.scrollHeight
  if (total <= 0) return
  const top = el.scrollTop
  const vpH = vp * scale
  const vpY = top * scale
  // 可视区域高亮
  ctx.fillStyle = 'rgba(128, 128, 128, 0.22)'
  ctx.fillRect(0, vpY, cssW, Math.min(vpH, cssH - vpY))
  // 边框
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, vpY + 0.5, cssW - 1, Math.min(vpH, cssH - vpY) - 1)
}

function scheduleDraw(): void {
  if (!props.visible) return
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(draw)
}

function jumpToClientY(clientY: number): void {
  const el = props.scrollContainer
  const canvas = canvasRef.value
  if (!el || !canvas) return
  const rect = canvas.getBoundingClientRect()
  const y = clientY - rect.top
  const ratio = y / Math.max(1, rect.height)
  el.scrollTop = ratio * el.scrollHeight
}

function onPointerDown(e: PointerEvent): void {
  dragging = true
  jumpToClientY(e.clientY)
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  jumpToClientY(e.clientY)
}

function onPointerUp(): void {
  dragging = false
}

function onWheel(e: WheelEvent): void {
  const el = props.scrollContainer
  if (!el) return
  el.scrollTop += e.deltaY
  e.preventDefault()
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      nextTick(scheduleDraw)
    }
  }
)

watch(
  () => props.scrollContainer,
  () => nextTick(scheduleDraw)
)

// 由父组件通过 expose 触发重绘（编辑器内容/滚动变化时调用）
defineExpose({ redraw: scheduleDraw })
</script>

<template>
  <Transition name="arc-minimap-fade">
    <div
      v-if="visible"
      ref="minimapRef"
      class="arc-minimap"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @wheel="onWheel"
      @contextmenu.prevent="$emit('close')"
    >
      <canvas ref="canvasRef" class="arc-minimap-canvas" />
      <button class="arc-minimap-close" title="关闭预览缩略图" @pointerdown.stop @click="$emit('close')">
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.arc-minimap {
  position: relative;
  flex-shrink: 0;
  width: 104px;
  height: 100%;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16px;
  cursor: pointer;
  user-select: none;
  background: color-mix(in srgb, var(--arc-bg-body) 92%, transparent);
  border-left: 1px solid var(--arc-border);
  overflow: hidden;
}

.arc-minimap-canvas {
  display: block;
  margin-top: 8px;
}

.arc-minimap-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  line-height: 16px;
  text-align: center;
  padding: 0;
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  font-size: 14px;
  cursor: pointer;
}

.arc-minimap-close:hover {
  color: var(--arc-text-primary);
  border-color: var(--arc-border-strong);
}

.arc-minimap-fade-enter-active,
.arc-minimap-fade-leave-active {
  transition: opacity 0.12s;
}

.arc-minimap-fade-enter-from,
.arc-minimap-fade-leave-to {
  opacity: 0;
}
</style>
