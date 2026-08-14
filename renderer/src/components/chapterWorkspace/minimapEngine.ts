/**
 * 代码缩略小地图（VSCode 风格 Minimap）—— 纯渲染引擎模块。
 *
 * 设计目标（与组件 / 交互 / 滚动同步解耦）：
 *   - 本模块只负责「把正文内容渲染色块到 canvas」，不关心 DOM、滚动容器、
 *     Vue 生命周期等。一切输入都通过参数显式传入，方便单独测试与复用。
 *   - 性能约束（重点）：
 *       1. 禁止逐字渲染文字 —— 改为「按行批量采样渲染色块」：每一行正文只
 *          按内容密度画出若干小色块 / 细线，字形信息全部丢弃，从而在任意
 *          行数下都能稳定 <1ms 级完成绘制。
 *       2. 超长文档采样降级 —— 当总行数超过 canvas 可容纳的「像素行」数量时，
 *          不再逐行画，而是把多行合并为一个「像素行」（每像素行采样其代表
 *          密度）。canvas 高度恒定，因此行数再多也不会造成 canvas 过大或
 *          无限重绘。
 *       3. 节流刷新 —— 调用方（组件）负责通过 requestAnimationFrame 合并
 *          高频刷新；本模块提供「仅内容变化才重绘色块层」的缓存判断
 *          （isContentDirty），滚动时只叠加轻量视口框，避免频繁全量重绘。
 *
 * 渲染分层：
 *   - 色块层（block layer）：把整篇文档按行渲染色块，缓存在离屏 canvas。
 *     仅当内容 / 主题 / 尺寸变化时才重建，滚动时直接复用。
 *   - 视口框（viewport overlay）：每次滚动实时叠加的半透明矩形，开销极小。
 */

// ── 输入接口（与组件解耦，全部显式传参）─────────────────────────

/** 主题颜色快照，由组件从 CSS 变量解析后传入。 */
export interface MinimapThemeColors {
  /** 正文前景色（文字/色块基准色） */
  foreground: string
  /** 视口框半透明填充色 */
  viewportFill: string
  /** 视口框描边色 */
  viewportStroke: string
  /** 选区高亮填充色 */
  selectionFill: string
  /** 选区高亮描边色 */
  selectionStroke: string
  /** 空行 / 弱化内容使用的更淡颜色（可选） */
  faint: string
}

/** 选区在全文中的字符区间（含头不含尾）。 */
export interface MinimapSelection {
  from: number
  to: number
}

/** 引擎的绘制参数。 */
export interface MinimapRenderOptions {
  /** 渲染内容宽度（CSS px，不含留白） */
  cssWidth: number
  /** 渲染内容高度（CSS px） */
  cssHeight: number
  /** 设备像素比 */
  dpr: number
  /** 主题颜色 */
  theme: MinimapThemeColors
  /** 是否启用选区高亮绘制 */
  showSelection: boolean
}

// ── 布局采样参数（可配置，用于超长文档降级）────────────────────

/**
 * 每个「像素行」在 canvas 中占用的物理像素行数（CSS px 概念）。
 * 我们把整篇文档压缩到高度恒定的 canvas 里：若每行正文都能分到
 * 至少 BLOCK_LINE_MIN_PX 的像素高度，则逐行渲染；否则自动合并采样，
 * 保证 canvas 高度恒定、性能稳定。
 */
const BLOCK_LINE_MIN_PX = 1

/** 单行色块的最大宽度占比（避免满行色块糊成一片）。 */
const BLOCK_MAX_WIDTH_RATIO = 0.94

/** 色块在行内的最小高度（px），太小的行统一画成 1px 细线。 */
const BLOCK_MIN_HEIGHT_PX = 1

/** 把 hex/rgba 颜色解析为 {r,g,b}，用于生成带透明度的变体。 */
function parseColor(color: string): { r: number; g: number; b: number } | null {
  const trimmed = color.trim()
  const hex = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    }
  }
  const rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(trimmed)
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3] }
  }
  return null
}

/** 给颜色附加透明度的辅助函数（hex/rgba 均支持）。 */
function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color)
  if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
  if (/^rgba?\(/i.test(color)) return color
  return `rgba(128, 128, 128, ${alpha})`
}

