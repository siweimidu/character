<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Minimize } from 'lucide-vue-next'
import { NButton, NModal, useMessage } from 'naive-ui'
import ChapterTreeSidebar from './ChapterTreeSidebar.vue'
import ChapterEditorPane from './ChapterEditorPane.vue'
import ChapterAiPanelV2 from './ChapterAiPanelV2.vue'
import ChapterFirstDraftConfigDialog from './ChapterFirstDraftConfigDialog.vue'
import type { FirstDraftConfig } from './useChapterFirstDraft'
import type { SurfaceDefinition } from '@shared/assistant-runtime'
import { useAssistant } from '@/composables/useAssistant'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const { selectedProjectId, selectedChapter } = storeToRefs(appStore)
const message = useMessage()

// 章节 AI 助手实例：上移到此处，不依赖 ChapterAiPanelV2 是否挂载
const CHAPTER_SURFACE: SurfaceDefinition = {
  id: 'chapter-panel',
  scope: 'chapter',
  autoCommit: false,
  maxSteps: 6
}

const assistant = useAssistant({
  projectId: () => selectedProjectId.value,
  surface: CHAPTER_SURFACE,
  scopeRef: () => selectedChapter.value ? `chapter:${selectedChapter.value.id}` : undefined
})

const COMPACT_BREAKPOINT = 1180
const COMPACT_BREAKPOINT_AI_OPEN = 1440
const DEFAULT_AI_WIDTH = 380
const MIN_AI_WIDTH = 280
const MAX_AI_WIDTH = 600

const aiOpen = ref(true)
const focusMode = ref(false)
const sidebarDrawerVisible = ref(false)
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const aiPanelWidth = ref(DEFAULT_AI_WIDTH)
const isDraggingPanel = ref(false)
const draftConfigVisible = ref(false)

const isCompact = computed(() => {
  const threshold = aiOpen.value ? COMPACT_BREAKPOINT_AI_OPEN : COMPACT_BREAKPOINT
  return viewportWidth.value <= threshold
})

const effectiveAiWidth = computed(() => {
  if (isCompact.value) return Math.min(aiPanelWidth.value, 320)
  return aiPanelWidth.value
})

const gridStyle = computed(() => {
  if (focusMode.value) {
    return { gridTemplateColumns: aiOpen.value ? `1fr 4px ${effectiveAiWidth.value}px` : '1fr' }
  }
  if (isCompact.value) {
    return { gridTemplateColumns: aiOpen.value ? `1fr 4px ${effectiveAiWidth.value}px` : '1fr' }
  }
  return { gridTemplateColumns: aiOpen.value ? `280px 1fr 4px ${effectiveAiWidth.value}px` : '280px 1fr' }
})

const aiPanelRef = ref<InstanceType<typeof ChapterAiPanelV2> | null>(null)

function toggleAi(): void {
  aiOpen.value = !aiOpen.value
}

function toggleFocus(): void {
  focusMode.value = !focusMode.value
}

function toggleSidebar(): void {
  sidebarDrawerVisible.value = !sidebarDrawerVisible.value
}

function handleSelectionAction(action: string, text: string): void {
  aiOpen.value = true
  // 先把选区文本同步到 store，让 AI 面板的 hasSelection 能感知到
  const chapterId = appStore.selectedChapter?.id
  if (chapterId && text) {
    appStore.updateChapterSelection({ chapterId, text })
  }
  // 把完整文本传给 AI 面板（不截断），面板的 sendPromptWithAction 会利用 store 选区拼接上下文
  nextTick(() => {
    aiPanelRef.value?.sendPromptWithAction(action, text)
  })
}

function handleGenerateDraft(): void {
  if (appStore.outlineVolumes.length === 0) {
    message.warning('当前没有分卷，无法生成初稿。请先新建分卷。')
    return
  }
  if (appStore.chapters.length === 0) {
    message.warning('当前没有章节，无法生成初稿。请先新建章节。')
    return
  }
  draftConfigVisible.value = true
}

