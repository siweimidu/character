<script setup lang="ts">
/**
 * FlowNodeView · 智能体对话流节点（自动折叠）
 *
 * 把智能体的一次轮次（turn）渲染成可折叠的节点树：
 * 用户指令 → 智能体推理/工具调用/暂存变更/回复。长节点自动折叠，点击展开。
 */
import { computed, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  GitFork,
  Loader2,
  Pencil,
  SquareTerminal,
  Undo2,
  UserRound,
  FileDiff,
  Sparkles
} from 'lucide-vue-next'
import type { AssistantMessageView, AssistantToolCallView } from '@/composables/useAssistant'

const MD_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'a', 'span', 'del', 'hr', 'input'
]
const MD_ALLOWED_ATTR = ['class', 'href', 'target', 'rel', 'type', 'checked', 'disabled']

marked.setOptions({
  breaks: true,
  gfm: true
})

const markdownCache = new Map<string, { content: string; html: string }>()

function normalizeMarkdownTables(content: string): string {
  const lines = content.split('\n')
  let inFence = false
  return lines.map((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence || index === 0) return line
    const trimmed = line.trim()
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return line
    const headerCells = (lines[index - 1].trim().slice(1, -1)).split('|').map((c) => c.trim())
    const sepCells = trimmed.slice(1, -1).split('|').map((c) => c.trim())
    if (headerCells.length <= sepCells.length || !sepCells.every((c) => /^:?-{3,}:?$/.test(c))) return line
    const fill = sepCells.length < headerCells.length ? Array(headerCells.length - sepCells.length).fill('---') : []
    return `| ${[...sepCells, ...fill].join(' | ')} |`
  }).join('\n')
}

function renderMarkdown(content: string, cacheKey: string): string {
  const cached = markdownCache.get(cacheKey)
  if (cached?.content === content) return cached.html
  const html = marked.parse(normalizeMarkdownTables(content || ''), { async: false }) as string
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: MD_ALLOWED_ATTR
  })
  markdownCache.set(cacheKey, { content, html: sanitized })
  return sanitized
}

const props = defineProps<{
  message: AssistantMessageView
  /** 是否默认折叠工具/推理细节。 */
  autoCollapse?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit-start'): void
  (e: 'undo'): void
  (e: 'resend'): void
  (e: 'copy'): void
}>()

function copyMessage(): void {
  emit('copy')
}

/** 节点是否折叠。推理与工具节点默认折叠。 */
const collapsed = ref<Record<string, boolean>>({})

watch(
  () => props.message,
  () => {
    if (props.autoCollapse) {
      collapsed.value = {
        reasoning: true,
        tools: true
      }
    }
  },
  { immediate: true }
)

const isStreaming = computed(() => props.message.status === 'streaming')
const reasoningLines = computed(() => props.message.reasoning.split('\n').filter(Boolean))
const toolGroups = computed(() => {
  const groups: Array<{ title: string; calls: AssistantToolCallView[] }> = []
  for (const call of props.message.toolCalls) {
    let title = call.toolName
    const arg = call.args
    if (typeof arg === 'object' && arg) {
      const label = (arg as Record<string, unknown>).label
      const path = (arg as Record<string, unknown>).path
      const titleVal = (arg as Record<string, unknown>).title
      title = String(label ?? path ?? titleVal ?? call.toolName)
    }
    const existing = groups.find((g) => g.title === title)
    if (existing) existing.calls.push(call)
    else groups.push({ title, calls: [call] })
  }
  return groups
})

function toolLabel(call: AssistantToolCallView): string {
  return call.toolName.replace(/_/g, ' ')
}

function toggle(key: string): void {
  collapsed.value[key] = !collapsed.value[key]
}

function isCollapsed(key: string): boolean {
  return collapsed.value[key] ?? false
}
</script>