// ── 内部状态 ──────────────────────────────────────────────────

interface BlockLayerState {
  canvas: HTMLCanvasElement
  /** 已渲染内容的指纹，用于判断内容是否变化（避免无谓重绘） */
  contentFingerprint: string
  cssWidth: number
  cssHeight: number
  dpr: number
}

let blockLayer: BlockLayerState | null = null

// ── 主题默认值（组件通常会传入真实值）──────────────────────────

export const DEFAULT_THEME: MinimapThemeColors = {
  foreground: '#8b8b93',
  viewportFill: 'rgba(128, 128, 128, 0.20)',
  viewportStroke: 'rgba(128, 128, 128, 0.55)',
  selectionFill: 'rgba(59, 130, 246, 0.30)',
  selectionStroke: 'rgba(59, 130, 246, 0.75)',
  faint: 'rgba(128, 128, 128, 0.30)'
}

// ── 行数据预处理 ──────────────────────────────────────────────

/** 把正文按换行拆成行数组。空内容给一个占位空行。 */
export function splitLines(text: string): string[] {
  const normalized = (text || '').replace(/\r\n/g, '\n')
  if (!normalized) return ['']
  return normalized.split('\n')
}

/**
 * 计算一行正文的「内容密度」 0~1：
 *   - 空行 / 空白行 → 0（不画色块）
 *   - 有文字 → 依据非空白字符占比估算该行占据的视觉宽度。
 * 用宽度占比表示，比简单「有无文字」更能还原正文的段落疏密结构。
 */
export function lineDensity(line: string): number {
  const trimmed = line.replace(/\s/g, '')
  if (!trimmed) return 0
  // 行越长密度越高（线性逼近），并做轻微下限，避免单字行过暗不可见。
  const lenRatio = Math.min(1, line.length / 72)
  return Math.max(0.12, lenRatio)
}

// ── 内容指纹（用于跳过未变化的重复渲染）────────────────────────

/**
 * 生成内容指纹。对大文档做「抽样哈希」而非完整哈希：
 * 只取开头、中间、结尾若干行 + 行数，既保证滚动/微小变化能被捕获，
 * 又避免对超大文档做全量字符串哈希造成卡顿。
 */
export function contentFingerprint(text: string, maxSampleLines = 200): string {
  const lines = splitLines(text)
  const total = lines.length
  if (total <= maxSampleLines) {
    // 短文档：完整指纹，保证精确。
    return `${total}:${lines.join('\n')}`
  }
  // 超长文档：抽取首、中、尾各若干行合成指纹。
  const quarter = Math.floor(total / 4)
  const sampled: string[] = []
  sampled.push(...lines.slice(0, 60))
  sampled.push(...lines.slice(quarter, quarter + 60))
  sampled.push(...lines.slice(2 * quarter, 2 * quarter + 60))
  sampled.push(...lines.slice(3 * quarter, 3 * quarter + 60))
  sampled.push(...lines.slice(total - 60))
  return `${total}:${sampled.join('\n')}`
}

// ── 布局计算 ──────────────────────────────────────────────────

export interface MinimapLayout {
  /** 每行正文在 canvas 中占用的像素高度（CSS px）。 */
  lineHeight: number
  /** 合并采样：每「像素行」代表的正文行数（>1 表示已降级采样）。 */
  linesPerPixelRow: number
  /** canvas 中实际绘制的像素行数。 */
  pixelRowCount: number
}

/**
 * 计算布局，核心是「超长文档采样降级」：
 *   目标是把全部行压缩到高度为 cssHeight 的 canvas 内。若每行能分到
 *   >= BLOCK_LINE_MIN_PX 的高度，则逐行渲染（linesPerPixelRow=1）；
 *   否则把多行合并为像素行（采样降级），保证内容高度恒等于 cssHeight。
 *
 * 注意：必须保证 `pixelRowCount * lineHeight` 严格等于 cssHeight，否则
 * 内容高度小于 canvas 高度会在底部留出大片空白（缩略图滑到底部却看不到
 * 末尾内容）。因此超长文档时直接令像素行数 = cssHeight / lineHeight，
 * 由每个像素行按比例代表若干正文行，从根上消除取整造成的空白。
 */
