<script setup lang="ts">
import { BookUp2, Bot, ImagePlus, LibraryBig, Plus, Settings2, Trash2, TrendingUp, Upload, Wrench } from 'lucide-vue-next'
import { NButton } from 'naive-ui'

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'continueImport'): void
  (e: 'import'): void
  (e: 'openDeconstruction'): void
  (e: 'openFanqieTrends'): void
  (e: 'openCoverWorkbench'): void
  (e: 'openSkills'): void
  (e: 'openRecycleBin'): void
  (e: 'openSettings'): void
  (e: 'openGlobalAgent'): void
}>()
</script>

<template>
  <header class="homepage-hero">
    <div class="hero-copy">
      <h1>我的作品</h1>
      <p class="hero-subtitle">导入一个项目续写，或新建作品</p>
    </div>

    <div class="hero-actions">
      <div class="action-group secondary-actions">
        <n-button quaternary circle size="large" title="拆书知识库" @click="emit('openDeconstruction')">
          <template #icon><LibraryBig :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="番茄风向标" @click="emit('openFanqieTrends')">
          <template #icon><TrendingUp :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="全局智能体" @click="emit('openGlobalAgent')">
          <template #icon><Bot :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="Skills" @click="emit('openSkills')">
          <template #icon><Wrench :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="封面工作台" @click="emit('openCoverWorkbench')">
          <template #icon><ImagePlus :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="回收站" @click="emit('openRecycleBin')">
          <template #icon><Trash2 :size="20" /></template>
        </n-button>
        <n-button quaternary circle size="large" title="设置" @click="(e: MouseEvent) => { (e.currentTarget as HTMLElement)?.blur(); emit('openSettings') }">
          <template #icon><Settings2 :size="20" /></template>
        </n-button>
      </div>

      <n-button type="primary" size="large" class="create-btn" @click="emit('create')">
        <template #icon><Plus :size="20" /></template>
        新建作品
      </n-button>
      <n-button size="large" class="continue-import-btn" @click="emit('continueImport')">
        <template #icon><BookUp2 :size="19" /></template>
        小说续写
      </n-button>
      <n-button size="large" class="import-btn" @click="emit('import')">
        <template #icon><Upload :size="19" /></template>
        导入项目备份
      </n-button>
    </div>
  </header>
</template>

<style scoped>
.homepage-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--arc-border);
}

.hero-copy {
  min-width: 0;
}

.hero-copy h1 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: clamp(26px, 3vw, 34px);
  font-weight: 740;
  letter-spacing: -0.03em;
}

.hero-copy p {
  margin: 6px 0 0;
  color: var(--arc-text-hint);
  font-size: 14px;
  line-height: 1.6;
  white-space: nowrap;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-weak);
}

.create-btn {
  border-radius: 10px !important;
  font-weight: 700 !important;
  padding: 0 18px !important;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 18%, transparent);
}

.import-btn {
  border-radius: 10px !important;
  font-weight: 700 !important;
  padding: 0 16px !important;
}

.continue-import-btn {
  border-radius: 10px !important;
  border-color: color-mix(in srgb, var(--arc-primary) 34%, var(--arc-border)) !important;
  background: var(--arc-primary-soft) !important;
  color: var(--arc-primary) !important;
  font-weight: 700 !important;
  padding: 0 16px !important;
}

.continue-import-btn:hover {
  border-color: var(--arc-primary) !important;
}

@media (max-width: 720px) {
  .homepage-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .hero-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .action-group {
    justify-content: center;
  }

  .create-btn,
  .continue-import-btn,
  .import-btn {
    flex: 1;
    justify-content: center;
  }
}

</style>
