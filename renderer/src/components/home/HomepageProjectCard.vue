<script setup lang="ts">
import { ArrowDown, ArrowUp, Check, Clock4, MoreHorizontal } from 'lucide-vue-next'
import type { DropdownOption } from 'naive-ui'
import { NDropdown } from 'naive-ui'
import { isImageCover, resolveCoverStyle } from '@/features/cover/display'
import { formatProjectEditedAt } from '@/features/projects/lastEdited'
import { resolveNovelLengthLabel } from '@/features/wizard/projectGenres'
import type { ProjectSummary } from '@/types/app'

const props = defineProps<{
  project: ProjectSummary
  menuOptions: DropdownOption[]
  featured?: boolean
  animationDelay?: string
  selectMode?: boolean
  selected?: boolean
  /** 手动排序模式：在卡片悬停时显示上/下移动箭头按钮 */
  manualSort?: boolean
  /** 上移按钮是否禁用（当前为第一个时禁用） */
  moveUpDisabled?: boolean
  /** 下移按钮是否禁用（当前为最后一个时禁用） */
  moveDownDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', projectId: string): void
  (e: 'menuSelect', action: string | number, projectId: string): void
  (e: 'toggleSelect', projectId: string): void
  (e: 'moveUp', projectId: string): void
  (e: 'moveDown', projectId: string): void
}>()

/** 卡片点击：批量管理模式下切换选中，否则打开项目 */
function handleCardClick(): void {
  if (props.selectMode) {
    emit('toggleSelect', props.project.id)
  } else {
    emit('open', props.project.id)
  }
}
</script>

<template>
  <article
    class="homepage-project-card"
    :class="{ 'is-select-mode': selectMode, 'is-selected': selected, 'is-manual-sort': manualSort }"
    :style="animationDelay ? { animationDelay } : undefined"
    :data-project-id="project.id"
    @click="handleCardClick"
  >
    <div class="card-main">
      <button
        v-if="selectMode"
        class="card-select-checkbox"
        :class="{ 'is-checked': selected }"
        @click.stop="emit('toggleSelect', project.id)"
      >
        <Check v-if="selected" :size="12" />
      </button>
      <div v-if="isImageCover(project.cover)" class="card-cover" :style="resolveCoverStyle(project.cover)"></div>
      <div v-else class="card-cover card-cover--empty">
        <span class="card-cover-placeholder">暂无封面</span>
      </div>
      <div class="card-copy">
        <h3>{{ project.title }}</h3>
        <div class="card-tags">
          <span class="card-tag">{{ project.genre }}</span>
          <span class="card-tag">{{ resolveNovelLengthLabel(project.novelLength) }}</span>
        </div>
        <p class="card-meta">最近编辑：{{ formatProjectEditedAt(project.lastEdited) }}</p>
        <p v-if="project.createdAt" class="card-meta card-meta-created">建立时间：{{ formatProjectEditedAt(project.createdAt) }}</p>
      </div>

      <div v-if="manualSort" class="move-controls">
        <button
          class="move-btn"
          title="上移一位"
          :disabled="moveUpDisabled"
          @click.stop="emit('moveUp', project.id)"
        >
          <ArrowUp :size="15" />
        </button>
        <button
          class="move-btn"
          title="下移一位"
          :disabled="moveDownDisabled"
          @click.stop="emit('moveDown', project.id)"
        >
          <ArrowDown :size="15" />
        </button>
      </div>

      <n-dropdown
        trigger="click"
        :options="menuOptions"
        placement="bottom-end"
        size="large"
        @select="(key) => emit('menuSelect', key, project.id)"
      >
        <button class="card-menu" @click.stop>
          <MoreHorizontal :size="18" />
        </button>
      </n-dropdown>
    </div>

    <div class="card-footer">
      <Clock4 class="card-footer-icon" :size="14" />
      <span class="card-footer-count">{{ project.wordCount }}</span>
    </div>
  </article>
</template>

<style scoped>
.homepage-project-card {
  position: relative;
  display: flex;
  min-height: 116px;
  flex-direction: column;
  justify-content: space-between;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  cursor: pointer;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.03);
  animation: card-enter 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
  transition:
    border-color 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.homepage-project-card:hover {
  border-color: var(--arc-border-strong);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06), 0 12px 28px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}

.homepage-project-card:active {
  transform: translateY(-1px) scale(0.995);
}

.homepage-project-card.is-select-mode {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
}

.homepage-project-card.is-selected {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-primary) 18%, transparent);
}

.card-select-checkbox {
  display: flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
  border: 1.5px solid var(--arc-border-strong);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: white;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, border-color 0.15s;
}

.card-select-checkbox.is-checked {
  background: var(--arc-primary);
  border-color: var(--arc-primary);
}

.card-main {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.card-cover {
  display: flex;
  width: 68px;
  height: 96px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.08),
    0 6px 14px rgba(0, 0, 0, 0.1);
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-cover-placeholder {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  user-select: none;
}

.card-cover--empty {
  border: 1.5px dashed var(--arc-border-strong);
  background: var(--arc-bg-weak);
  box-shadow: none;
}

.homepage-project-card:hover .card-cover {
  transform: scale(1.04) rotate(-1deg);
}

.card-copy {
  min-width: 0;
  flex: 1;
}

.card-copy h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 16.5px;
  font-weight: 680;
  letter-spacing: -0.015em;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s;
}

.homepage-project-card:hover .card-copy h3 {
  color: var(--arc-primary);
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.card-tag {
  display: inline-flex;
  align-items: center;
  padding: 2.5px 9px;
  border-radius: 999px;
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 680;
  letter-spacing: 0.01em;
}

.card-meta {
  margin: 8px 0 0;
  color: var(--arc-text-hint);
  font-size: 12.5px;
  line-height: 1.5;
}

.card-meta-created {
  margin-top: 3px;
  color: var(--arc-text-hint);
  opacity: 0.82;
}

.card-menu {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-bg-surface) 92%, transparent);
  color: var(--arc-text-hint);
  cursor: pointer;
  opacity: 0;
  transform: translateY(-2px);
  transition:
    opacity 0.2s,
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.15s,
    color 0.15s;
}

.homepage-project-card:hover .card-menu {
  opacity: 1;
  transform: translateY(0);
}

.card-menu:hover {
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-color: var(--arc-border-strong);
}

/* 手动排序时的上/下移动按钮：默认隐藏，悬停卡片时才淡入显示 */
.move-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  align-self: flex-start;
  opacity: 0;
  transform: translateX(6px) scale(0.92);
  transition:
    opacity 0.2s,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.homepage-project-card.is-manual-sort:hover .move-controls {
  opacity: 1;
  transform: translateX(0) scale(1);
}

.move-btn {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s,
    transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.move-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-surface));
  color: var(--arc-primary);
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  transform: scale(1.06);
}

.move-btn:active:not(:disabled) {
  transform: scale(0.94);
}

.move-btn:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}

.card-footer {
  display: flex;
  align-items: center;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--arc-bg-surface-hover);
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 520;
  font-variant-numeric: tabular-nums;
}

.card-footer-icon {
  flex-shrink: 0;
  margin-right: 6px;
}

.card-footer-count {
  line-height: 1;
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .homepage-project-card,
  .card-menu {
    animation: none;
    transition: none;
  }
}
</style>