export function computeLayout(
  lineCount: number,
  cssHeight: number
): MinimapLayout {
  const total = Math.max(1, lineCount)
  const cssH = Math.max(1, cssHeight)
  // 若每行能分到至少 BLOCK_LINE_MIN_PX 的像素高度，则逐行渲染，
  // 内容高度 = total * (cssH / total) = cssH，天然铺满。
  if (cssH / total >= BLOCK_LINE_MIN_PX) {
    return {
      lineHeight: cssH / total,
      linesPerPixelRow: 1,
      pixelRowCount: total
    }
  }
  // 超长文档：像素行高固定为 BLOCK_LINE_MIN_PX，像素行数按比例铺满画布，
  // 每个像素行代表的小数行数在 renderBlockLayer 内用 floor/ceil 精确分配，
  // 保证内容高度恒等于 cssHeight、且所有正文行都被覆盖（无底部空白）。
  const lineHeight = BLOCK_LINE_MIN_PX
  const pixelRowCount = Math.max(1, Math.round(cssH / lineHeight))
  const linesPerPixelRow = total / pixelRowCount
  return { lineHeight, linesPerPixelRow, pixelRowCount }
}

// ── 视口框换算 ────────────────────────────────────────────────

export interface ViewportBox {
  top: number
  height: number
}

/**
 * 把正文滚动容器的滚动状态换算成缩略图视口框（CSS 坐标）。
 * 缩略图内容总高恒等于 cssHeight（scale-to-fit），因此视口框位置与
 * 正文可滚动范围严格 1:1，滚动严格同步。
 */
export function computeViewport(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  cssHeight: number
): ViewportBox {
  if (scrollHeight <= 0) {
    return { top: 0, height: cssHeight }
  }
  const visibleFrac = Math.min(1, clientHeight / scrollHeight)
  const boxHeight = Math.max(4, Math.min(cssHeight, visibleFrac * cssHeight))
  const scrollable = scrollHeight - clientHeight
  const scrollFrac = scrollable > 0
    ? Math.min(1, Math.max(0, scrollTop / scrollable))
    : 0
  const top = scrollFrac * Math.max(0, cssHeight - boxHeight)
  return { top, height: boxHeight }
}

// ── 色块层渲染（核心，按行采样渲染色块 + VSCode 式小字）───────

/**
 * 放大离屏渲染的可读字号（CSS px）。直接以 lineHeight（可能仅 1~2px）
 * 作为字号逐行 fillText 会把中文压成像素团而成乱码；改为先用这个较大的
 * 字号在高分辨率离屏 canvas 上绘制，再整体 drawImage 缩小，缩放抗锯齿
 * 会保留字形轮廓，呈现 VSCode 式可辨认的「小字」。
 */
const MIN_RENDER_FONT = 8
/** 放大系数上限，防止超长文档把离屏 canvas 撑得过大。 */
const MAX_ZOOM = 24

/** 计算放大系数：让放大 canvas 上的渲染字号达到可读大小。 */
function computeZoom(lineHeight: number): number {
  if (lineHeight >= MIN_RENDER_FONT) return 1
  return Math.min(MAX_ZOOM, Math.max(1, Math.ceil(MIN_RENDER_FONT / Math.max(0.5, lineHeight))))
}

/**
 * 在目标 canvas 上渲染整篇文档的可辨认小字。
 * 采用 VSCode 式「放大渲染后整体缩小」：先在放大分辨率的离屏 canvas 上
 * 逐行以可读字号绘制文字，再 drawImage 缩小到目标尺寸，从而在任意行高下
 * 都保留中文字形轮廓。
 */
