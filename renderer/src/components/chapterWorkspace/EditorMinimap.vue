<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 编辑器右侧纵向预览缩略条（VSCode 风格 Minimap）。
 *
 * 实现严格对照 VSCode 源码：
 *   - src/vs/editor/browser/viewParts/minimap/minimap.ts
 *   - src/vs/editor/browser/viewParts/minimap/minimapCharRenderer.ts
 *   - src/vs/editor/browser/viewParts/minimap/minimapCharRendererFactory.ts
 *   - src/vs/editor/browser/viewParts/minimap/minimapCharSheet.ts
 *   - src/vs/base/common/strings.ts（isFullWidthCharacter）
 *
 * 为什么之前的版本「正文文字不显示」？
 *   旧实现把全部内容行等比压缩进缩略图一屏：
 *     scale = cssH / (行数 × 行高)
 *   当正文行数很多时，行间纵向间距被压到远小于字符单元高度（5px），
 *   所有行互相覆盖、糊成一团，最终整片文字不可辨认（表现为「一片空白/不显示文字」）。
 *
 * VSCode 的解决思路（本实现照此重构）：
 *   1. 每行使用「固定行高」MINIMAP_LINE_HEIGHT，绝不随内容总行数缩放，
 *      字符单元（2×5）恰好落在行高内，行与行互不重叠，文字始终清晰可读；
 *   2. 缩略图高度 = 编辑区可视高度，行数超出时可容纳行数时，采用 VSCode 的
 *      「行采样」：按比例挑选具有代表性的行（_downsample 思路），每行仍占
 *      固定行高，从而既覆盖整章概览、又不会挤压重叠；
 *   3. 视口框 / 选区高亮按「采样后行空间」换算，滚动联动、点击拖动跳转保留。
 *
 * 字符位图渲染仍沿用 VSCode 思路：
 *   - 不使用极小字号 fillText 直接绘制，而是把字符先以可读分辨率采样，
 *     再用 VSCode 的加权平均 + 亮度增强降采样成 2×5 字符单元，逐像素写入
 *     ImageData 后一次性 putImageData；
 *   - 全角字符（中文等）占 2 个字符单元宽度；
 *   - 颜色使用「直通 alpha」（RGB = 前景色，A = 字形强度），避免双重变暗。
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
/**
 * 缩略图中每行的固定高度（含字高 + 行间距）。
 * 与 VSCode `minimapLineHeight` 对应：行高固定、不随内容行数缩放，
 * 这是避免行重叠、保证文字可读的关键。
 */
const MINIMAP_LINE_HEIGHT = 6
/** 单个字符单元尺寸（CSS px）：2×5 */
const CHAR_W_CSS = 2
const CHAR_H_CSS = 5
/** 字符单元在行内的垂直留白（VSCode `innerLinePadding`） */
const INNER_LINE_PADDING = Math.floor((MINIMAP_LINE_HEIGHT - CHAR_H_CSS) / 2)
/** 非 ASCII 字符采样时的可读分辨率，随后降采样为字符单元 */
const CHAR_SAMPLE_SRC = 16
/** 每行之间的最小可见间距（CSS px），用于内容总高的兜底下限 */
const MIN_CONTENT_HEIGHT = MINIMAP_LINE_HEIGHT

let rafId = 0
let dragging = false

// ── 主题颜色缓存 ────────────────────────────────────────────────
let cachedColor = '#52525b'
let cachedViewportFill = 'rgba(128, 128, 128, 0.22)'
let cachedViewportStroke = 'rgba(128, 128, 128, 0.6)'
let cachedSelectionFill = 'rgba(59, 130, 246, 0.32)'
let cachedSelectionStroke = 'rgba(59, 130, 246, 0.7)'

// ── 字符位图缓存（key 为 `${charW}x${charH}:${ch}`）──────────────
const charBitmapCache = new Map<string, Uint8ClampedArray>()
let sampleCanvas: HTMLCanvasElement | null = null
let sampleCtx: CanvasRenderingContext2D | null = null

/**
 * 内置 ASCII 5×7 位图字体（0x20~0x7E，95 个字符，每个字符 5 列 × 7 行）。
 * 数据来源与 VSCode minimapPreBaked 同源的经典 5×7 等宽位图字体，
 * 每字节代表一列，bit0 为顶部行。
 */
