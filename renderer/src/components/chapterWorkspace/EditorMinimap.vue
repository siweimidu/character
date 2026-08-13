<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 编辑器右侧纵向预览缩略条（VSCode 风格 Minimap）。
 *
 * 本次为彻底重构，学习 VSCode 的实现思路，修复此前版本的两个顽固问题：
 *
 * 一、为什么之前「显示乱码」？
 *   旧实现把每个字符先采样再降采样成 2×5 的像素位图（VSCode 的
 *   minimapCharRenderer 思路）。但这种方式对笔画繁多的中文并不适用：
 *   中文被压成 2×5 个离散像素后，形同随机噪点，肉眼看到的就是「乱码」。
 *
 *   新实现改为「整行文字以连续抗锯齿方式直接小号绘制」（canvas fillText /
 *   整体 drawImage 缩放），中文字形会以连续渐变的纹理呈现，观感与 VSCode
 *   一致（像缩略图而不像乱码）。
 *
 * 二、为什么之前「滑动条跟正文不同步」？
 *   旧实现采用了「行采样」：当正文行数超过缩略图可容纳行数时，只挑选
 *   一部分代表性行来显示（_downsample）。采样后的缩略图高度与正文实际
 *   可滚动高度不再对应，于是视口框的换算、拖拽跳转的换算全部失真——
 *   表现为缩略图滚到底、正文却还能继续往下滑。
 *
 *   新实现改为「整篇文档等比压缩到缩略图一屏」（scale-to-fit）：
 *     lineHeight = 缩略图可视高度 / 总行数
 *   缩略图恒展示整篇文档，其内容总高恒等于可视高度，因此视口框位置、
 *   选区位置、点击/拖拽跳转都与正文可滚动范围严格 1:1 对应，彻底消除
 *   滚动不同步。
 *
 * 实现要点（对照 VSCode）：
 *   - 文字层与视口框分离：文字层渲染到离屏 canvas 并缓存（内容/主题/
 *     尺寸变化时才重绘），滚动时只重绘廉价的视口框，滚动流畅不卡顿。
 *   - 按行连续抗锯齿小号绘制，行数过密（每行不足 ~1.5px）时字号退化为
 *     1px、呈现为条形纹理，仍保证缩略图恒等于可视高度、滚动严格同步。
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

// ── 尺寸常量（CSS px）──────────────────────────────────────────
const MINIMAP_WIDTH = 112
const MINIMAP_PADDING = 8
/** 每行可读文字的最小缩略行高（CSS px）。低于此值则退化为整体缩略模式。 */
const MIN_TEXT_LINE_HEIGHT = 1.5
/** 缩略图中可见内容区与容器顶部的留白 */
const CONTENT_TOP_PAD = 0

// ── 离屏文字层缓存 ────────────────────────────────────────────
let textLayer: HTMLCanvasElement | null = null
let textLayerW = 0
let textLayerH = 0
let textLayerRenderedText = ''

let rafId = 0
let dragging = false

// ── 主题颜色缓存 ──────────────────────────────────────────────
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
  const base = primary || '#3b82f6'
  cachedSelectionFill = colorWithAlpha(base, 0.30)
  cachedSelectionStroke = colorWithAlpha(base, 0.75)
  cachedViewportFill = 'rgba(128, 128, 128, 0.20)'
  cachedViewportStroke = 'rgba(128, 128, 128, 0.55)'
}

/** 把 hex 颜色解析为 { r, g, b }，非 hex（rgba 等）回退为 null。 */
function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

/** 把 hex 颜色转成带透明度通道的 rgba 字符串。 */
function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = parseHexColor(hex)
  if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
  if (/^rgba?\(/.test(hex)) return hex
  return `rgba(59, 130, 246, ${alpha})`
}

/** 与 VSCode `strings.isFullWidthCharacter` 一致的宽字符判定。 */
function isFullWidthCharacter(charCode: number): boolean {
  return (
    (charCode >= 0x2e80 && charCode <= 0xd7af)
    || (charCode >= 0xf900 && charCode <= 0xfaff)
    || (charCode >= 0xff01 && charCode <= 0xff5e)
    || (charCode >= 0xffe0 && charCode <= 0xffe6)
  )
}

/** 一个字符的显示宽度（字符单元数，全角=2、半角=1）。 */
function charCellCount(ch: string): number {
  if (ch === '\t') return 4
  return isFullWidthCharacter(ch.charCodeAt(0)) ? 2 : 1
}

/** 获取正文块数组：按换行拆分为「一行」。空内容给一个占位行。 */
function getContentBlocks(): string[] {
  const text = (props.getText() || '').replace(/\r\n/g, '\n')
  if (!text.trim()) return ['']
  return text.split('\n')
}

/**
 * 计算缩略图布局：
 *   - lineHeight：整篇文档等比压缩到缩略图可视高度的单行高度。
 *   - contentTotalH：恒等于可视高度（scale-to-fit），因此与正文滚动严格同步。
 */
