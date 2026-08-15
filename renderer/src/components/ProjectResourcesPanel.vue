<script setup lang="ts">
/**
 * ProjectResourcesPanel · 项目资源区域
 *
 * 右上角工具栏：新建文件 / 新建文件夹 / 刷新 / 全部折叠（均为 SVG 按钮）。
 * 下方展示当前项目资源目录下的文件夹与文件，并按照文件类型使用对应的 SVG 图标。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ChevronDown, ChevronRight, FilePlus, Folder, FolderOpen, FolderPlus, RefreshCw, UnfoldHorizontal } from 'lucide-vue-next'
import { NButton, NInput, NModal, NTooltip, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import FileTypeIcon from './ProjectResourcesPanel/FileTypeIcon.vue'

interface ResourceEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
  modifiedAt?: string
}

const appStore = useAppStore()
const message = useMessage()

const projectId = computed(() => appStore.currentProject?.id ?? '')

// 当前展示的目录（相对资源根目录的路径，'' 表示根目录）
const currentPath = ref('')
// 面包屑
const crumbs = computed(() => currentPath.value.split('/').filter(Boolean))
// 当前目录条目
const entries = ref<ResourceEntry[]>([])
const loading = ref(false)

// 折叠的目录（相对路径集合）
const collapsedDirs = ref<Set<string>>(new Set())

async function load(path = currentPath.value): Promise<void> {
  if (!projectId.value) return
  loading.value = true
  try {
    const res = await window.characterArc.projectResourceList({ projectId: projectId.value, path })
    if (res.success) {
      currentPath.value = res.path ?? ''
      const list = (res.entries ?? []).slice()
      list.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
      entries.value = list
    } else {
      message.error(res.error ?? '读取资源失败')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '读取资源失败')
  } finally {
    loading.value = false
  }
}

function navigate(rel: string): void {
  void load(rel)
}

function goUp(): void {
  const seg = currentPath.value.split('/').filter(Boolean)
  seg.pop()
  void load(seg.join('/'))
}

function toggleDir(entry: ResourceEntry): void {
  if (!entry.isDirectory) return
  if (collapsedDirs.value.has(entry.path)) {
    collapsedDirs.value.delete(entry.path)
  } else {
    collapsedDirs.value.add(entry.path)
  }
  collapsedDirs.value = new Set(collapsedDirs.value)
}

function isCollapsed(entry: ResourceEntry): boolean {
  return collapsedDirs.value.has(entry.path)
}

// 展开某目录并进入其列表
function openDir(entry: ResourceEntry): void {
  if (!entry.isDirectory) return
  collapsedDirs.value.delete(entry.path)
  collapsedDirs.value = new Set(collapsedDirs.value)
  void load(entry.path)
}

function refresh(): void {
  void load()
}

function collapseAll(): void {
  collapsedDirs.value = new Set(entries.value.filter((e) => e.isDirectory).map((e) => e.path))
  message.success('已折叠全部文件夹')
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ── 新建文件 / 新建文件夹 ──
const createDialogVisible = ref(false)
const createMode = ref<'file' | 'folder'>('file')
const createForm = reactive({ name: '', content: '' })

function openCreateFile(): void {
  createMode.value = 'file'
  createForm.name = ''
  createForm.content = ''
  createDialogVisible.value = true
}
function openCreateFolder(): void {
  createMode.value = 'folder'
  createForm.name = ''
  createForm.content = ''
  createDialogVisible.value = true
}

async function confirmCreate(): Promise<void> {
  const name = createForm.name.trim()
  if (!name) {
    message.warning('请输入名称')
    return
  }
  const payload: {
    projectId: string
    dir: string
    name: string
    content?: string
  } = { projectId: projectId.value, dir: currentPath.value, name }
  try {
    if (createMode.value === 'file') {
      payload.content = createForm.content
      const res = await window.characterArc.projectResourceCreateFile(payload)
      if (!res.success) {
        message.error(res.error ?? '新建文件失败')
        return
      }
      message.success(`已新建文件「${name}」`)
    } else {
      const res = await window.characterArc.projectResourceCreateFolder(payload)
      if (!res.success) {
        message.error(res.error ?? '新建文件夹失败')
        return
      }
      message.success(`已新建文件夹「${name}」`)
    }
    createDialogVisible.value = false
    void load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '创建失败')
  }
}

// ── 重命名 ──
const renameVisible = ref(false)
const renameTarget = ref<ResourceEntry | null>(null)
const renameForm = reactive({ name: '' })

function openRename(entry: ResourceEntry): void {
  renameTarget.value = entry
  renameForm.name = entry.name
  renameVisible.value = true
}

async function confirmRename(): Promise<void> {
  const target = renameTarget.value
  if (!target) return
  const name = renameForm.name.trim()
  if (!name) {
    message.warning('请输入名称')
    return
  }
  try {
    const res = await window.characterArc.projectResourceRename({
      projectId: projectId.value,
      path: target.path,
      newName: name
    })
    if (!res.success) {
      message.error(res.error ?? '重命名失败')
      return
    }
    message.success('重命名成功')
    renameVisible.value = false
    void load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '重命名失败')
  }
}

// ── 删除 ──
const deleteVisible = ref(false)
const deleteTarget = ref<ResourceEntry | null>(null)

function openDelete(entry: ResourceEntry): void {
  deleteTarget.value = entry
  deleteVisible.value = true
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  try {
    const res = await window.characterArc.projectResourceDelete({
      projectId: projectId.value,
      path: target.path
    })
    if (!res.success) {
      message.error(res.error ?? '删除失败')
      return
    }
    message.success('已删除')
    deleteVisible.value = false
    void load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}

// ── 文件预览 ──
const previewVisible = ref(false)
const previewTarget = ref<ResourceEntry | null>(null)
const previewContent = ref('')

async function openPreview(entry: ResourceEntry): Promise<void> {
  if (entry.isDirectory) {
    openDir(entry)
    return
  }
  try {
    const res = await window.characterArc.projectResourceRead({
      projectId: projectId.value,
      path: entry.path
    })
    if (!res.success) {
      message.error(res.error ?? '读取文件失败')
      return
    }
    previewTarget.value = entry
    previewContent.value = res.content ?? ''
    previewVisible.value = true
  } catch (e) {
    message.error(e instanceof Error ? e.message : '读取文件失败')
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="project-resources-panel">
    <div class="section-head">
      <div class="section-title">
        <h2>项目资源</h2>
        <span class="resource-hint">管理当前项目的文件夹与文件</span>
      </div>
      <div class="head-actions toolbar">
        <n-tooltip trigger="hover">
          <template #trigger>
            <button type="button" class="icon-btn" title="新建文件" @click="openCreateFile">
              <FilePlus :size="18" />
            </button>
          </template>
          新建文件
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <button type="button" class="icon-btn" title="新建文件夹" @click="openCreateFolder">
              <FolderPlus :size="18" />
            </button>
          </template>
          新建文件夹
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <button type="button" class="icon-btn" :disabled="loading" title="刷新" @click="refresh">
              <RefreshCw :size="18" :class="{ spinning: loading }" />
            </button>
          </template>
          刷新
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <button type="button" class="icon-btn" title="全部折叠" @click="collapseAll">
              <UnfoldHorizontal :size="18" />
            </button>
          </template>
          全部折叠
        </n-tooltip>
      </div>
    </div>

    <!-- 面包屑导航 -->
    <div class="crumbs">
      <button type="button" class="crumb" :class="{ active: crumbs.length === 0 }" @click="navigate('')">
        项目根目录
      </button>
      <template v-for="(seg, idx) in crumbs" :key="idx">
        <span class="crumb-sep">/</span>
        <button
          type="button"
          class="crumb"
          :class="{ active: idx === crumbs.length - 1 }"
          @click="navigate(crumbs.slice(0, idx + 1).join('/'))"
        >
          {{ seg }}
        </button>
      </template>
    </div>

    <!-- 目录列表 -->
    <div class="resource-body">
      <div v-if="loading" class="resource-empty">正在加载…</div>
      <div v-else-if="entries.length === 0" class="resource-empty">此目录为空，点击右上角“新建文件 / 新建文件夹”开始。</div>
      <ul v-else class="resource-list">
        <li
          v-for="entry in entries"
          :key="entry.path"
          class="resource-item"
          :class="{ folder: entry.isDirectory, collapsed: isCollapsed(entry) }"
        >
          <div class="row" :title="entry.name" @click="entry.isDirectory ? toggleDir(entry) : openPreview(entry)">
            <span class="chevron">
              <ChevronDown v-if="entry.isDirectory && !isCollapsed(entry)" :size="15" />
              <ChevronRight v-else :size="15" />
            </span>
            <span class="icon-slot">
              <FolderOpen v-if="entry.isDirectory && !isCollapsed(entry)" :size="22" class="folder-icon" />
              <Folder v-else-if="entry.isDirectory" :size="22" class="folder-icon" />
              <FileTypeIcon v-else :name="entry.name" :size="22" />
            </span>
            <span class="name">{{ entry.name }}</span>
            <span v-if="entry.isFile" class="meta">{{ formatSize(entry.size) }}</span>
          </div>
          <div class="row-actions">
            <button v-if="entry.isDirectory" type="button" class="mini-btn" title="进入" @click="openDir(entry)">进入</button>
            <button v-else type="button" class="mini-btn" title="预览" @click="openPreview(entry)">预览</button>
            <button type="button" class="mini-btn" title="重命名" @click="openRename(entry)">重命名</button>
            <button type="button" class="mini-btn danger" title="删除" @click="openDelete(entry)">删除</button>
          </div>
        </li>
      </ul>
    </div>

    <!-- 新建文件/文件夹弹窗 -->
    <n-modal v-model:show="createDialogVisible" preset="card" class="create-modal" :title="createMode === 'file' ? '新建文件' : '新建文件夹'">
      <div class="form-stack">
        <n-input v-model:value="createForm.name" :placeholder="createMode === 'file' ? '例如：index.html / 资料.md' : '例如：素材' " />
        <n-input
          v-if="createMode === 'file'"
          v-model:value="createForm.content"
          type="textarea"
          :autosize="{ minRows: 5, maxRows: 12 }"
          placeholder="文件内容（可选）"
        />
        <div class="form-actions">
          <n-button @click="createDialogVisible = false">取消</n-button>
          <n-button type="primary" @click="confirmCreate">确定</n-button>
        </div>
      </div>
    </n-modal>

    <!-- 重命名弹窗 -->
    <n-modal v-model:show="renameVisible" preset="card" class="rename-modal" title="重命名">
      <div class="form-stack">
        <n-input v-model:value="renameForm.name" placeholder="新名称" />
        <div class="form-actions">
          <n-button @click="renameVisible = false">取消</n-button>
          <n-button type="primary" @click="confirmRename">确定</n-button>
        </div>
      </div>
    </n-modal>

    <!-- 删除确认弹窗 -->
    <n-modal v-model:show="deleteVisible" preset="card" class="delete-modal" title="删除确认">
      <p class="delete-text">
        确定删除「{{ deleteTarget?.name }}」吗？{{ deleteTarget?.isDirectory ? '文件夹将连同其中所有内容一并删除。' : '' }}此操作不可恢复。
      </p>
      <div class="form-actions">
        <n-button @click="deleteVisible = false">取消</n-button>
        <n-button type="error" @click="confirmDelete">删除</n-button>
      </div>
    </n-modal>

    <!-- 文件预览弹窗 -->
    <n-modal v-model:show="previewVisible" preset="card" class="preview-modal" :title="previewTarget?.name ?? '文件预览'">
      <pre class="preview-content">{{ previewContent }}</pre>
      <div class="form-actions">
        <n-button @click="previewVisible = false">关闭</n-button>
      </div>
    </n-modal>
  </section>
</template>

<style scoped>
.project-resources-panel {
  max-width: 1180px;
  margin: 0 auto;
  min-width: 0;
  width: 100%;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.section-title h2 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
}

.resource-hint {
  display: block;
  margin-top: 4px;
  color: var(--arc-text-secondary, #94a3b8);
  font-size: 13px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar .icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--arc-text-secondary, #94a3b8);
  cursor: pointer;
  transition: all 0.15s ease;
}
.toolbar .icon-btn:hover {
  background: var(--arc-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--arc-text-primary, #e2e8f0);
  border-color: var(--arc-border, rgba(0, 0, 0, 0.12));
}
.toolbar .icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 面包屑 */
.crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border: 1px solid var(--arc-border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: var(--arc-bg-panel, rgba(0, 0, 0, 0.03));
}
.crumb {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary, #64748b);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.crumb:hover {
  color: var(--arc-accent, #3b82f6);
  background: var(--arc-bg-hover, rgba(0, 0, 0, 0.06));
}
.crumb.active {
  color: var(--arc-text-primary, #e2e8f0);
  font-weight: 600;
  cursor: default;
}
.crumb-sep {
  color: var(--arc-text-secondary, #94a3b8);
  font-size: 13px;
}

/* 列表 */
.resource-body {
  border: 1px solid var(--arc-border, rgba(0, 0, 0, 0.12));
  border-radius: 10px;
  overflow: hidden;
  background: var(--arc-bg-panel, rgba(0, 0, 0, 0.03));
}
.resource-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--arc-text-secondary, #94a3b8);
  font-size: 14px;
}
.resource-list {
  list-style: none;
  margin: 0;
  padding: 6px;
}
.resource-item {
  border-radius: 8px;
}
.resource-item .row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.resource-item .row:hover {
  background: var(--arc-bg-hover, rgba(0, 0, 0, 0.06));
}
.resource-item .row-actions {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 0 8px 6px 36px;
}
.resource-item:hover .row-actions {
  display: flex;
}
.chevron {
  display: inline-flex;
  width: 16px;
  flex-shrink: 0;
  color: var(--arc-text-secondary, #94a3b8);
}
.icon-slot {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.folder-icon {
  color: var(--arc-accent, #3b82f6);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--arc-text-primary, #e2e8f0);
  font-size: 14px;
}
.meta {
  color: var(--arc-text-secondary, #94a3b8);
  font-size: 12px;
  flex-shrink: 0;
}
.mini-btn {
  border: 1px solid var(--arc-border, rgba(0, 0, 0, 0.12));
  background: transparent;
  color: var(--arc-text-secondary, #64748b);
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.mini-btn:hover {
  color: var(--arc-accent, #3b82f6);
  border-color: var(--arc-accent, #3b82f6);
}
.mini-btn.danger:hover {
  color: #ef4444;
  border-color: #ef4444;
}

/* 弹窗 */
.form-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.delete-text {
  margin: 0 0 16px;
  color: var(--arc-text-primary, #e2e8f0);
  line-height: 1.6;
}
.preview-content {
  margin: 0;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-primary, #e2e8f0);
  background: var(--arc-bg-panel, rgba(0, 0, 0, 0.03));
  border: 1px solid var(--arc-border, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  padding: 12px;
}
</style>