const ASCII_FONT_HEX =
  '000000000000005f00000007000700147f147f14242a7f2a12231308646236495620500008070300001c2241000041221c002a1c7f1c2a08083e080800807030000808080800006060002020100804023e5149453e00427f400072494949462141494d331814127f1027454545393c4a49493141211109073649494936464949291e0000140000004034000000081422411414141414004122140802015909063e415d594e7c1211127c7f494949363e414141227f4141413e7f494949417f090909013e414151737f0808087f00417f41002040413f017f081422417f404040407f021c027f7f0408107f3e4141413e7f090909063e4151215e7f09192946264949493203017f01033f4040403f1f2040201f3f4038403f631408146303047804036159494d43007f4141410204081020004141417f04020102044040404040000307080020545478407f284444383844444428384444287f385454541800087e090218a4a49c787f0804047800447d40002040403d007f1028440000417f40007c047804787c080404783844444438fc1824241818242418fc7c08040408485454542404043f44243c4040207c1c2040201c3c4030403c44281028444c9090907c4464544c440008364100000077000000413608000201020402'

let asciiFontBytes: Uint8Array | null = null
function getAsciiFontBytes(): Uint8Array | null {
  if (asciiFontBytes === null) {
    asciiFontBytes = new Uint8Array(0)
    const hex = ASCII_FONT_HEX
    if (hex.length === 950) {
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      }
      asciiFontBytes = bytes
    }
  }
  return asciiFontBytes.length ? asciiFontBytes : null
}

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

/** 一个字符在缩略图中的显示宽度（字符单元数）。 */
function charCellCount(ch: string): number {
  if (ch === '\t') return 4
  return isFullWidthCharacter(ch.charCodeAt(0)) ? 2 : 1
}

/** 延迟创建离屏采样 canvas。 */
function ensureSampleCtx(): CanvasRenderingContext2D | null {
  if (!sampleCtx) {
    try {
      sampleCanvas = document.createElement('canvas')
      sampleCanvas.width = CHAR_SAMPLE_SRC
      sampleCanvas.height = CHAR_SAMPLE_SRC
      sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
    } catch {
      sampleCtx = null
    }
  }
  return sampleCtx
}

/**
 * VSCode `MinimapCharRendererFactory._downsampleChar` 的移植：
 * 把 srcW×srcH 的源灰度图，用「加权平均（近似双线性）」降采样到 charW×charH。
 * 最后执行亮度增强，保证极小字形依旧清晰（否则笔画平均后会糊成半透明残影）。
 */
function downsampleChar(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  charW: number,
  charH: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(charW * charH)
  let brightest = 0
  for (let y = 0; y < charH; y++) {
    const sy1 = (y / charH) * srcH
    const sy2 = ((y + 1) / charH) * srcH
    for (let x = 0; x < charW; x++) {
      const sx1 = (x / charW) * srcW
      const sx2 = ((x + 1) / charW) * srcW
      let value = 0
      let samples = 0
      for (let sy = sy1; sy < sy2; sy++) {
        const row = Math.floor(sy) * srcW
        const yBalance = 1 - (sy - Math.floor(sy))
        for (let sx = sx1; sx < sx2; sx++) {
          const xBalance = 1 - (sx - Math.floor(sx))
          const weight = xBalance * yBalance
          samples += weight
          value += src[row + Math.floor(sx)] * weight
        }
      }
      const final = samples > 0 ? value / samples : 0
      out[y * charW + x] = final
      if (final > brightest) brightest = final
    }
  }

  // VSCode `_downsample`：把最亮像素拉伸到 255，让字符在小尺寸下依然鲜明。
  if (brightest > 0) {
    const adjust = 255 / brightest
    for (let i = 0; i < out.length; i++) {
      out[i] = out[i] * adjust
    }
  }
  return out
}

/** 取出 ASCII 字符的 5×7 灰度源（1 bit → 0/255）。 */
function asciiGlyphSource(ch: string): Uint8ClampedArray | null {
  const font = getAsciiFontBytes()
  if (!font) return null
  const code = ch.charCodeAt(0)
  if (code < 0x20 || code > 0x7e) return null
  const base = (code - 0x20) * 5
  const src = new Uint8ClampedArray(5 * 7)
  for (let col = 0; col < 5; col++) {
    const bits = font[base + col]
    for (let row = 0; row < 7; row++) {
      src[row * 5 + col] = (bits >> row) & 1 ? 255 : 0
    }
  }
  return src
}

