<script setup lang="ts">
/**
 * 全局 AI 任务进度面板。
 *
 * 挂载在 App 根布局右下角，订阅 `useAppStore().runningAiTasks / recentAiTasks`。
 * 一旦有 AI 任务在跑，面板自动浮出；用户切换任何页面都能继续看到正在跑什么、跑了多久。
 *
 * 设计要点：
 *   - 跑完会短暂保留 "成功 ✓" 或 "失败 ×"，帮助在后台跑的任务收尾被用户感知到。
 *   - 面板本身可折叠，避免在章节写作等长时间场景里遮挡正文。
 *   - 运行中 tick 每秒刷新一次耗时；空闲时 interval 会被清掉，不白跑。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Bot, BookOpen, Brush, ChevronDown, Feather, FileText, Image as ImageIcon, Library, Minus, Sparkles, X } from 'lucide-vue-next'
import { NButton, NProgress } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { AiTaskKind, AiTaskRun } from '@/features/ai/taskRegistry'

const appStore = useAppStore()

/** 折叠状态——有任务时默认展开，手动折叠后保持用户选择 */
const collapsed = ref(false)
const userCollapsed = ref(false)

/**
 * 整个面板缩成右下角一个闪烁的小点时的开关。
 * 点击 dock-header 左边的紫色圆点触发，让出更多写作空间但任务仍继续。
 */
const dotMode = ref(false)

/** 每秒 tick 一次，用来驱动耗时文本刷新 */
const nowTick = ref(Date.now())
let tickTimer: number | null = null

/** 面板是否可见：有运行中任务或有正在淡出的已完成任务时显示。
 *  chapter-assistant 类型任务已在 AI 对话面板中有 typing 指示，不重复展示。 */
const visibleRuns = computed<AiTaskRun[]>(() => {
  return [...appStore.runningAiTasks, ...appStore.recentAiTasks]
    .filter((run) => run.kind !== 'chapter-assistant' && run.kind !== 'chapter-draft' && !run.minimized)
})

/** 被最小化到后台、仍在运行的任务（不占窗口，可从小点卡片里恢复）。 */
const minimizedRuns = computed<AiTaskRun[]>(() =>
  appStore.runningAiTasks.filter((run) => run.kind !== 'chapter-assistant' && run.kind !== 'chapter-draft' && run.minimized)
)

const hasVisibleRuns = computed(() => visibleRuns.value.length > 0 || minimizedRuns.value.length > 0 || appStore.runningAiTasks.length > 0)

function startTicker(): void {
  if (tickTimer !== null) return
  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
}

function stopTicker(): void {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
}

watch(
  () => appStore.runningAiTasks.length,
  (count) => {
    if (count > 0) {
      startTicker()
      // 新任务启动时，若用户没手动折叠则自动展开
      if (!userCollapsed.value) {
        collapsed.value = false
      }
    } else {
      stopTicker()
    }
  },
  { immediate: true }
)

onBeforeUnmount(stopTicker)

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
  userCollapsed.value = collapsed.value
}

/** 切换整个面板缩成右下角闪烁小点 / 恢复完整面板。 */
function toggleDotMode(): void {
  dotMode.value = !dotMode.value
}

/** 从闪烁小点展开回完整面板（点击小点本身时调用）。 */
function expandFromDot(): void {
  dotMode.value = false
}

function handleMinimize(run: AiTaskRun): void {
  appStore.minimizeAiTask(run.key)
}

function handleUnminimize(run: AiTaskRun): void {
  appStore.unminimizeAiTask(run.key)
}

