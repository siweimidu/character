<script setup lang="ts">
/**
 * ResourcePanel · 智能体资源区
 *
 * 类似 VS Code 资源管理器的文件树面板：
 *   - 以「工作区根目录」为根，展示目录下所有文件与隐藏文件。
 *   - 支持「打开工作区」（选择任意文件夹）作为新的根。
 *   - 支持展开/折叠目录、点击预览文件、删除文件/目录。
 *   - 智能体通过 file_* 工具在工作区根目录内生成的产物也会出现在这里。
 */
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Trash2
} from 'lucide-vue-next'
import type { AgentFsEntry } from '@shared/agent-modules'
import ResourceNode from './ResourceNode.vue'

export interface TreeNode {
  key: string
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedAt?: string
  expanded: boolean
  loading: boolean
  hidden: boolean
  children: TreeNode[]
}

const message = useMessage()

const root = ref<TreeNode | null>(null)
const rootName = ref('')
const loadingRoot = ref(false)

/** 文件预览 */
const previewVisible = ref(false)
const previewName = ref('')
const previewContent = ref('')
const previewLoading = ref(false)

function isHidden(name: string): boolean {
  return name.startsWith('.')
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 把 AgentFsEntry 列表转为 TreeNode 列表（目录在前、字母序）。 */
function toNodes(entries: AgentFsEntry[]): TreeNode[] {
  return entries
    .map((e) => ({
      key: e.path,
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      size: e.size,
      modifiedAt: e.modifiedAt,
      expanded: false,
      loading: false,
      hidden: isHidden(e.name),
      children: [] as TreeNode[]
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/** 切换目录展开/折叠，展开时懒加载子项。 */
async function toggleNode(node: TreeNode): Promise<void> {
  if (!node.isDirectory) return
  node.expanded = !node.expanded
  if (node.expanded && node.children.length === 0) {
    await loadChildren(node)
  }
}

async function loadChildren(node: TreeNode): Promise<void> {
  if (node.loading) return
  node.loading = true
  try {
    const result = await window.characterArc.agentModules.fsList({ path: node.path })
    node.children = toNodes(result.entries)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '无法读取目录')
    node.expanded = false
  } finally {
    node.loading = false
  }
}

/** 打开工作区：选择任意文件夹作为资源区根。 */
async function pickWorkspace(): Promise<void> {
  const res = await window.characterArc.agentModules.workspacePickDirectory()
  if (res.canceled || !res.path) return
  await loadRoot(res.path)
}

/** 加载指定路径作为资源区根目录。 */
async function loadRoot(path: string): Promise<void> {
  loadingRoot.value = true
  try {
    const result = await window.characterArc.agentModules.fsList({ path })
    const name = result.path.split(/[\\/]/).filter(Boolean).pop() || result.path
    rootName.value = name
    root.value = {
      key: result.path,
      name,
      path: result.path,
      isDirectory: true,
      size: 0,
      expanded: true,
      loading: false,
      hidden: false,
      children: toNodes(result.entries)
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '无法打开工作区')
    root.value = null
    rootName.value = ''
  } finally {
    loadingRoot.value = false
  }
}

/** 刷新当前根目录。 */
async function refresh(): Promise<void> {
  if (!root.value?.path) return
  await loadRoot(root.value.path)
}

/** 读取并预览文件内容。 */
async function previewFile(node: TreeNode): Promise<void> {
  previewVisible.value = true
  previewName.value = node.path
  previewContent.value = ''
  previewLoading.value = true
  try {
    const result = await window.characterArc.agentModules.fsRead({ path: node.path })
    previewContent.value = result.content
  } catch (e) {
    previewContent.value = `无法读取文件：${e instanceof Error ? e.message : String(e)}`
  } finally {
    previewLoading.value = false
  }
}

async function deleteNode(node: TreeNode): Promise<void> {
  const confirmed = window.confirm(
    node.isDirectory
      ? `确定删除目录「${node.name}」及其全部内容吗？此操作不可恢复。`
      : `确定删除文件「${node.name}」吗？此操作不可恢复。`
  )
  if (!confirmed) return
  try {
    await window.characterArc.agentModules.fsDelete({ path: node.path, recursive: true })
    message.success(`已删除 ${node.name}`)
    if (root.value?.path) await loadRoot(root.value.path)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}

/** 回到智能体默认工作区根（生成产物的目录）。 */
async function backToDefaultRoot(): Promise<void> {
  const res = await window.characterArc.agentModules.workspaceGetRoot()
  if (res?.path) await loadRoot(res.path)
}

onMounted(() => {
  // 默认打开工作区根目录（智能体产物所在位置）
  void backToDefaultRoot()
})

defineExpose({ refresh, loadRoot, pickWorkspace })
</script>

<template>
  <div class="resource-panel">
    <!-- 头部：标题 + 打开工作区 + 刷新 -->
    <div class="rp-head">
      <div class="rp-title-row">
        <span class="rp-title">资源区</span>
        <div class="rp-actions">
          <button type="button" class="rp-btn" title="打开工作区（选择文件夹）" @click="pickWorkspace">
            <FolderPlus :size="14" />
          </button>
          <button type="button" class="rp-btn" title="刷新" @click="refresh">
            <RefreshCw :size="14" />
          </button>
        </div>
      </div>
      <div class="rp-root">
        <span class="rp-root-label">工作区：</span>
        <span class="rp-root-path" :title="root?.path || ''">{{ rootName || '未打开工作区' }}</span>
      </div>
    </div>

    <!-- 未打开工作区提示 -->
    <div v-if="!root && !loadingRoot" class="rp-empty">
      <Folder :size="28" class="rp-empty-icon" />
      <div class="rp-empty-title">尚未打开工作区</div>
      <div class="rp-empty-hint">选择任意文件夹作为资源区，显示其所有文件与隐藏文件。</div>
      <button type="button" class="rp-empty-btn" @click="pickWorkspace">打开工作区</button>
    </div>

    <div v-if="loadingRoot" class="rp-empty">加载中…</div>

    <!-- 文件树 -->
    <div v-else-if="root" class="rp-tree arc-scrollbar">
      <button
        type="button"
        class="rp-row rp-row-root"
        @click="toggleNode(root)"
      >
        <span class="rp-caret">
          <ChevronRight :size="13" :class="{ 'rp-caret-open': root.expanded }" />
        </span>
        <FolderOpen v-if="root.expanded" :size="15" class="rp-icon-dir" />
        <Folder v-else :size="15" class="rp-icon-dir" />
        <span class="rp-name">{{ root.name }}</span>
        <span class="rp-del" title="删除" @click.stop="deleteNode(root)">
          <Trash2 :size="13" />
        </span>
      </button>

      <div v-if="root.expanded" class="rp-children">
        <div v-if="root.loading" class="rp-loading">加载中…</div>
        <div v-else-if="root.children.length === 0" class="rp-children-empty">（空目录）</div>
        <ResourceNode
          v-for="child in root.children"
          v-else
          :key="child.key"
          :node="child"
          :depth="0"
          @toggle="toggleNode"
          @preview="previewFile"
          @delete="deleteNode"
        />
      </div>
    </div>

    <!-- 文件预览弹层 -->
    <div v-if="previewVisible" class="rp-modal">
      <div class="rp-modal-card">
        <div class="rp-modal-head">
          <span class="rp-modal-title">{{ previewName }}</span>
          <button type="button" class="rp-modal-close" @click="previewVisible = false">×</button>
        </div>
        <pre class="rp-modal-content arc-scrollbar">{{ previewLoading ? '加载中…' : previewContent }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.resource-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--arc-bg-surface);
}
.rp-head {
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--arc-border);
  flex-shrink: 0;
}
.rp-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rp-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
}
.rp-actions {
  display: flex;
  gap: 4px;
}
.rp-btn {
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
  transition: all 0.15s ease;
}
.rp-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.rp-root {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  color: var(--arc-text-hint);
}
.rp-root-label {
  flex-shrink: 0;
}
.rp-root-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
  color: var(--arc-text-secondary);
}
.rp-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--arc-text-hint);
  font-size: 12.5px;
  text-align: center;
  padding: 20px;
}
.rp-empty-icon {
  color: var(--arc-border-strong);
}
.rp-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}
.rp-empty-hint {
  max-width: 220px;
  line-height: 1.6;
  color: var(--arc-text-hint);
}
.rp-empty-btn {
  margin-top: 6px;
  border: 1px solid var(--arc-primary);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 12.5px;
  padding: 7px 16px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.rp-empty-btn:hover {
  background: var(--arc-primary);
  color: #fff;
}
.rp-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 8px 12px;
}
.rp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 28px;
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: var(--arc-text-primary);
  cursor: pointer;
  text-align: left;
  border-radius: 6px;
  font-family: inherit;
}
.rp-row:hover {
  background: var(--arc-bg-weak);
}
.rp-row.rp-hidden {
  color: var(--arc-text-hint);
  opacity: 0.72;
}
.rp-row-root {
  font-weight: 600;
}
.rp-caret {
  flex: 0 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--arc-text-hint);
  transition: transform 0.15s ease;
}
.rp-caret-open {
  transform: rotate(90deg);
}
.rp-icon-dir { color: var(--arc-primary); flex-shrink: 0; }
.rp-icon-file { color: var(--arc-text-secondary); flex-shrink: 0; }
.rp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.rp-size {
  font-size: 10.5px;
  color: var(--arc-text-hint);
  flex-shrink: 0;
}
.rp-del {
  display: inline-flex;
  color: var(--arc-text-hint);
  opacity: 0;
  flex-shrink: 0;
}
.rp-row:hover .rp-del {
  opacity: 1;
}
.rp-del:hover {
  color: #b91c1c;
}
.rp-children {
  display: flex;
  flex-direction: column;
}
.rp-children-empty,
.rp-loading {
  padding: 4px 8px 4px 30px;
  font-size: 11.5px;
  color: var(--arc-text-hint);
}
.rp-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.rp-modal-card {
  width: min(720px, 90vw);
  height: 70vh;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.rp-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--arc-border);
}
.rp-modal-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-modal-close {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}
.rp-modal-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--arc-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
