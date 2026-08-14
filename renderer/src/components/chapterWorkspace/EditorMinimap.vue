<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_THEME,
  computeSelectionRect,
  computeViewport,
  dispose as disposeEngine,
  paintBlockLayer,
  renderBlocks,
  yToScrollTop,
  type MinimapSelection,
  type MinimapThemeColors
} from './minimapEngine'

/**
 * 编辑器右侧纵向预览缩略小地图（VSCode 风格 Minimap）。
 *
 * 本组件只负责三件事：
 *   1. 渲染层 —— 把正文按行采样渲染色块（见 minimapEngine.ts），并在其上
 *      叠加「视口框」与「选区高亮」。
 *   2. 交互事件 —— 点击跳转、拖拽视口框、滚轮同步、关闭按钮。
 *   3. 滚动同步 —— 监听主编辑器滚动 / 内容 / 主题 / 尺寸变化，节流刷新。
 *
 * 与旧版逐字渲染文字不同，新版严格遵循「色块化 + 超长文档采样降级 + 节流」
 * 三项性能约束，彻底避免逐字 fillText 造成的卡顿与文字重叠。
 *
 * 性能要点：
 *   - 色块层离屏缓存：只有内容 / 主题 / 尺寸变化时才重建色块层，滚动时
 *     只叠加轻量视口框，不重建。
 *   - requestAnimationFrame 节流：高频滚动 / 输入被合并到同一帧绘制。
 *   - 超长文档自动合并采样，canvas 高度恒定，行数再多也不会撑爆或卡死。
 *   - 滚动同步本身通过监听 scroll 事件驱动，只在可视视口框位置变化时重绘。
 */

// ── Props / Emits ─────────────────────────────────────────────

const props = defineProps<{
  /** 当前可见状态 */
  visible: boolean
  /** 获取正文纯文本（由父组件注入，随编辑器内容实时更新） */
  getText: () => string
  /** 获取当前选区在纯文本中的字符区间；无选区返回 null */
  getSelection?: () => MinimapSelection | null
  /** 正文滚动容器 */
  scrollContainer: HTMLDivElement | null
}>()

const emit = defineEmits<{
  close: []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

// ── 尺寸常量 ──────────────────────────────────────────────────

/** 缩略图整体宽度（含留白） */
const MINIMAP_WIDTH = 120
/** 内容区左右留白 */
const MINIMAP_PADDING = 8

// ── 内部状态 ──────────────────────────────────────────────────

let rafId = 0
let dragging = false

// 主题颜色缓存（跟随编辑器主题自动切换）
let theme: MinimapThemeColors = { ...DEFAULT_THEME }

// 尺寸（CSS px）
let contentCssW = 0
let contentCssH = 0
let dpr = 1

// ── 主题适配 ──────────────────────────────────────────────────

/** 解析 hex/rgba 颜色为 {r,g,b}，用于生成带透明度的变体。 */
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

function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color)
  if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
  if (/^rgba?\(/i.test(color)) return color
  return `rgba(128, 128, 128, ${alpha})`
}

/**
 * 从 CSS 变量读取主题颜色，跟随编辑器主题自动切换（支持暗色 / 纸质暖色等）。
 * 在暗色主题下自动选择较亮的色块前景色，暖色 / 浅色主题下选择较深色，确保对比度。
 */
function refreshTheme(): void {
  const root = getComputedStyle(document.documentElement)
  const isDark = document.documentElement.classList.contains('dark-mode')

  // 正文前景色：深色模式取浅灰，浅色模式取深灰。
  const textVar = root.getPropertyValue('--arc-text-secondary').trim()
    || root.getPropertyValue('--arc-text-primary').trim()
  const bgVar = root.getPropertyValue('--arc-bg-body').trim()
  const primaryVar = root.getPropertyValue('--arc-primary').trim()

  // 依据背景亮度决定前景色明暗，保证色块在不同主题下都可见。
  const bgRgb = parseColor(bgVar || (isDark ? '#1e1e1e' : '#ffffff'))
  let foreground = textVar
  if (!foreground && bgRgb) {
    const luminance = (bgRgb.r * 0.299 + bgRgb.g * 0.587 + bgRgb.b * 0.114) / 255
    foreground = luminance > 0.5 ? '#52525b' : '#b4b4bc'
  }
  if (!foreground) foreground = isDark ? '#b4b4bc' : '#52525b'

  const base = primaryVar || '#3b82f6'

  theme = {
    foreground,
    viewportFill: 'rgba(128, 128, 128, 0.20)',
    viewportStroke: withAlpha(foreground, 0.6),
    selectionFill: withAlpha(base, 0.30),
    selectionStroke: withAlpha(base, 0.75),
    faint: withAlpha(foreground, 0.35)
  }
}

// ── 绘制调度（节流核心）───────────────────────────────────────

/**
 * 把一次完整绘制调度到下一帧执行，并合并同帧内的多次请求
 * （滚动 / 输入等高频事件不会造成每事件一次全量绘制）。
 */
function scheduleDraw(): void {
  if (!props.visible) return
  if (rafId) return // 已有待执行帧，直接合并，避免堆积
  rafId = requestAnimationFrame(() => {
    rafId = 0
    draw()
  })
}