function computeLayout(
  blocks: string[],
  cssH: number
): { lineHeight: number; contentTotalH: number } {
  const lineCount = Math.max(1, blocks.length)
  const lineHeight = Math.max(0.5, cssH / lineCount)
  const contentTotalH = cssH
  return { lineHeight, contentTotalH }
}

/** 构建/复用离屏文字层 canvas，尺寸变化时重建。 */
function ensureTextLayer(pxW: number, pxH: number): HTMLCanvasElement {
  if (!textLayer || textLayer.width !== pxW || textLayer.height !== pxH) {
    textLayer = document.createElement('canvas')
    textLayer.width = pxW
    textLayer.height = pxH
  }
  return textLayer
}

/**
 * 渲染整篇文档到离屏文字层（连续抗锯齿方式，修复「乱码」）。
 * 返回本次渲染所用行高，供选区换算使用。
 */
function renderTextLayer(pxW: number, pxH: number, cssW: number, cssH: number): number {
  const layer = ensureTextLayer(pxW, pxH)
  const lctx = layer.getContext('2d')
  if (!lctx) return 0

  const dpr = pxW / cssW
  lctx.setTransform(1, 0, 0, 1, 0, 0)
  lctx.clearRect(0, 0, pxW, pxH)
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const blocks = getContentBlocks()
  const { lineHeight } = computeLayout(blocks, cssH)
  const fg = cachedColor

  // 按行直接小号绘制文字（连续抗锯齿，VSCode 缩略纹理观感）。
  // 行高不足 MIN_TEXT_LINE_HEIGHT 时字号退化为 1px，密集文档呈现为
  // 条形纹理，仍能正确反映全文概貌且滚动严格同步。
  const fontSize = lineHeight >= MIN_TEXT_LINE_HEIGHT
    ? Math.round(lineHeight)
    : Math.max(1, Math.floor(lineHeight))
  lctx.font = `${fontSize}px "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`
  lctx.textBaseline = 'middle'
  lctx.textAlign = 'left'
  lctx.fillStyle = fg
  lctx.textRendering = 'optimizeLegibility'
  for (let i = 0; i < blocks.length; i++) {
    const line = blocks[i]
    if (!line) continue
    const y = i * lineHeight + lineHeight / 2
    lctx.fillText(line, 0, y, cssW)
  }
  return lineHeight
}

/** 把「正文可视区高度比例」换算成缩略图视口框信息。 */
function computeViewport(
  el: HTMLDivElement,
  cssH: number
): { boxTop: number; boxHeight: number } {
  const vp = el.clientHeight
  const total = el.scrollHeight
  if (total <= 0) {
    return { boxTop: 0, boxHeight: cssH }
  }
  const visibleFrac = Math.min(1, vp / total)
  const boxHeight = Math.max(4, Math.min(cssH, visibleFrac * cssH))
  const scrollFrac = total > vp
    ? Math.min(1, Math.max(0, el.scrollTop / (total - vp)))
    : 0
  const boxTop = scrollFrac * Math.max(0, cssH - boxHeight)
  return { boxTop, boxHeight }
}

/** 计算某行内字符偏移的近似 x 坐标（用于选区高亮）。 */
function measureLinePrefix(
  ctx: CanvasRenderingContext2D,
  line: string,
  charOffset: number,
  fw: number,
  hw: number
): number {
  let w = 0
  const n = Math.min(charOffset, line.length)
  for (let i = 0; i < n; i++) {
    w += isFullWidthCharacter(line.charCodeAt(i)) ? fw : hw
  }
  return w
}

/** 把选区 [from, to)（全文本字符区间）映射到缩略图坐标（无采样，直接按行换算）。 */
function computeSelectionRect(
  blocks: string[],
  lineHeight: number,
  ctx: CanvasRenderingContext2D,
  sel: MinimapSelection | null | undefined,
  cssW: number,
  cssH: number
): { x: number; y: number; w: number; h: number } | null {
  if (!sel || sel.to <= sel.from) return null
  if (blocks.length === 0) return null

  // 计算每个块的起始字符偏移（与 getEditorText 的 \n 分隔一致）
  const offsets: number[] = []
  let acc = 0
  for (let i = 0; i < blocks.length; i++) {
    offsets.push(acc)
    acc += blocks[i].length + 1
  }

  let startSrc = -1
  let endSrc = -1
  for (let i = 0; i < blocks.length; i++) {
    const lineStart = offsets[i]
    const lineEnd = lineStart + blocks[i].length
    if (sel.from <= lineEnd && sel.to >= lineStart) {
      if (startSrc === -1) startSrc = i
      endSrc = i
    }
  }
  if (startSrc === -1 || endSrc === -1) return null

  const y0 = startSrc * lineHeight
  const y1 = (endSrc + 1) * lineHeight
  const y = Math.max(0, Math.min(y0, cssH - 3))
  const h = Math.max(3, Math.min(cssH - y, y1 - y0))

  // 近似测量字符宽度：半角 = 半角字宽，全角 = 全角字宽
  const fw = ctx.measureText('字').width
  const hw = ctx.measureText('a').width
  const x0 = measureLinePrefix(ctx, blocks[startSrc], sel.from - offsets[startSrc], fw, hw)
  const x1 = measureLinePrefix(ctx, blocks[endSrc], sel.to - offsets[endSrc], fw, hw)
  const x = Math.max(0, Math.min(x0, cssW - 4))
  const w = Math.max(4, Math.min(cssW - x, x1 - x0))

  return { x, y, w, h }
}