function handleDraftConfigConfirm(config: FirstDraftConfig): void {
  draftConfigVisible.value = false
  aiOpen.value = true
  nextTick(() => {
    aiPanelRef.value?.triggerDraft(config)
  })
}

/** 按目标字数控制当前章节正文：超出则精简、不足则扩充 */
function handleApplyTargetWords(targetWordCount: number): void {
  draftConfigVisible.value = false
  aiOpen.value = true
  nextTick(() => {
    aiPanelRef.value?.applyTargetWords(targetWordCount)
  })
}

function startPanelDrag(e: MouseEvent): void {
  e.preventDefault()
  isDraggingPanel.value = true
  const startX = e.clientX
  const startWidth = aiPanelWidth.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  function onMove(ev: MouseEvent): void {
    const delta = startX - ev.clientX
    const newWidth = Math.max(MIN_AI_WIDTH, Math.min(MAX_AI_WIDTH, startWidth + delta))
    aiPanelWidth.value = newWidth
  }

  function onEnd(): void {
    isDraggingPanel.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem('arc-ai-panel-width', String(aiPanelWidth.value))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
}

function handlePanelDblClick(): void {
  aiPanelWidth.value = DEFAULT_AI_WIDTH
  localStorage.setItem('arc-ai-panel-width', String(DEFAULT_AI_WIDTH))
}

function syncViewport(): void {
  viewportWidth.value = window.innerWidth
}

// ── 本章待回收伏笔提醒 ──
const reminderVisible = ref(false)
const reminderThreads = ref<Array<{ id: string; title: string }>>([])
const remindedChapterIds = ref<Set<string>>(new Set())

// 当前章节的计划回收伏笔
const chapterPendingThreads = computed(() => {
  const chapter = appStore.selectedChapter
  if (!chapter) return []
  return appStore.plotThreads.filter(
    (t) => t.status === 'pending' && t.plannedCloseChapterId === chapter.id
  )
})

// 监听章节切换，弹出待回收伏笔提醒
watch(
  () => appStore.selectedChapterId,
  (chapterId) => {
    if (!chapterId || remindedChapterIds.value.has(chapterId)) return
    const pending = appStore.plotThreads.filter(
      (t) => t.status === 'pending' && t.plannedCloseChapterId === chapterId
    )
    if (pending.length > 0) {
      reminderThreads.value = pending.map((t) => ({ id: t.id, title: t.title }))
      reminderVisible.value = true
      remindedChapterIds.value.add(chapterId)
    }
  }
)

function closeReminder(): void {
  reminderVisible.value = false
}

function jumpToThread(threadId: string): void {
  appStore.setPanel('threads')
  reminderVisible.value = false
}

function handleKeydown(event: KeyboardEvent): void {
  // 组合输入（IME）期间不触发 F11/Escape 等全局快捷键，避免打断中文输入
  if (event.isComposing) return
  if (event.key === 'F11') {
    event.preventDefault()
    toggleFocus()
    return
  }
  if (event.key === 'Escape' && focusMode.value) {
    toggleFocus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', syncViewport)
  const saved = localStorage.getItem('arc-ai-panel-width')
  if (saved) {
    const val = Number(saved)
    if (val >= MIN_AI_WIDTH && val <= MAX_AI_WIDTH) {
      aiPanelWidth.value = val
    }
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <section
    class="chapter-workspace"
    :class="{ 'ai-open': aiOpen, focus: focusMode, compact: isCompact }"
    :style="gridStyle"
  >
    <ChapterTreeSidebar v-if="!focusMode && !isCompact" class="ws-sidebar" />
    <ChapterEditorPane
      class="ws-editor"
      :ai-open="aiOpen"
      :focus-mode="focusMode"
      :show-sidebar-toggle="!focusMode && isCompact"
      @toggle-ai="toggleAi"
      @toggle-focus="toggleFocus"
      @toggle-sidebar="toggleSidebar"
      @selection-action="handleSelectionAction"
      @generate-draft="handleGenerateDraft"
    />
    <!-- Panel resize handle -->
    <div
      v-if="aiOpen"
      class="panel-resize-handle"
      :class="{ dragging: isDraggingPanel }"
      @mousedown="startPanelDrag"
      @dblclick="handlePanelDblClick"
    />
    <ChapterAiPanelV2 v-if="aiOpen" ref="aiPanelRef" :assistant="assistant" class="ws-ai" @close="aiOpen = false" @generate-draft="handleGenerateDraft" />
    <button v-if="focusMode" class="focus-exit" @click="toggleFocus">
      <Minimize :size="13" />
      <span>退出专注 (Esc)</span>
    </button>

    <Transition name="sidebar-slide">
      <div v-if="isCompact && sidebarDrawerVisible && !focusMode" class="sidebar-overlay">
        <div class="sidebar-backdrop" @click="sidebarDrawerVisible = false" />
        <div class="sidebar-panel">
          <ChapterTreeSidebar @navigate="sidebarDrawerVisible = false" />
        </div>
      </div>
    </Transition>

    <ChapterFirstDraftConfigDialog
      :show="draftConfigVisible"
      @confirm="handleDraftConfigConfirm"
      @cancel="draftConfigVisible = false"
      @apply-target-words="handleApplyTargetWords"
    />

    <!-- 本章待回收伏笔提醒 -->
    <n-modal
      v-model:show="reminderVisible"
      preset="card"
      title="📌 本章有待回收伏笔"
      style="width: 420px"
      :mask-closable="false"
    >
      <p class="reminder-hint">当前章节计划回收以下 {{ reminderThreads.length }} 条伏笔：</p>
      <div class="reminder-list">
        <div v-for="thread in reminderThreads" :key="thread.id" class="reminder-item">
          <span class="reminder-dot" />
          <span class="reminder-title">{{ thread.title }}</span>
        </div>
      </div>
      <template #footer>
        <div class="reminder-actions">
          <n-button @click="closeReminder">知道了</n-button>
          <n-button type="primary" @click="jumpToThread(reminderThreads[0]?.id)">查看伏笔</n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.chapter-workspace {
  position: relative;
  display: grid;
  height: 100%;
  width: 100%;
  background: var(--arc-bg-body);
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

.ws-sidebar,
.ws-editor,
.ws-ai {
  min-width: 0;
  min-height: 0;
}

/* ── Panel Resize Handle ── */
.panel-resize-handle {
  width: 4px;
  cursor: col-resize;
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.panel-resize-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 0;
  border-radius: 1px;
  background: var(--arc-border-strong);
  transform: translate(-50%, -50%);
  transition: all 0.2s ease;
  opacity: 0;
}

.panel-resize-handle:hover::after {
  height: 32px;
  opacity: 0.6;
}

.panel-resize-handle.dragging::after {
  height: 100%;
  opacity: 1;
  background: var(--arc-primary);
  width: 2px;
}

/* ── Focus Exit ── */
/* 应用顶部有一条 40px 的系统标题栏（含窗口最小化/关闭按钮），
   按钮若 fixed 在 top:16px 会被原生窗口按钮遮挡，因此下移避开标题栏区域 */
.focus-exit {
  position: fixed;
  top: 56px;
  right: 16px;
  z-index: 100;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  box-shadow: var(--arc-shadow-sm);
}

.focus-exit:hover {
  color: var(--arc-text-primary);
}

/* ── Sidebar Overlay ── */
.sidebar-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
}

.sidebar-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
}

.sidebar-panel {
  position: relative;
  width: 300px;
  height: 100%;
  box-shadow: var(--arc-shadow-lg);
  z-index: 1;
}

.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: opacity 0.2s ease;
}

.sidebar-slide-enter-active .sidebar-panel,
.sidebar-slide-leave-active .sidebar-panel {
  transition: transform 0.2s ease;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  opacity: 0;
}

.sidebar-slide-enter-from .sidebar-panel,
.sidebar-slide-leave-to .sidebar-panel {
  transform: translateX(-100%);
}

/* ── Reminder ── */
.reminder-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--arc-text-secondary);
  line-height: 1.6;
}

.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reminder-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
}

.reminder-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #eab308;
  flex-shrink: 0;
}

.reminder-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--arc-text-primary);
}

.reminder-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