function formatElapsed(run: AiTaskRun): string {
  const endTs = run.stage === 'running' ? nowTick.value : run.finishedAt ?? nowTick.value
  const elapsedMs = Math.max(0, endTs - run.startedAt)
  if (elapsedMs < 1000) return '刚刚启动'
  const seconds = Math.round(elapsedMs / 1000)
  if (seconds < 60) return `已用时 ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds ? `已用时 ${minutes}m${remainingSeconds}s` : `已用时 ${minutes}m`
}

/** 按 kind 映射图标，用户扫一眼就能知道是哪个模块在跑 */
function iconForKind(kind: AiTaskKind) {
  switch (kind) {
    case 'worldview':
      return BookOpen
    case 'character':
      return Bot
    case 'outline':
      return Library
    case 'workflow':
      return FileText
    case 'inspiration':
      return Sparkles
    case 'chapter-draft':
    case 'chapter-summary':
    case 'chapter-assistant':
    case 'chapter-post-process':
      return Feather
    case 'plot-thread':
      return Library
    case 'cover':
      return ImageIcon
    case 'reference':
      return BookOpen
    default:
      return Brush
  }
}

function handleCancel(run: AiTaskRun): void {
  appStore.cancelAiTask(run.key)
}

function handleDismiss(run: AiTaskRun): void {
  appStore.dismissAiTask(run.key)
}

const runningCount = computed(() => appStore.runningAiTasks.length)
</script>

<template>
  <!-- 缩成右下角闪烁小点：点击小点展开回完整面板 -->
  <Transition name="dock-fade">
    <button
      v-if="hasVisibleRuns && dotMode"
      class="ai-task-dot"
      type="button"
      :title="`${runningCount} 项 AI 任务后台运行中，点击展开`"
      aria-label="展开 AI 任务面板"
      @click="expandFromDot"
    >
      <span class="dot-core" :class="{ active: runningCount > 0 }" aria-hidden="true"></span>
    </button>
  </Transition>

  <Transition name="dock-fade">
    <aside v-if="hasVisibleRuns && !dotMode" class="ai-task-dock" :class="{ collapsed }">
      <header class="dock-header">
        <div class="dock-title" @click="toggleDotMode" title="缩成小点（任务仍后台运行）">
          <span
            class="dock-pulse"
            :class="{ active: runningCount > 0 }"
            aria-hidden="true"
          ></span>
          <span class="dock-title-text">
            <template v-if="runningCount > 0">{{ runningCount }} 项 AI 任务进行中</template>
            <template v-else>AI 任务已完成</template>
          </span>
        </div>
        <button class="dock-toggle" type="button" :aria-expanded="!collapsed" :aria-label="collapsed ? '展开 AI 任务列表' : '折叠 AI 任务列表'" @click.stop="toggleCollapsed">
          <ChevronDown :size="14" :class="{ 'rotate-icon': collapsed }" />
        </button>
      </header>

      <div v-show="!collapsed" class="dock-body">
        <div v-if="minimizedRuns.length > 0" class="minimized-bar">
          <span class="minimized-bar-label">后台运行中</span>
          <div class="minimized-list">
            <button
              v-for="run in minimizedRuns"
              :key="'min-' + run.key + '-' + run.startedAt"
              type="button"
              class="minimized-chip"
              :title="`展开「${run.label}」`"
              @click="handleUnminimize(run)"
            >
              <span class="minimized-chip-dot" aria-hidden="true"></span>
              {{ run.label }}
            </button>
          </div>
        </div>

        <article
          v-for="run in visibleRuns"
          :key="run.key + '-' + run.startedAt"
          class="task-row"
          :class="{
            'stage-running': run.stage === 'running',
            'stage-done': run.stage === 'done',
            'stage-error': run.stage === 'error',
            'stage-canceled': run.stage === 'canceled'
          }"
        >
          <span class="task-icon" :aria-hidden="true">
            <component :is="iconForKind(run.kind)" :size="16" />
          </span>
          <div class="task-main">
            <div class="task-head">
              <span class="task-label">{{ run.label }}</span>
              <span class="task-meta">
                <template v-if="run.stage === 'running'">{{ formatElapsed(run) }}</template>
                <template v-else-if="run.stage === 'done'">已完成 · {{ formatElapsed(run) }}</template>
                <template v-else-if="run.stage === 'canceled'">已替换 · {{ formatElapsed(run) }}</template>
                <template v-else>失败 · {{ formatElapsed(run) }}</template>
              </span>
            </div>
            <p v-if="run.description || run.error" class="task-desc" :class="{ error: run.stage === 'error' }">
              {{ run.stage === 'error' ? run.error || run.description : run.description }}
            </p>
            <n-progress
              v-if="run.stage === 'running'"
              class="task-progress"
              type="line"
              status="info"
              :processing="run.progress == null"
              :percentage="run.progress ?? 100"
              :show-indicator="false"
              :height="3"
            />
          </div>
          <div class="task-actions">
            <!-- 运行中：减号（后台执行/收起）+ 停止 -->
            <template v-if="run.stage === 'running'">
              <button
                class="task-icon-btn"
                type="button"
                title="收起此任务到后台继续执行"
                aria-label="收起任务到后台"
                @click="handleMinimize(run)"
              >
                <Minus :size="14" />
              </button>
              <n-button
                v-if="run.onCancel"
                size="tiny"
                secondary
                round
                @click="handleCancel(run)"
              >
                停止
              </n-button>
            </template>
            <button
              v-else
              type="button"
              class="task-dismiss"
              aria-label="关闭提示"
              @click="handleDismiss(run)"
            >
              <X :size="14" />
            </button>
          </div>
        </article>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.ai-task-dock {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2800;
  display: flex;
  max-width: calc(100vw - 48px);
  width: 360px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(12px);
}

.dock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(180deg, var(--arc-bg-surface) 0%, var(--arc-bg-surface-hover) 100%);
  border-bottom: 1px solid var(--arc-border);
}

.ai-task-dock.collapsed .dock-header {
  border-bottom: none;
}

.dock-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.dock-pulse {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 28%, transparent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--arc-primary) 24%, transparent);
}

.dock-pulse.active {
  background: var(--arc-primary);
  animation: pulse-ring 1.6s cubic-bezier(0.66, 0, 0, 1) infinite;
}

.dock-toggle {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: background 0.18s ease;
}

.dock-toggle:hover {
  background: var(--arc-glass-06);
  color: var(--arc-text-primary);
}

.rotate-icon {
  transform: rotate(-90deg);
  transition: transform 0.24s ease;
}

.dock-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 0;
}

.task-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--arc-border) 40%, transparent);
}

.task-row:last-child {
  border-bottom: none;
}

.task-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
  flex-shrink: 0;
}

.stage-done .task-icon {
  color: var(--arc-success);
  background: color-mix(in srgb, var(--arc-success) 12%, transparent);
}

.stage-error .task-icon {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.12);
}

.stage-canceled .task-icon {
  color: var(--arc-text-secondary);
  background: var(--arc-glass-06);
}

.task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.task-label {
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.task-desc {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-desc.error {
  color: #dc2626;
}

.task-progress {
  margin-top: 2px;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.task-dismiss {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.task-dismiss:hover {
  background: var(--arc-glass-06);
  color: var(--arc-text-secondary);
}

.task-icon-btn {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.task-icon-btn:hover {
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
  color: var(--arc-primary);
  border-color: color-mix(in srgb, var(--arc-primary) 30%, transparent);
}

/* ── 缩成右下角闪烁小点 ── */
.ai-task-dot {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.dot-core {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--arc-primary);
  box-shadow: 0 2px 10px color-mix(in srgb, var(--arc-primary) 45%, transparent);
  animation: pulse-ring 1.6s cubic-bezier(0.66, 0, 0, 1) infinite;
}

.dot-core.active {
  background: var(--arc-primary);
}

/* ── 后台运行中（被最小化的任务）── */
.minimized-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px 4px;
}

.minimized-bar-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
}

.minimized-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.minimized-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}

.minimized-chip:hover {
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  border-color: color-mix(in srgb, var(--arc-primary) 30%, transparent);
}

.minimized-chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--arc-primary);
  flex-shrink: 0;
}

.dock-fade-enter-active,
.dock-fade-leave-active {
  transition: transform 0.26s ease, opacity 0.26s ease;
}

.dock-fade-enter-from,
.dock-fade-leave-to {
  opacity: 0;
  transform: translateY(18px);
}

@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--arc-primary) 36%, transparent);
  }
  70% {
    box-shadow: 0 0 0 8px color-mix(in srgb, var(--arc-primary) 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--arc-primary) 0%, transparent);
  }
}

@media (max-width: 640px) {
  .ai-task-dock {
    right: 12px;
    bottom: 12px;
    width: calc(100vw - 24px);
  }
}
</style>