function renderTextLayer(
  target: CanvasRenderingContext2D,
  lines: string[],
  layout: MinimapLayout,
  cssWidth: number,
  cssHeight: number,
  theme: MinimapThemeColors
): void {
  const { lineHeight } = layout
  const zoom = computeZoom(lineHeight)

  // 放大离屏 canvas：分辨率放大 zoom 倍，用可读字号绘制后整体缩小。
  const layer = document.createElement('canvas')
  layer.width = Math.max(1, Math.round(cssWidth * zoom))
  layer.height = Math.max(1, Math.round(cssHeight * zoom))
  const lctx = layer.getContext('2d')
  if (!lctx) return

  // 以 CSS 坐标绘制，字号 / 行距按 zoom 放大。
  lctx.setTransform(zoom, 0, 0, zoom, 0, 0)
  lctx.clearRect(0, 0, cssWidth, cssHeight)

  const fg = theme.foreground
  const renderFont = Math.max(1, lineHeight * zoom)
  lctx.font = `${renderFont}px "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`
  lctx.textBaseline = 'middle'
  lctx.textAlign = 'left'
  lctx.fillStyle = fg
  lctx.textRendering = 'optimizeLegibility'

  // 逐行绘制（逐行渲染模式）。裁剪过长的行避免横向溢出。
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const y = i * lineHeight + lineHeight / 2
    lctx.fillText(line, 0, y, cssWidth)
  }

  // 整体缩小到目标尺寸（VSCode 式小字）。
  target.imageSmoothingEnabled = true
  target.imageSmoothingQuality = 'high'
  target.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, cssWidth, cssHeight)
}

function renderBlockLayer(
  lines: string[],
  layout: MinimapLayout,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  theme: MinimapThemeColors
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const pxW = Math.max(1, Math.round(cssWidth * dpr))
  const pxH = Math.max(1, Math.round(cssHeight * dpr))
  canvas.width = pxW
  canvas.height = pxH

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const fg = theme.foreground
  const faint = theme.faint
  const { lineHeight, linesPerPixelRow, pixelRowCount } = layout

  // 逐行渲染模式：每行高度充足、逐行绘制文字。此时色块仅作极淡底衬；
  // 超长文档降级模式（linesPerPixelRow>1）无法逐字绘制，用清晰色块呈现密度。
  const textMode = linesPerPixelRow <= 1 && lines.length <= pixelRowCount
  // 文字底衬色：比纯 faint 更淡，避免喧宾夺主；降级模式用清晰的纯色。
  const blockDense = textMode ? withAlpha(theme.foreground, 0.14) : fg

  // 逐「像素行」采样：一个像素行可能代表 1 行或多行（降级）。
  // 降级时 linesPerPixelRow 可能是小数，用浮点边界 + 取整精确分配，
  // 确保所有正文行恰好被覆盖一遍、且内容高度铺满 canvas（无底部空白）。
  for (let r = 0; r < pixelRowCount; r++) {
    const startLine = Math.floor(r * linesPerPixelRow)
    const endLine = Math.min(lines.length, Math.floor((r + 1) * linesPerPixelRow))
    if (endLine <= startLine) continue

    // 汇总该像素行覆盖的所有正文行的平均密度。
    let sum = 0
    let nonEmpty = 0
    for (let i = startLine; i < endLine; i++) {
      const d = lineDensity(lines[i] ?? '')
      sum += d
      if (d > 0) nonEmpty++
    }
    const avg = nonEmpty > 0 ? sum / (endLine - startLine) : 0
    if (avg <= 0) continue // 该像素行无内容，跳过

    const y = r * lineHeight
    const h = Math.max(BLOCK_MIN_HEIGHT_PX, lineHeight - 0.15)
    const w = Math.max(1.5, Math.min(cssWidth * BLOCK_MAX_WIDTH_RATIO, cssWidth * avg))

    // 先铺一层半透明色块作为内容密度底衬（文字模式取淡色，文字仍清晰可见；
    // 降级模式取纯色以保证内容可见）。
    ctx.fillStyle = avg > 0.35 ? blockDense : faint
    ctx.fillRect(0, y, w, h)
  }

  // 逐行渲染模式下叠加可辨认小字，满足「缩略图能看到文字」的诉求；
  // 超长文档降级时保留纯色块渲染，避免逐字绘制造成的卡顿。
  if (textMode) {
    renderTextLayer(ctx, lines, layout, cssWidth, cssHeight, theme)
  }

  return canvas
}

/**
 * 更新并渲染色块层（离屏缓存）。
 * 若内容/尺寸/主题/设备比均未变化，则复用缓存，不做任何绘制（关键性能优化）。
 * 返回本次是否真的发生了重绘。
 */