/** 采样非 ASCII 字符（中文等）的灰度源，返回 16×16 alpha 强度。 */
function sampleGlyphSource(ch: string): Uint8ClampedArray | null {
  const ctx = ensureSampleCtx()
  if (!ctx) return null
  ctx.clearRect(0, 0, CHAR_SAMPLE_SRC, CHAR_SAMPLE_SRC)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.font = `bold ${Math.round(CHAR_SAMPLE_SRC * 0.8)}px "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`
  ctx.fillText(ch, CHAR_SAMPLE_SRC / 2, CHAR_SAMPLE_SRC / 2 + 1)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, CHAR_SAMPLE_SRC, CHAR_SAMPLE_SRC).data
  } catch {
    return null
  }
  const alpha = new Uint8ClampedArray(CHAR_SAMPLE_SRC * CHAR_SAMPLE_SRC)
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = data[i * 4 + 3]
  }
  return alpha
}

/** 获取字符降采样后的位图（可能为 null，表示采样失败需用块状兜底）。 */
function getCharBitmap(ch: string, charW: number, charH: number): Uint8ClampedArray | null {
  const key = `${charW}x${charH}:${ch}`
  const hit = charBitmapCache.get(key)
  if (hit) return hit

  let out: Uint8ClampedArray | null = null
  const ascii = asciiGlyphSource(ch)
  if (ascii) {
    out = downsampleChar(ascii, 5, 7, charW, charH)
  } else {
    const sampled = sampleGlyphSource(ch)
    if (sampled) {
      out = downsampleChar(sampled, CHAR_SAMPLE_SRC, CHAR_SAMPLE_SRC, charW, charH)
    }
  }
  if (out) charBitmapCache.set(key, out)
  return out
}

/** 获取正文块数组：按换行拆分为「一行」。空内容给一个占位行。 */
function getContentBlocks(): string[] {
  const text = (props.getText() || '').replace(/\r\n/g, '\n')
  if (!text.trim()) return ['']
  return text.split('\n')
}

/**
 * 把「全部正文块」映射为「缩略图显示行」。
 * 采用 VSCode 的固定行高 + 行采样模型：
 *   - 每个显示行占据固定 MINIMAP_LINE_HEIGHT 高度，互不重叠；
 *   - 当正文块数不超过可容纳行数时，逐块映射（displayBlock[i] = i）；
 *   - 超过时按比例采样出 fittingLines 个代表性块，保证整章概览完整呈现。
 */
function computeSampledLayout(
  blocks: string[],
  fittingLines: number
): { displayBlocks: string[]; sourceToDisplay: Map<number, number> } {
  const totalBlocks = blocks.length
  const displayCount = Math.max(1, Math.min(totalBlocks, fittingLines))
  const displayBlocks: string[] = new Array(displayCount)
  const sourceToDisplay = new Map<number, number>()

  if (totalBlocks <= displayCount) {
    for (let i = 0; i < totalBlocks; i++) {
      displayBlocks[i] = blocks[i]
      sourceToDisplay.set(i, i)
    }
    for (let i = totalBlocks; i < displayCount; i++) {
      displayBlocks[i] = ''
    }
    return { displayBlocks, sourceToDisplay }
  }

  // 采样：把 totalBlocks 压缩到 displayCount 个代表性块（含首尾）。
  if (displayCount === 1) {
    displayBlocks[0] = blocks[0]
    sourceToDisplay.set(0, 0)
  } else {
    for (let d = 0; d < displayCount; d++) {
      const src = Math.round((d * (totalBlocks - 1)) / (displayCount - 1))
      displayBlocks[d] = blocks[src]
      sourceToDisplay.set(src, d)
    }
  }
  return { displayBlocks, sourceToDisplay }
}

/** 计算编辑器滚动到缩略图显示行的换算。 */
function computeViewport(
  el: HTMLDivElement,
  contentHeight: number
): { boxTop: number; boxHeight: number; scrollable: boolean } {
  const vp = el.clientHeight
  const total = el.scrollHeight
  if (total <= 0) {
    return { boxTop: 0, boxHeight: Math.min(contentHeight, vp), scrollable: false }
  }
  const visibleFraction = Math.min(1, vp / total)
  const boxHeight = Math.max(MIN_CONTENT_HEIGHT, Math.min(contentHeight, visibleFraction * contentHeight))
  let boxTop = 0
  if (contentHeight > boxHeight) {
    const range = Math.max(1, total - vp)
    const frac = Math.min(1, Math.max(0, el.scrollTop / range))
    boxTop = frac * (contentHeight - boxHeight)
  }
  return { boxTop, boxHeight, scrollable: contentHeight > boxHeight }
}

