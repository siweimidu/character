<script setup lang="ts">
/**
 * ResourceNode · 资源区文件树递归节点
 *
 * 目录节点可展开/折叠，展开时懒加载子项；文件节点点击预览。
 */
import { ChevronRight, FileText, Folder, FolderOpen, Trash2 } from 'lucide-vue-next'
import type { TreeNode } from './ResourcePanel.vue'

defineProps<{
  node: TreeNode
  depth: number
}>()

const emit = defineEmits<{
  (e: 'toggle', node: TreeNode): void
  (e: 'preview', node: TreeNode): void
  (e: 'delete', node: TreeNode): void
}>()

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="rp-node">
    <!-- 目录节点 -->
    <div v-if="node.isDirectory">
      <button
        type="button"
        class="rp-row"
        :class="{ 'rp-hidden': node.hidden }"
        :style="{ paddingLeft: `${12 + depth * 16}px` }"
        @click="emit('toggle', node)"
      >
        <span class="rp-caret" :class="{ 'rp-caret-empty': !node.children.length && !node.loading }">
          <ChevronRight v-if="node.children.length || node.loading" :size="13" :class="{ 'rp-caret-open': node.expanded }" />
        </span>
        <FolderOpen v-if="node.expanded" :size="15" class="rp-icon-dir" />
        <Folder v-else :size="15" class="rp-icon-dir" />
        <span class="rp-name">{{ node.name }}</span>
        <span class="rp-del" title="删除" @click.stop="emit('delete', node)">
          <Trash2 :size="13" />
        </span>
      </button>
      <div v-if="node.expanded" class="rp-children">
        <div v-if="node.loading" class="rp-loading">加载中…</div>
        <div v-else-if="node.children.length === 0" class="rp-children-empty">（空目录）</div>
        <ResourceNode
          v-for="child in node.children"
          v-else
          :key="child.key"
          :node="child"
          :depth="depth + 1"
          @toggle="(n) => emit('toggle', n)"
          @preview="(n) => emit('preview', n)"
          @delete="(n) => emit('delete', n)"
        />
      </div>
    </div>

    <!-- 文件节点 -->
    <button
      v-else
      type="button"
      class="rp-row"
      :class="{ 'rp-hidden': node.hidden }"
      :style="{ paddingLeft: `${12 + depth * 16}px` }"
      @click="emit('preview', node)"
    >
      <span class="rp-caret rp-caret-empty" />
      <FileText :size="15" class="rp-icon-file" />
      <span class="rp-name">{{ node.name }}</span>
      <span class="rp-size">{{ formatSize(node.size) }}</span>
      <span class="rp-del" title="删除" @click.stop="emit('delete', node)">
        <Trash2 :size="13" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.rp-node {
  display: flex;
  flex-direction: column;
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
.rp-caret-empty {
  visibility: hidden;
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
</style>
