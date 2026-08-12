<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 正文右侧预览缩略图（类似 VSCode minimap）。
 * 将正文内容按行绘制为极小的文字缩略，显示从上到下的整体预览，
 * 并叠加当前可视区域高亮框，支持点击/拖动快速定位。
 *
 * 实现参考 VSCode minimap：
 * - 行高固定（LINE_HEIGHT_PX），字号与行高匹配
 * - 内容总高度 = 总行数 × 行高，映射到 canvas 可视高度
 * - 视口框通过编辑器 scrollTop/scrollHeight 映射
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
const LINE_HEIGHT_PX = 6 // 每行在缩略图中的固定高度（含字高+间距）
const FONT_PX = 5.5 // 缩略文字字号
const CHAR_WIDTH_PX = Math.floor(FONT_PX * 0.6) // monospace 字符宽度 ≈ 0.6 * fontSize

let rafId = 0
let dragging = false

function getContentLines(): string[] {
  const text = (props.getText() || '').trim()
  // 空内容时给一个占位行，避免 canvas 完全空白
  if (!text) return [' ']
  return text.split('\n')
}

function draw(): void {
  const canvas = canvasRef.value
  const el = props.scrollContainer
  if (!canvas || !el) return
  const lines = getContentLines()

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

  // 内容总高度（按总行数 × 行高，保留空行结构）
  const contentTotalH = Math.max(1, lines.length) * LINE_HEIGHT_PX
  const usable = cssH - 4
  // 缩放比例：内容总高度 -> canvas 可视高度
  const scale = usable / contentTotalH

  ctx.font = `${FONT_PX}px monospace`
  ctx.textBaseline = 'middle'
  // 使用主题变量解析出可见文字颜色，并兜底为深灰，避免依赖 DOM 计算色导致透明/空白
  const rootStyle = getComputedStyle(document.documentElement)
  const color = rootStyle.getPropertyValue('--arc-text-secondary').trim()
    || rootStyle.getPropertyValue('--arc-text-primary').trim()
    || '#52525b'

  const maxChars = Math.max(1, Math.floor(cssW / CHAR_WIDTH_PX))

  // 逐行绘制，使用原始行号映射 y 坐标，保留文档空行结构（类似 VSCode）
  const topPad = 2
  ctx.globalAlpha = 0.85
  ctx.fillStyle = color
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const y = topPad + (i * LINE_HEIGHT_PX + LINE_HEIGHT_PX / 2) * scale
    if (y > cssH) break
    const clipped = line.length > maxChars ? line.slice(0, maxChars) : line
    ctx.fillText(clipped, 0, y, cssW)
  }
  ctx.globalAlpha = 1

  drawViewport(ctx, cssW, cssH)
}

function drawViewport(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
  const el = props.scrollContainer
  if (!el) return
  const vp = el.clientHeight
  const total = el.scrollHeight
  if (total <= 0) return
  const scale = (cssH - 4) / total
  const top = el.scrollTop
  const vpH = Math.max(10, vp * scale)
  const vpY = Math.max(0, top * scale)
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
      // 多等一帧确保容器尺寸稳定后再绘制
      nextTick(() => requestAnimationFrame(scheduleDraw))
    }
  },
  { immediate: true }
)

watch(
  () => props.scrollContainer,
  () => nextTick(() => requestAnimationFrame(scheduleDraw))
)

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
})

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