<template>
  <div class="flow-node">
    <!-- 用户消息 -->
    <div class="fn-user">
      <span class="fn-user-icon"><UserRound :size="14" /></span>
      <span class="fn-user-text">{{ message.userMessage }}</span>
    </div>

    <!-- 推理节点 -->
    <div
      v-if="message.reasoning"
      class="fn-block"
      :class="{ collapsed: isCollapsed('reasoning') }"
    >
      <button type="button" class="fn-head" @click="toggle('reasoning')">
        <Brain :size="13" class="fn-head-icon" />
        <span class="fn-head-label">思考过程</span>
        <ChevronRight v-if="isCollapsed('reasoning')" :size="14" />
        <ChevronDown v-else :size="14" />
      </button>
      <div v-if="!isCollapsed('reasoning')" class="fn-body fn-reasoning">
        <p v-for="(line, i) in reasoningLines" :key="i">{{ line }}</p>
      </div>
    </div>

    <!-- 工具调用节点 -->
    <div
      v-if="toolGroups.length > 0"
      class="fn-block"
      :class="{ collapsed: isCollapsed('tools') }"
    >
      <button type="button" class="fn-head" @click="toggle('tools')">
        <SquareTerminal :size="13" class="fn-head-icon" />
        <span class="fn-head-label">
          工具调用
          <em class="fn-count">{{ message.toolCalls.length }}</em>
        </span>
        <ChevronRight v-if="isCollapsed('tools')" :size="14" />
        <ChevronDown v-else :size="14" />
      </button>
      <div v-if="!isCollapsed('tools')" class="fn-body fn-tools">
        <div
          v-for="(group, gi) in toolGroups"
          :key="gi"
          class="fn-tool-group"
          :class="group.calls[0].status"
        >
          <div class="fn-tool-title">
            <Loader2 v-if="group.calls[0].status === 'running'" :size="12" class="spin" />
            <CheckCircle2 v-else-if="group.calls[0].status === 'ok'" :size="12" class="ok" />
            <CircleAlert v-else-if="group.calls[0].status === 'error'" :size="12" class="err" />
            <span>{{ toolLabel(group.calls[0]) }}</span>
            <em v-if="group.calls.length > 1">×{{ group.calls.length }}</em>
          </div>
          <div v-if="group.calls[0].resultPreview" class="fn-tool-preview">
            {{ group.calls[0].resultPreview.slice(0, 160) }}{{ group.calls[0].resultPreview.length > 160 ? '…' : '' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 暂存变更节点 -->
    <div
      v-if="message.stagedChangeIds.length > 0"
      class="fn-block"
      :class="{ collapsed: isCollapsed('staged') }"
    >
      <button type="button" class="fn-head" @click="toggle('staged')">
        <FileDiff :size="13" class="fn-head-icon" />
        <span class="fn-head-label">
          暂存变更
          <em class="fn-count">{{ message.stagedChangeIds.length }}</em>
        </span>
        <ChevronRight v-if="isCollapsed('staged')" :size="14" />
        <ChevronDown v-else :size="14" />
      </button>
      <div v-if="!isCollapsed('staged')" class="fn-body fn-staged">
        已产生 {{ message.stagedChangeIds.length }} 项待审阅变更
      </div>
    </div>

    <!-- 智能体回复 -->
    <div
      v-if="message.assistantMessage"
      class="fn-block fn-assistant"
    >
      <div class="fn-head-static">
        <Sparkles :size="13" class="fn-head-icon" />
        <span class="fn-head-label">智能体</span>
        <span class="fn-actions">
          <button v-if="!isStreaming" type="button" class="fn-action" title="复制" @click="copyMessage">
            <Copy :size="12" />
          </button>
          <button v-if="!isStreaming" type="button" class="fn-action" title="编辑" @click="emit('edit-start')">
            <Pencil :size="12" />
          </button>
          <button v-if="!isStreaming" type="button" class="fn-action" title="撤回" @click="emit('undo')">
            <Undo2 :size="12" />
          </button>
          <button v-if="!isStreaming" type="button" class="fn-action" title="重新分叉" @click="emit('resend')">
            <GitFork :size="12" />
          </button>
        </span>
      </div>
      <div class="fn-body fn-answer markdown-body" v-html="renderMarkdown(message.assistantMessage, `${message.turnId}:answer`)" />
    </div>

    <!-- 错误 -->
    <div v-if="message.error" class="fn-error">
      <CircleAlert :size="13" />
      {{ message.error }}
    </div>
  </div>
</template>

<style scoped>
.flow-node {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fn-user {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  border-radius: 10px;
  border-left: 3px solid var(--arc-primary);
}
.fn-user-icon {
  color: var(--arc-primary);
  flex-shrink: 0;
  margin-top: 1px;
}
.fn-user-text {
  font-size: 13px;
  color: var(--arc-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.fn-block {
  border: 1px solid var(--arc-border);
  border-radius: 9px;
  overflow: hidden;
  background: var(--arc-bg-surface);
}
.fn-block.collapsed {
  border-left: 3px solid var(--arc-border-strong);
}
.fn-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: none;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.fn-head:hover {
  color: var(--arc-text-primary);
}
.fn-head-icon {
  color: var(--arc-text-secondary);
  flex-shrink: 0;
}
.fn-head-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}
.fn-count {
  font-style: normal;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--arc-bg-body);
  color: var(--arc-text-hint);
}
.fn-head-static {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  background: var(--arc-bg-weak);
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}
.fn-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.fn-action {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  width: 24px;
  height: 24px;
  border-radius: 5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.fn-action:hover {
  background: var(--arc-bg-body);
  color: var(--arc-primary);
}
.fn-body {
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--arc-text-primary);
}
.fn-reasoning p {
  margin: 0 0 6px;
  color: var(--arc-text-secondary);
  line-height: 1.55;
}
.fn-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fn-tool-group {
  border: 1px solid var(--arc-border);
  border-radius: 7px;
  padding: 6px 9px;
}
.fn-tool-group.error { border-color: rgba(185,28,28,0.3); }
.fn-tool-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-primary);
  font-family: 'JetBrains Mono', monospace;
}
.fn-tool-title em {
  font-style: normal;
  font-size: 10px;
  color: var(--arc-text-hint);
}
.ok { color: #047857; }
.err { color: #b91c1c; }
.spin { color: var(--arc-primary); animation: fn-spin 1s linear infinite; }
@keyframes fn-spin { to { transform: rotate(360deg); } }
.fn-tool-preview {
  margin-top: 4px;
  font-size: 11px;
  color: var(--arc-text-secondary);
  background: var(--arc-bg-weak);
  border-radius: 5px;
  padding: 4px 7px;
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}
.fn-staged {
  color: var(--arc-text-secondary);
}
.fn-answer {
  line-height: 1.65;
  word-break: break-word;
}
.fn-answer :deep(.markdown-body p) { margin: 0 0 8px; }
.fn-answer :deep(.markdown-body ul), .fn-answer :deep(.markdown-body ol) { padding-left: 20px; margin: 4px 0; }
.fn-answer :deep(.markdown-body li) { margin: 2px 0; }
.fn-answer :deep(.markdown-body pre) {
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
}
.fn-answer :deep(.markdown-body code) {
  background: var(--arc-bg-weak);
  border-radius: 4px;
  padding: 1px 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}
.fn-answer :deep(.markdown-body pre code) { background: transparent; padding: 0; }
.fn-answer :deep(.markdown-body h1), .fn-answer :deep(.markdown-body h2), .fn-answer :deep(.markdown-body h3),
.fn-answer :deep(.markdown-body h4) { margin: 10px 0 6px; line-height: 1.3; }
.fn-answer :deep(.markdown-body table) { border-collapse: collapse; margin: 6px 0; width: 100%; }
.fn-answer :deep(.markdown-body th), .fn-answer :deep(.markdown-body td) {
  border: 1px solid var(--arc-border);
  padding: 5px 8px;
  font-size: 12px;
  text-align: left;
}
.fn-answer :deep(.markdown-body blockquote) {
  border-left: 3px solid var(--arc-primary);
  margin: 6px 0;
  padding: 2px 12px;
  color: var(--arc-text-secondary);
}
.fn-answer :deep(.markdown-body a) { color: var(--arc-primary); }
.fn-answer :deep(.markdown-body hr) { border: none; border-top: 1px solid var(--arc-border); margin: 10px 0; }
.fn-answer :deep(.markdown-body strong) { font-weight: 700; }
.fn-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(185,28,28,0.06);
  border: 1px solid rgba(185,28,28,0.2);
  border-radius: 8px;
  color: #b91c1c;
  font-size: 12px;
}
</style>
