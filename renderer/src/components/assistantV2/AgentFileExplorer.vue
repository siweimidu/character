<script setup lang="ts">
/**
 * AgentFileExplorer · 全局智能体系统文件浏览器
 *
 * 让用户（和智能体）访问软件之外的任意目录：浏览、读取、写入、删除、创建文件。
 * 对应「系统全目录访问」模块。删除等危险操作需二次确认。
 */
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { ArrowLeft, FileText, Folder, FolderOpen, RefreshCw, Trash2 } from 'lucide-vue-next'
import type { AgentFsEntry } from '@shared/agent-modules'

const message = useMessage()

const currentPath = ref('')
const entries = ref<AgentFsEntry[]>([])
const loading = ref(false)
const breadcrumbs = ref<string[]>([])

const isEnabled = ref(true)

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function navigate(path: string): Promise<void> {
  loading.value = true
  try {
    const result = await window.characterArc.agentModules.fsList({ path })
    currentPath.value = result.path
    entries.value = result.entries
    breadcrumbs.value = path.split(/[\\/]/).filter(Boolean)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '无法访问目录')
  } finally {
    loading.value = false
  }
}

function goUp(): void {
  const idx = currentPath.value.lastIndexOf('/')
  const idxWin = currentPath.value.lastIndexOf('\\')
  const i = Math.max(idx, idxWin)
  if (i <= 0) return
  const parent = currentPath.value.slice(0, i)
  void navigate(parent || '/')
}

function openEntry(entry: AgentFsEntry): void {
  if (entry.isDirectory) {
    void navigate(entry.path)
  } else {
    void readFile(entry.path)
  }
}

const fileContent = ref('')
const filePreviewVisible = ref(false)
const filePreviewName = ref('')

async function readFile(path: string): Promise<void> {
  try {
    const result = await window.characterArc.agentModules.fsRead({ path })
    fileContent.value = result.content
    filePreviewName.value = path
    filePreviewVisible.value = true
  } catch (e) {
    message.error(e instanceof Error ? e.message : '读取文件失败')
  }
}

async function deleteEntry(entry: AgentFsEntry): Promise<void> {
  const confirmed = window.confirm(
    entry.isDirectory
      ? `确定删除目录「${entry.name}」及其全部内容吗？此操作不可恢复。`
      : `确定删除文件「${entry.name}」吗？此操作不可恢复。`
  )
  if (!confirmed) return
  try {
    await window.characterArc.agentModules.fsDelete({ path: entry.path, recursive: true })
    message.success(`已删除 ${entry.name}`)
    void navigate(currentPath.value)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}

function onBreadcrumbClick(index: number): void {
  const parts = currentPath.value.split(/[\\/]/).filter(Boolean)
  const target = parts.slice(0, index + 1).join('/')
  void navigate(target.startsWith('/') ? target : `/${target}`)
}

onMounted(() => {
  // 默认从常见用户目录开始
  void navigate('/')
})

defineExpose({ navigate, isEnabled })
</script>

<template>
  <div class="agent-fs">
    <div class="afs-header">
      <div class="afs-title">系统文件</div>
      <div class="afs-actions">
        <button type="button" class="afs-btn" title="刷新" @click="navigate(currentPath)">
          <RefreshCw :size="14" />
        </button>
        <button
          type="button"
          class="afs-btn"
          title="上一级"
          :disabled="currentPath === '/'"
          @click="goUp"
        >
          <ArrowLeft :size="14" />
        </button>
      </div>
    </div>

    <div class="afs-crumbs arc-scrollbar">
      <span class="afs-crumb" @click="navigate('/')">/</span>
      <template v-for="(crumb, i) in breadcrumbs" :key="i">
        <span class="afs-crumb-sep">/</span>
        <span class="afs-crumb" @click="onBreadcrumbClick(i)">{{ crumb }}</span>
      </template>
    </div>

    <div class="afs-path">{{ currentPath || '/' }}</div>

    <div v-if="loading" class="afs-empty">加载中…</div>
    <div v-else-if="entries.length === 0" class="afs-empty">空目录</div>

    <div v-else class="afs-list arc-scrollbar">
      <button
        v-for="entry in entries"
        :key="entry.path"
        type="button"
        class="afs-item"
        @click="openEntry(entry)"
      >
        <span class="afs-icon">
          <FolderOpen v-if="entry.isDirectory" :size="15" class="icon-dir" />
          <FileText v-else :size="15" class="icon-file" />
        </span>
        <span class="afs-name">{{ entry.name }}</span>
        <span class="afs-size">{{ entry.isDirectory ? '目录' : formatSize(entry.size) }}</span>
        <span
          class="afs-del"
          title="删除"
          @click.stop="deleteEntry(entry)"
        >
          <Trash2 :size="13" />
        </span>
      </button>
    </div>

    <!-- 文件预览弹层 -->
    <div v-if="filePreviewVisible" class="afs-modal">
      <div class="afs-modal-card">
        <div class="afs-modal-head">
          <span class="afs-modal-title">{{ filePreviewName }}</span>
          <button type="button" class="afs-modal-close" @click="filePreviewVisible = false">×</button>
        </div>
        <pre class="afs-modal-content arc-scrollbar">{{ fileContent }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-fs {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.afs-header {
  padding: 12px 14px 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.afs-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
}
.afs-actions {
  display: flex;
  gap: 4px;
}
.afs-btn {
  border: 1px solid var(--arc-border);
  background: transparent;
  color: var(--arc-text-secondary);
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.afs-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
}
.afs-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.afs-crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 14px 2px;
  overflow-x: auto;
  font-size: 11.5px;
  white-space: nowrap;
}
.afs-crumb {
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.afs-crumb:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-primary);
}
.afs-crumb-sep {
  color: var(--arc-text-hint);
}
.afs-path {
  padding: 2px 14px 8px;
  font-size: 10.5px;
  color: var(--arc-text-hint);
  font-family: var(--ga-mono, ui-monospace, monospace);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.afs-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--arc-text-hint);
  font-size: 12.5px;
}
.afs-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.afs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--arc-text-primary);
  cursor: pointer;
  text-align: left;
}
.afs-item:hover {
  background: var(--arc-bg-weak);
}
.afs-icon {
  display: inline-flex;
  flex-shrink: 0;
}
.icon-dir { color: var(--arc-primary); }
.icon-file { color: var(--arc-text-secondary); }
.afs-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.afs-size {
  font-size: 10.5px;
  color: var(--arc-text-hint);
  flex-shrink: 0;
}
.afs-del {
  display: inline-flex;
  color: var(--arc-text-hint);
  opacity: 0;
  flex-shrink: 0;
}
.afs-item:hover .afs-del {
  opacity: 1;
}
.afs-del:hover {
  color: #b91c1c;
}
.afs-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.afs-modal-card {
  width: min(720px, 90vw);
  height: 70vh;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.afs-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--arc-border);
}
.afs-modal-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.afs-modal-close {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}
.afs-modal-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  font-size: 12px;
  font-family: var(--ga-mono, ui-monospace, monospace);
  color: var(--arc-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
