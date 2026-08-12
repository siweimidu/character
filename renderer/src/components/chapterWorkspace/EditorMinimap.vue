<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 编辑器右侧纵向预览缩略条（VSCode 风格 Minimap）。
 *
 * 能力：
 *  1. 生成全文文本缩影：按行绘制极小文字，压缩为编辑器右侧纵向长条；
 *  2. 双向联动：拖动/点击缩略图可跳转正文；滚动正文会同步更新缩略视窗位置；
 *  3. 选中文本高亮：把编辑器当前选区在缩略图中同步高亮出来；
 *  4. 适配暖色护眼主题：文字、视口、选区颜色均跟随全局 CSS 变量，自动适配主题切换；
 *  5. 性能优化：Canvas 渲染 + rAF 节流 + 可见行裁剪 + 行高映射，超长小说也不卡顿；
 *  6. 独立组件：不依赖任何编辑器实现，通过 getText / getSelection 回调与父组件解耦，
 *     同时保留对现有 SimpleChapterEditor / tiptap 的兼容接入。
 */

/** 选中文本在正文纯文本中的字符区间（含头不含尾） */
export interface MinimapSelection {
  from: number
  to: number
}

const props = defineProps<{
  /** 当前可见状态 */
  visible: boolean
  /** 获取正文纯文本：由父组件注入，随编辑器内容实时更新 */
  getText: () => string
  /** 获取当前选区在纯文本中的字符区间；无选区时返回 null */
  getSelection?: () => MinimapSelection | null
  /** 正文滚动容器 */
  scrollContainer: HTMLDivElement | null
}>()