/** 把某行内字符偏移换算成缩略图 x 坐标（考虑全角字符占 2 格）。 */
function charOffsetToX(line: string, charOffset: number): number {
  let cells = 0
  const n = Math.min(charOffset, line.length)
  for (let i = 0; i < n; i++) {
    cells += charCellCount(line[i])
  }
  return cells * CHAR_W_CSS
}

/** 把选区 [from, to)（全文本字符区间）映射到显示行坐标。 */
function computeSelectionRect(
  blocks: string[],
  sourceToDisplay: Map<number, number>,
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

  // 找出选区跨越的块范围
  let startSrc = blocks.length - 1
  let endSrc = 0
  for (let i = 0; i < blocks.length; i++) {
    const lineStart = offsets[i]
    const lineEnd = lineStart + blocks[i].length
    if (sel.from <= lineEnd && sel.to >= lineStart) {
      startSrc = Math.min(startSrc, i)
      endSrc = Math.max(endSrc, i)
    }
  }
  if (startSrc > endSrc) return null

  // 映射到显示行空间
  const displayStart = sourceToDisplay.get(startSrc)
  const displayEnd = sourceToDisplay.get(endSrc)
  if (displayStart === undefined || displayEnd === undefined) return null

  const y0 = displayStart * MINIMAP_LINE_HEIGHT
  const y1 = (displayEnd + 1) * MINIMAP_LINE_HEIGHT
  const y = Math.max(0, Math.min(y0, y1))
  const h = Math.max(3, Math.min(cssH - y, Math.abs(y1 - y0)))

  const x = Math.max(0, charOffsetToX(blocks[startSrc], sel.from - offsets[startSrc]))
  const endX = charOffsetToX(blocks[endSrc], sel.to - offsets[endSrc])
  const w = Math.min(cssW - x, Math.max(4, endX - x))

  return { x, y, w, h }
}

function draw(): void {
  const canvas = canvasRef.value
  const el = props.scrollContainer
  if (!canvas || !el) return

  refreshThemeColors()

  const blocks = getContentBlocks()

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

  // ── 固定行高 + 行采样：计算要在缩略图中显示的行（VSCode 模型）──
  const fittingLines = Math.max(1, Math.floor(cssH / MINIMAP_LINE_HEIGHT))
  const { displayBlocks, sourceToDisplay } = computeSampledLayout(blocks, fittingLines)
  // 显示内容总高 = 显示行数 × 固定行高，不会随总行数缩放
  const contentTotalH = displayBlocks.length * MINIMAP_LINE_HEIGHT

  // ── 逐行把字符位图写入 ImageData（VSCode 风格采样渲染）──
  const fg = parseHexColor(cachedColor) ?? { r: 82, g: 82, b: 91 }
  const charW = Math.max(1, Math.round(CHAR_W_CSS * dpr))
  const charH = Math.max(1, Math.round(CHAR_H_CSS * dpr))
  const imageData = ctx.createImageData(pxW, pxH)
  const fgAlpha = 0.9 // 直通 alpha，避免双重变暗

  // 每行固定位置 dy = displayIndex * 行高（设备像素），行与行绝不重叠
  for (let di = 0; di < displayBlocks.length; di++) {
    const line = displayBlocks[di]
    if (!line.trim()) continue
    const dy = Math.round(di * MINIMAP_LINE_HEIGHT * dpr) + Math.round(INNER_LINE_PADDING * dpr)
    if (dy >= pxH) break
    blitLine(imageData, line, fg, fgAlpha, dy, charW, charH)
  }

  // putImageData 会覆盖整块画布，因此先上屏文字，再在其上绘制选区与视口框
  ctx.putImageData(imageData, 0, 0)

  // ── 选区高亮（叠在文字上层）──
  const selRect = computeSelectionRect(blocks, sourceToDisplay, props.getSelection?.(), cssW, cssH)
  if (selRect) {
    ctx.fillStyle = cachedSelectionFill
    ctx.fillRect(selRect.x, selRect.y, selRect.w, selRect.h)
    ctx.strokeStyle = cachedSelectionStroke
    ctx.lineWidth = 1
    ctx.strokeRect(selRect.x + 0.5, selRect.y + 0.5, selRect.w - 1, selRect.h - 1)
  }

  drawViewport(ctx, cssW, cssH, contentTotalH)
}