function draw(): void {
  const canvas = canvasRef.value
  const el = props.scrollContainer
  if (!canvas || !el) return

  refreshThemeColors()

  const dpr = window.devicePixelRatio || 1
  const cssW = MINIMAP_WIDTH - MINIMAP_PADDING * 2
  const cssH = Math.max(40, el.clientHeight - CONTENT_TOP_PAD * 2)
  const pxW = Math.max(1, Math.round(cssW * dpr))
  const pxH = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== pxW) canvas.width = pxW
  if (canvas.height !== pxH) canvas.height = pxH
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // ── 文字层：仅在内容/主题/尺寸变化时重建（滚动只复用缓存）──
  const text = props.getText() || ''
  const textChanged = text !== textLayerRenderedText
  if (textChanged || textLayerW !== pxW || textLayerH !== pxH) {
    textLayerRenderedText = text
    textLayerW = pxW
    textLayerH = pxH
    renderTextLayer(pxW, pxH, cssW, cssH)
  }

  // ── 上屏文字层 ──
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, pxW, pxH)
  if (textLayer) {
    ctx.drawImage(textLayer, 0, 0)
  }

  // ── 选区高亮（叠在文字上层）──
  const blocks = getContentBlocks()
  const { lineHeight } = computeLayout(blocks, cssH)
  const selRect = computeSelectionRect(blocks, lineHeight, ctx, props.getSelection?.(), cssW, cssH)
  if (selRect) {
    const sx = selRect.x * dpr
    const sy = selRect.y * dpr
    const sw = selRect.w * dpr
    const sh = selRect.h * dpr
    ctx.fillStyle = cachedSelectionFill
    ctx.fillRect(sx, sy, sw, sh)
    ctx.strokeStyle = cachedSelectionStroke
    ctx.lineWidth = Math.max(1, dpr)
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1)
  }

  drawViewport(ctx, pxW, pxH, cssH)
}

function drawViewport(
  ctx: CanvasRenderingContext2D,
  pxW: number,
  pxH: number,
  cssH: number
): void {
  const el = props.scrollContainer
  if (!el) return
  const { boxTop, boxHeight } = computeViewport(el, cssH)
  // 视口框为设备像素绘制（CSS 坐标 × 缩放比 = 设备像素）
  const scale = pxH / cssH
  const y = Math.max(0, Math.min(boxTop * scale, pxH - 3))
  const h = Math.max(3, Math.min(boxHeight * scale, pxH - y))
  ctx.fillStyle = cachedViewportFill
  ctx.fillRect(0, y, pxW, h)
  ctx.strokeStyle = cachedViewportStroke
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, y + 0.5, pxW - 1, h - 1)
}

/**
 * 把缩略图上的 y 坐标（CSS 坐标）映射为正文 scrollTop，用于点击/拖拽跳转。
 * 与 computeViewport 严格互为逆运算，保证拖拽时正文与缩略图严格同步。
 */
function yToScrollTop(clientY: number): number {
  const el = props.scrollContainer
  const canvas = canvasRef.value
  if (!el || !canvas) return 0
  const rect = canvas.getBoundingClientRect()
  const cssH = rect.height
  if (cssH <= 0) return 0
  const y = Math.max(0, Math.min(clientY - rect.top, cssH))

  const vp = el.clientHeight
  const total = el.scrollHeight
  if (total <= vp) return 0

  const visibleFrac = Math.min(1, vp / total)
  const boxHeight = Math.max(4, Math.min(cssH, visibleFrac * cssH))
  const boxTop = Math.max(0, Math.min(y - boxHeight / 2, cssH - boxHeight))
  const scrollFrac = boxTop / Math.max(1, cssH - boxHeight)
  return Math.round(scrollFrac * (total - vp))
}

function jumpToClientY(clientY: number): void {
  const el = props.scrollContainer
  if (!el) return
  el.scrollTop = yToScrollTop(clientY)
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

// 主题变化时重绘，确保缩略图颜色跟随主题
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
function redraw(): void {
  scheduleDraw()
}

function scheduleDraw(): void {
  if (!props.visible) return
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(draw)
}

defineExpose({ redraw })
</script>

<template>
  <Transition name="arc-minimap-fade">
    <div
      v-if="visible"
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