// ── 主绘制入口 ────────────────────────────────────────────────

function draw(): void {
  const canvas = canvasRef.value
  const el = props.scrollContainer
  if (!canvas || !el || !props.visible) return

  refreshTheme()

  // 尺寸（含窗口 / 布局变化自动自适应重绘）
  dpr = window.devicePixelRatio || 1
  contentCssW = MINIMAP_WIDTH - MINIMAP_PADDING * 2
  contentCssH = Math.max(40, el.clientHeight)

  const pxW = Math.max(1, Math.round(contentCssW * dpr))
  const pxH = Math.max(1, Math.round(contentCssH * dpr))
  if (canvas.width !== pxW) canvas.width = pxW
  if (canvas.height !== pxH) canvas.height = pxH
  canvas.style.width = contentCssW + 'px'
  canvas.style.height = contentCssH + 'px'

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const text = props.getText() || ''

  // 1. 色块层：仅在内容 / 主题 / 尺寸变化时重建，其余情况直接复用缓存。
  renderBlocks(text, contentCssW, contentCssH, dpr, theme)

  // 2. 上屏色块层。
  paintBlockLayer(ctx, contentCssW, contentCssH)

  // 3. 选区高亮（可选）。
  if (props.getSelection) {
    const selRect = computeSelectionRect(
      text,
      props.getSelection(),
      contentCssW,
      contentCssH
    )
    if (selRect) {
      const sx = selRect.x * dpr
      const sy = selRect.y * dpr
      const sw = selRect.w * dpr
      const sh = selRect.h * dpr
      ctx.fillStyle = theme.selectionFill
      ctx.fillRect(sx, sy, sw, sh)
      ctx.strokeStyle = theme.selectionStroke
      ctx.lineWidth = Math.max(1, dpr)
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1)
    }
  }

  // 4. 视口框（始终实时绘制，开销极小）。
  drawViewport(ctx, pxW, pxH)
}

/** 绘制当前视口框（半透明矩形标记可视范围）。 */
function drawViewport(ctx: CanvasRenderingContext2D, pxW: number, pxH: number): void {
  const el = props.scrollContainer
  if (!el) return
  const { top, height } = computeViewport(
    el.scrollTop,
    el.clientHeight,
    el.scrollHeight,
    contentCssH
  )
  const scale = pxH / contentCssH
  const y = Math.max(0, Math.min(top * scale, pxH - 3))
  const h = Math.max(3, Math.min(height * scale, pxH - y))
  ctx.fillStyle = theme.viewportFill
  ctx.fillRect(0, y, pxW, h)
  ctx.strokeStyle = theme.viewportStroke
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, y + 0.5, pxW - 1, h - 1)
}

// ── 交互事件（点击跳转 / 拖拽同步 / 滚轮同步）─────────────────

/** 把事件 clientY 换算为正文 scrollTop 并滚动。 */
function jumpToClientY(clientY: number): void {
  const el = props.scrollContainer
  const canvas = canvasRef.value
  if (!el || !canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.height <= 0) return
  const localY = clientY - rect.top
  el.scrollTop = yToScrollTop(
    localY,
    rect.height,
    el.clientHeight,
    el.scrollHeight
  )
}

/** ① 点击缩略图任意位置 → 代码编辑器直接滚动跳转至对应行。 */
function onPointerDown(e: PointerEvent): void {
  dragging = true
  jumpToClientY(e.clientY)
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

/** ② 鼠标拖动视口框 → 实时同步滚动主编辑器。 */
function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  jumpToClientY(e.clientY)
}

function onPointerUp(): void {
  dragging = false
}

/** 滚轮在缩略图上滑动 → 同步主编辑器滚动。 */
function onWheel(e: WheelEvent): void {
  const el = props.scrollContainer
  if (!el) return
  el.scrollTop += e.deltaY
  e.preventDefault()
}

// ── 主题 / 窗口自适应 ─────────────────────────────────────────

// 主题变量或 dark-mode class 变化时重绘，确保色块颜色跟随主题。
const themeObserver = typeof MutationObserver !== 'undefined'
  ? new MutationObserver(() => scheduleDraw())
  : null

// 窗口缩放 / 设备像素比变化时自动自适应重绘。
function handleResize(): void {
  scheduleDraw()
}

// ── 生命周期 ──────────────────────────────────────────────────

onMounted(() => {
  window.addEventListener('resize', handleResize)
  themeObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  })
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  window.removeEventListener('resize', handleResize)
  themeObserver?.disconnect()
  disposeEngine()
})

// 可见性变化时重绘（多等一帧确保容器尺寸稳定）。
watch(
  () => props.visible,
  (v) => {
    if (v) nextTick(() => requestAnimationFrame(() => scheduleDraw()))
  },
  { immediate: true }
)

// 滚动容器就绪时重绘。
watch(
  () => props.scrollContainer,
  () => nextTick(() => requestAnimationFrame(() => scheduleDraw()))
)

// 由父组件通过 expose 触发重绘（编辑器内容 / 滚动 / 光标变化时调用）。
// 内部经过 rAF 节流，高频调用也不会造成卡顿。
function redraw(): void {
  scheduleDraw()
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