export function renderBlocks(
  text: string,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  theme: MinimapThemeColors
): boolean {
  const fingerprint = contentFingerprint(text)

  // 尺寸/设备比/内容均未变化 → 复用缓存，避免无谓重绘。
  if (
    blockLayer &&
    blockLayer.contentFingerprint === fingerprint &&
    blockLayer.cssWidth === cssWidth &&
    blockLayer.cssHeight === cssHeight &&
    blockLayer.dpr === dpr
  ) {
    return false
  }

  const lines = splitLines(text)
  const layout = computeLayout(lines.length, cssHeight)
  const canvas = renderBlockLayer(lines, layout, cssWidth, cssHeight, dpr, theme)

  blockLayer = {
    canvas,
    contentFingerprint: fingerprint,
    cssWidth,
    cssHeight,
    dpr
  }
  return true
}

/**
 * 把缓存的色块层绘制到目标 canvas（上屏）。
 * 滚动 / 视口框变化时只需调用本方法叠加色块层 + 视口框，不做重渲染。
 */
export function paintBlockLayer(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number
): void {
  if (!blockLayer) return
  const { canvas } = blockLayer
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, cssWidth, cssHeight)
}

// ── 选区换算 ──────────────────────────────────────────────────

/**
 * 把选区 [from, to) 的字符区间映射为缩略图上的行区间，再按行换算成
 * 纵向矩形（CSS 坐标）。这里不再做字符级 x 定位（色块模式下无意义），
 * 直接高亮整段行区间，符合 VSCode 缩略图选区表现。
 */
export function computeSelectionRect(
  text: string,
  selection: MinimapSelection | null | undefined,
  cssWidth: number,
  cssHeight: number
): { x: number; y: number; w: number; h: number } | null {
  if (!selection || selection.to <= selection.from) return null
  const lines = splitLines(text)
  if (lines.length === 0) return null

  // 计算每个块的起始字符偏移（与正文以 \n 分隔一致）。
  const offsets: number[] = []
  let acc = 0
  for (let i = 0; i < lines.length; i++) {
    offsets.push(acc)
    acc += lines[i].length + 1
  }

  let startLine = -1
  let endLine = -1
  for (let i = 0; i < lines.length; i++) {
    const lineStart = offsets[i]
    const lineEnd = lineStart + lines[i].length
    if (selection.from <= lineEnd && selection.to >= lineStart) {
      if (startLine === -1) startLine = i
      endLine = i
    }
  }
  if (startLine === -1 || endLine === -1) return null

  const layout = computeLayout(lines.length, cssHeight)
  const y = Math.max(0, Math.min(startLine * layout.lineHeight, cssHeight - 3))
  const h = Math.max(
    3,
    Math.min(cssHeight - y, (endLine - startLine + 1) * layout.lineHeight)
  )
  return { x: 0, y, w: cssWidth, h }
}

// ── 坐标映射（点击 / 拖拽跳转）────────────────────────────────

/**
 * 把缩略图上的 y 坐标（CSS，相对 canvas 顶）映射为正文 scrollTop。
 * 与 computeViewport 严格互为逆运算，保证点击 / 拖拽时正文与缩略图严格同步。
 */
export function yToScrollTop(
  localY: number,
  cssHeight: number,
  clientHeight: number,
  scrollHeight: number
): number {
  if (cssHeight <= 0) return 0
  const y = Math.max(0, Math.min(localY, cssHeight))
  const scrollable = scrollHeight - clientHeight
  if (scrollable <= 0) return 0

  const visibleFrac = Math.min(1, clientHeight / scrollHeight)
  const boxHeight = Math.max(4, Math.min(cssHeight, visibleFrac * cssHeight))
  const boxTop = Math.max(0, Math.min(y - boxHeight / 2, cssHeight - boxHeight))
  const scrollFrac = boxTop / Math.max(1, cssHeight - boxHeight)
  return Math.round(scrollFrac * scrollable)
}

// ── 释放资源 ──────────────────────────────────────────────────

/** 组件卸载时调用，释放色块层缓存。 */
export function dispose(): void {
  blockLayer = null
}
