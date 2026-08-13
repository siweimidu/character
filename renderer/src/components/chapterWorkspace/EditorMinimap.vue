<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 编辑器右侧纵向预览缩略条（VSCode 风格 Minimap）。
 *
 * 实现参考 VSCode 源码：
 *   - src/vs/editor/browser/viewParts/minimap/minimap.ts
 *   - src/vs/editor/browser/viewParts/minimap/minimapCharRenderer.ts
 *   - src/vs/editor/browser/viewParts/minimap/minimapCharSheet.ts
 *
 * 核心思路（与 VSCode 一致）：
 *   1. 不依赖 Canvas 的 fillText 直接以小字号绘制（极小字号下中文字形容易糊成一片、甚至空白），
 *      而是像 VSCode 一样「预采样字符位图」：把每个字符先画到一张可读分辨率的离屏 canvas 上，
 *      取出 alpha 通道并降采样成极小的字符单元，再按前景色逐像素写入 ImageData，
 *      最后一次性 putImageData 上屏；
 *   2. 每行在缩略图中的高度固定（LINE_HEIGHT_PX），内容总高度 = 行数 × 行高，
 *      映射到 canvas 可视高度——保留文档空行结构，与正文段落一一对应；
 *   3. 视口框通过滚动容器 scrollTop/scrollHeight 映射，支持点击/拖动跳转、滚轮联动；
 *   4. 选区高亮映射到缩略图坐标系；
 *   5. Canvas + rAF 节流 + 字符位图缓存，超长小说也不卡顿。
 *
 * 能力：
 *   - 生成全文文本缩影（逐行绘制极小文字，压缩为编辑器右侧纵向长条）；
 *   - 双向联动：拖动/点击缩略图可跳转正文，滚动正文同步更新视口位置；
 *   - 选中文本高亮：把编辑器当前选区在缩略图中同步高亮出来；
 *   - 适配主题：文字、视口、选区颜色均跟随全局 CSS 变量，自动适配主题切换；
 *   - 独立组件：不依赖任何编辑器实现，通过 getText / getSelection 回调与父组件解耦。
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

/** 缩略条外层宽度（CSS px） */
const MINIMAP_WIDTH = 112
/** 缩略条左右内边距 */
const MINIMAP_PADDING = 8
/** 每行在缩略图中的固定高度（含字高 + 行间距），CSS px */
const LINE_HEIGHT_PX = 6
/** 单个字符单元尺寸（CSS px）：宽 2px × 高 5px，与 VSCode 的 1~2px 采样接近 */
const CHAR_W_CSS = 2
const CHAR_H_CSS = 5
/** 字符采样时的可读分辨率（像素），随后降采样为字符单元 */
const CHAR_SAMPLE_SRC = 16

let rafId = 0
let dragging = false

// ── 主题颜色缓存 ────────────────────────────────────────────────
let cachedColor = '#52525b'
let cachedViewportFill = 'rgba(128, 128, 128, 0.22)'
let cachedViewportStroke = 'rgba(128, 128, 128, 0.6)'
let cachedSelectionFill = 'rgba(59, 130, 246, 0.32)'
let cachedSelectionStroke = 'rgba(59, 130, 246, 0.7)'

// ── 字符位图缓存（VSCode minimapCharRenderer 思路）──────────────
// key 为 `${charW}x${charH}:${ch}`，value 为该字符降采样后的 alpha 值
// （Uint8ClampedArray，长度 = charW * charH，按行优先存储）。
const charBitmapCache = new Map<string, Uint8ClampedArray>()
let sampleCanvas: HTMLCanvasElement | null = null
let sampleCtx: CanvasRenderingContext2D | null = null

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

  // 视口使用低对比度中性色，避免刺眼
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
  if (rgb) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
  }
  if (/^rgba?\(/.test(hex)) return hex
  return `rgba(59, 130, 246, ${alpha})`
}

/**
 * 采样单个字符的灰度位图（VSCode minimapCharRenderer 思路）。
 * 先在可读分辨率（CHAR_SAMPLE_SRC × CHAR_SAMPLE_SRC）下绘制字符，
 * 再对 alpha 通道做盒式降采样到 charW × charH 的字符单元，避免极小字号下字形丢失。
 */