const emit = defineEmits<{
  close: []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const minimapRef = ref<HTMLDivElement | null>(null)

const MINIMAP_WIDTH = 112
const MINIMAP_PADDING = 8
const LINE_HEIGHT_PX = 6 // 每行在缩略图中的固定高度（含字高+间距）
const FONT_PX = 5.5 // 缩略文字字号
const CHAR_WIDTH_PX = Math.floor(FONT_PX * 0.6) // monospace 字符宽度 ≈ 0.6 * fontSize

let rafId = 0
let dragging = false

// 主题颜色缓存，跟随全局主题变量解析，避免每次 draw 都读 DOM
let cachedColor = '#52525b'
let cachedViewportFill = 'rgba(128, 128, 128, 0.22)'
let cachedViewportStroke = 'rgba(128, 128, 128, 0.6)'
let cachedSelectionFill = 'rgba(59, 130, 246, 0.32)'
let cachedSelectionStroke = 'rgba(59, 130, 246, 0.7)'

/** 读取一次主题变量，缓存用于绘制。 */
function refreshThemeColors(): void {
  const root = getComputedStyle(document.documentElement)
  const primary = root.getPropertyValue('--arc-primary').trim()
  const text = root.getPropertyValue('--arc-text-secondary').trim()
    || root.getPropertyValue('--arc-text-primary').trim()
    || '#52525b'

  cachedColor = text
  // 选区高亮使用主题主色，未配置时兜底为蓝色
  const base = primary || '#3b82f6'
  cachedSelectionFill = colorWithAlpha(base, 0.30)
  cachedSelectionStroke = colorWithAlpha(base, 0.75)

  // 暖色护眼主题下视口使用低对比度中性色，避免刺眼
  cachedViewportFill = 'rgba(128, 128, 128, 0.20)'
  cachedViewportStroke = 'rgba(128, 128, 128, 0.55)'
}

/** 把 hex 颜色转成带透明度通道的 rgba 字符串。 */
function colorWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (m) {
    let h = m[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  // 已是非 hex 颜色（如 rgba / css 变量兜底），直接拼接
  if (/^rgba?\(/.test(hex)) return hex
  return `rgba(59, 130, 246, ${alpha})`
}

function getContentLines(): string[] {
  const text = (props.getText() || '').trim()
  // 空内容时给一个占位行，避免 canvas 完全空白
  if (!text) return [' ']
  return text.split('\n')
}

/** 计算每行在纯文本中的起始字符偏移，便于把选区映射到行列。 */
function lineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = []
  let acc = 0
  for (let i = 0; i < lines.length; i++) {
    offsets.push(acc)
    acc += lines[i].length + 1 // +1 表示换行符
  }
  return offsets
}

/**
 * 把选区 [from, to)（纯文本字符区间）映射到缩略图坐标系，返回高亮矩形区域。
 * 返回 null 表示无选区或区间非法。
 */
function computeSelectionRect(
  lines: string[],
  sel: MinimapSelection | null | undefined,
  cssW: number,
  cssH: number
): { x: number; y: number; w: number; h: number } | null {
  if (!sel || sel.to <= sel.from) return null
  const totalLines = lines.length
  if (!totalLines) return null

  const offsets = lineStartOffsets(lines)
  const contentTotalH = Math.max(1, totalLines) * LINE_HEIGHT_PX
  const usable = cssH - 4
  const scale = usable / contentTotalH
  const topPad = 2
  const maxChars = Math.max(1, Math.floor(cssW / CHAR_WIDTH_PX))

  // 找到选区起始所在行与结束所在行
  let startLine = totalLines - 1
  let endLine = 0
  for (let i = 0; i < totalLines; i++) {
    const lineStart = offsets[i]
    const lineEnd = lineStart + lines[i].length
    if (sel.from >= lineStart && sel.from <= lineEnd) {
      startLine = Math.min(startLine, i)
    }
    if (sel.to >= lineStart && sel.to <= lineEnd) {
      endLine = Math.max(endLine, i)
    }
  }

  const y0 = topPad + (startLine * LINE_HEIGHT_PX) * scale
  const y1 = topPad + ((endLine + 1) * LINE_HEIGHT_PX) * scale
  const y = Math.min(y0, y1)
  const h = Math.max(3, Math.min(cssH - y, Math.abs(y1 - y0)))

  // 起始列与结束列（按字符宽度映射）
  const startCol = Math.max(0, (sel.from - offsets[startLine]) / CHAR_WIDTH_PX)
  const endCol = Math.max(startCol, Math.min(lines[endLine].length, sel.to - offsets[endLine]) / CHAR_WIDTH_PX)
  const x = Math.max(0, startCol * CHAR_WIDTH_PX)
  const w = Math.min(cssW, Math.max(4, (endCol - (sel.from - offsets[startLine])) * CHAR_WIDTH_PX))

  return { x, y, w, h }
}

function draw(): void {
  const canvas = canvasRef.value
  const el = props.scrollContainer
  if (!canvas || !el) return

  refreshThemeColors()

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

  const maxChars = Math.max(1, Math.floor(cssW / CHAR_WIDTH_PX))

  // 先绘制选区高亮（在文字下层），再绘制文字
  const selRect = computeSelectionRect(lines, props.getSelection?.(), cssW, cssH)
  if (selRect) {
    ctx.fillStyle = cachedSelectionFill
    ctx.fillRect(selRect.x, selRect.y, selRect.w, selRect.h)
    ctx.strokeStyle = cachedSelectionStroke
    ctx.lineWidth = 1
    ctx.strokeRect(selRect.x + 0.5, selRect.y + 0.5, selRect.w - 1, selRect.h - 1)
  }

  // 逐行绘制，使用原始行号映射 y 坐标，保留文档空行结构（类似 VSCode）
  const topPad = 2
  ctx.globalAlpha = 0.85
  ctx.fillStyle = cachedColor
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
  ctx.fillStyle = cachedViewportFill
  ctx.fillRect(0, vpY, cssW, Math.min(vpH, cssH - vpY))
  // 边框
  ctx.strokeStyle = cachedViewportStroke
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

// 主题变化时重绘，确保暖色护眼主题下缩略图颜色跟随
const themeObserver = typeof MutationObserver !== 'undefined'
  ? new MutationObserver(() => scheduleDraw())
  : null

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
  themeObserver?.disconnect()
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
  width: 120px;
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