/**
 * 把一行文本按字符位图逐像素写入 ImageData（VSCode `_renderLine` 思路）。
 * 目标 ImageData 为设备像素坐标，dy 为该行顶部在目标中的像素 y 坐标。
 */
function blitLine(
  target: ImageData,
  line: string,
  fg: { r: number; g: number; b: number },
  fgAlpha: number,
  dy: number,
  charW: number,
  charH: number
): void {
  const maxDx = target.width - charW
  let dx = 0
  for (let ci = 0; ci < line.length; ci++) {
    if (dx > maxDx) break
    const ch = line[ci]
    // Tab / 空格只推进，不绘制
    if (ch === ' ' || ch === '\t') {
      dx += charCellCount(ch) * charW
      continue
    }
    const bitmap = getCharBitmap(ch, charW, charH)
    // 全角字符（中文等）占 2 个字符单元，渲染两次填充宽度（VSCode 行为）
    const count = isFullWidthCharacter(ch.charCodeAt(0)) ? 2 : 1
    for (let k = 0; k < count; k++) {
      if (dx > maxDx) break
      if (bitmap) {
        blitCell(target, bitmap, fg, fgAlpha, dx, dy, charW, charH)
      } else {
        blitBlockCell(target, fg, fgAlpha, dx, dy, charW, charH)
      }
      dx += charW
    }
  }
}

/**
 * 把单个字符位图以「直通 alpha」写入目标（VSCode renderChar 思路）。
 * RGB = 前景色，A = 字形强度 × 前景透明度，避免 premultiply 造成的双重变暗。
 */
function blitCell(
  target: ImageData,
  bitmap: Uint8ClampedArray,
  fg: { r: number; g: number; b: number },
  fgAlpha: number,
  dx: number,
  dy: number,
  charW: number,
  charH: number
): void {
  const dest = target.data
  const destWidth = target.width
  const destHeight = target.height
  for (let py = 0; py < charH; py++) {
    const destY = dy + py
    if (destY < 0 || destY >= destHeight) continue
    const srcRow = py * charW
    const destRow = destY * destWidth
    for (let px = 0; px < charW; px++) {
      const a = bitmap[srcRow + px]
      if (a === 0) continue
      const idx = (destRow + dx + px) * 4
      dest[idx] = fg.r
      dest[idx + 1] = fg.g
      dest[idx + 2] = fg.b
      dest[idx + 3] = Math.max(dest[idx + 3], Math.round((a / 255) * fgAlpha * 255))
    }
  }
}

/** 采样失败时的块状兜底（VSCode blockRenderChar 思路）。 */
function blitBlockCell(
  target: ImageData,
  fg: { r: number; g: number; b: number },
  fgAlpha: number,
  dx: number,
  dy: number,
  charW: number,
  charH: number
): void {
  const dest = target.data
  const destWidth = target.width
  const destHeight = target.height
  const c = Math.round(0.5 * fgAlpha * 255)
  for (let py = 0; py < charH; py++) {
    const destY = dy + py
    if (destY < 0 || destY >= destHeight) continue
    const destRow = destY * destWidth
    for (let px = 0; px < charW; px++) {
      const idx = (destRow + dx + px) * 4
      dest[idx] = fg.r
      dest[idx + 1] = fg.g
      dest[idx + 2] = fg.b
      dest[idx + 3] = Math.max(dest[idx + 3], c)
    }
  }
}

function drawViewport(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  contentTotalH: number
): void {
  const el = props.scrollContainer
  if (!el) return
  const { boxTop, boxHeight } = computeViewport(el, contentTotalH)
  const y = Math.max(0, Math.min(boxTop, cssH - boxHeight))
  const h = Math.max(3, Math.min(boxHeight, cssH - y))
  ctx.fillStyle = cachedViewportFill
  ctx.fillRect(0, y, cssW, h)
  ctx.strokeStyle = cachedViewportStroke
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, y + 0.5, cssW - 1, h - 1)
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