function getCharBitmap(ch: string, charW: number, charH: number): Uint8ClampedArray {
  const key = `${charW}x${charH}:${ch}`
  const hit = charBitmapCache.get(key)
  if (hit) return hit

  if (!sampleCanvas) {
    sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = CHAR_SAMPLE_SRC
    sampleCanvas.height = CHAR_SAMPLE_SRC
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
  }
  const ctx = sampleCtx
  const out = new Uint8ClampedArray(charW * charH)
  if (!ctx) return out

  ctx.clearRect(0, 0, CHAR_SAMPLE_SRC, CHAR_SAMPLE_SRC)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.font = `bold ${Math.round(CHAR_SAMPLE_SRC * 0.72)}px "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`
  ctx.fillText(ch, CHAR_SAMPLE_SRC / 2, CHAR_SAMPLE_SRC / 2 + 1)

  let src: Uint8ClampedArray
  try {
    src = ctx.getImageData(0, 0, CHAR_SAMPLE_SRC, CHAR_SAMPLE_SRC).data
  } catch {
    charBitmapCache.set(key, out)
    return out
  }

  // 盒式降采样：把 CHAR_SAMPLE_SRC×CHAR_SAMPLE_SRC 的 alpha 平均到 charW×charH
  for (let ty = 0; ty < charH; ty++) {
    const sy0 = Math.floor((ty * CHAR_SAMPLE_SRC) / charH)
    const sy1 = Math.max(sy0 + 1, Math.ceil(((ty + 1) * CHAR_SAMPLE_SRC) / charH))
    for (let tx = 0; tx < charW; tx++) {
      const sx0 = Math.floor((tx * CHAR_SAMPLE_SRC) / charW)
      const sx1 = Math.max(sx0 + 1, Math.ceil(((tx + 1) * CHAR_SAMPLE_SRC) / charW))
      let sum = 0
      let cnt = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          sum += src[(sy * CHAR_SAMPLE_SRC + sx) * 4 + 3]
          cnt++
        }
      }
      out[ty * charW + tx] = cnt > 0 ? Math.round(sum / cnt) : 0
    }
  }

  charBitmapCache.set(key, out)
  return out
}

function getContentLines(): string[] {
  const text = (props.getText() || '').replace(/\r\n/g, '\n')
  // 空内容时给一个占位行，避免 canvas 完全空白
  if (!text.trim()) return [' ']
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
  const startCol = Math.max(0, (sel.from - offsets[startLine]) / CHAR_W_CSS)
  const endCol = Math.max(startCol, Math.min(lines[endLine].length, sel.to - offsets[endLine]) / CHAR_W_CSS)
  const x = Math.max(0, startCol * CHAR_W_CSS)
  const w = Math.min(cssW, Math.max(4, (endCol - (sel.from - offsets[startLine])) * CHAR_W_CSS))

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
  const pxW = Math.max(1, Math.round(cssW * dpr))
  const pxH = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== pxW) canvas.width = pxW
  if (canvas.height !== pxH) canvas.height = pxH
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

  // ── 逐行把字符位图写入 ImageData（VSCode 风格采样渲染）──
  const fg = parseHexColor(cachedColor) ?? { r: 82, g: 82, b: 91 }
  const charW = Math.max(1, Math.round(CHAR_W_CSS * dpr))
  const charH = Math.max(1, Math.round(CHAR_H_CSS * dpr))
  const imageData = ctx.createImageData(pxW, pxH)
  const topPad = 2
  const lineAlpha = 217 // ≈ 0.85，保证缩略文字清晰可见

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    // 行中心点在缩略图中的 y（CSS px），映射到设备像素坐标
    const yCss = topPad + (i * LINE_HEIGHT_PX + LINE_HEIGHT_PX / 2) * scale
    if (yCss > cssH) break
    const dy = Math.max(0, Math.round((yCss - CHAR_H_CSS / 2) * dpr))
    if (dy >= pxH) break
    blitLine(imageData, line, fg, lineAlpha, dy, charW, charH)
  }

  // putImageData 会覆盖整块画布，因此先上屏文字，再在其上绘制选区与视口框
  ctx.putImageData(imageData, 0, 0)

  // ── 选区高亮（叠在文字上层）──
  const selRect = computeSelectionRect(lines, props.getSelection?.(), cssW, cssH)
  if (selRect) {
    ctx.fillStyle = cachedSelectionFill
    ctx.fillRect(selRect.x, selRect.y, selRect.w, selRect.h)
    ctx.strokeStyle = cachedSelectionStroke
    ctx.lineWidth = 1
    ctx.strokeRect(selRect.x + 0.5, selRect.y + 0.5, selRect.w - 1, selRect.h - 1)
  }

  drawViewport(ctx, cssW, cssH)
}

/**
 * 把一行文本按字符位图逐像素写入 ImageData（VSCode minimapCharRenderer.renderChar 思路）。
 * 目标 ImageData 为设备像素坐标，dy 为该行顶部在目标中的像素 y 坐标。
 */
function blitLine(
  target: ImageData,
  line: string,
  fg: { r: number; g: number; b: number },
  alpha: number,
  dy: number,
  charW: number,
  charH: number
): void {
  const dest = target.data
  const destWidth = target.width
  const destHeight = target.height
  const maxChars = Math.min(line.length, Math.floor(destWidth / charW))
  for (let ci = 0; ci < maxChars; ci++) {
    const ch = line[ci]
    // 空格无需绘制
    if (ch === ' ' || ch === '\t') continue
    const bitmap = getCharBitmap(ch, charW, charH)
    const dx = ci * charW
    for (let py = 0; py < charH; py++) {
      const destY = dy + py
      if (destY < 0 || destY >= destHeight) continue
      const srcRow = py * charW
      const destRow = destY * destWidth
      for (let px = 0; px < charW; px++) {
        const a = bitmap[srcRow + px]
        if (a === 0) continue
        const c = (a / 255) * (alpha / 255)
        const idx = (destRow + dx + px) * 4
        dest[idx] = Math.round(fg.r * c)
        dest[idx + 1] = Math.round(fg.g * c)
        dest[idx + 2] = Math.round(fg.b * c)
        dest[idx + 3] = Math.max(dest[idx + 3], Math.round(c * 255))
      }
    }
  }
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
defineExpose({ redraw: scheduleDraw })
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
