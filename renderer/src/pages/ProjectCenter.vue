<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useDialog, useMessage } from 'naive-ui'

import HomepageHero from '@/components/home/HomepageHero.vue'
import HomepageProjectCollection from '@/components/home/HomepageProjectCollection.vue'
import HomepageSettingsModal from '@/components/home/HomepageSettingsModal.vue'
import ProjectArchiveImportModal from '@/components/ProjectArchiveImportModal.vue'
import ProjectEditorModal from '@/components/home/ProjectEditorModal.vue'
import BatchCreateProjectsModal from '@/components/home/BatchCreateProjectsModal.vue'
import { useAppStore } from '@/stores/app'
import type { ProjectSummary } from '@/types/app'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

const settingsVisible = ref(false)
const editorVisible = ref(false)
const batchCreateVisible = ref(false)
const editingProject = ref<ProjectSummary | null>(null)
const archiveImportRef = ref<{
  pickArchive: () => Promise<void>
} | null>(null)

const projectMenuOptions = computed(() => [
  {
    key: 'open',
    label: '打开项目'
  },
  {
    key: 'edit',
    label: '编辑项目信息'
  },
  {
    key: 'recycle',
    label: '项目回收站'
  },
  {
    key: 'divider',
    type: 'divider'
  },
  {
    key: 'delete',
    label: () => h('span', { class: 'project-menu-danger-label' }, '删除项目')
  }
])

function openProject(projectId: string): void {
  appStore.openProject(projectId)
}

function openDeconstructionLibrary(): void {
  appStore.openDeconstructionLibrary()
}

function openSkillsPage(): void {
  const targetProject = appStore.projects.find((project) => project.id === appStore.selectedProjectId)
    ?? appStore.projects[0]

  appStore.openSkillsPage(targetProject?.id)
}

function openCoverWorkbenchPage(): void {
  const targetProject = appStore.projects.find((project) => project.id === appStore.selectedProjectId)
    ?? appStore.projects[0]

  appStore.openCoverWorkbenchPage(targetProject?.id)
}

function openRecycleBin(): void {
  appStore.openRecycleBin('global')
}

/** 项目卡片菜单新增回收站入口，进入该项目回收站 */
function openProjectRecycleBin(projectId: string): void {
  appStore.openRecycleBin(projectId)
}

function openProjectEditor(project?: ProjectSummary): void {
  editingProject.value = project ?? null
  editorVisible.value = true
}

function handleSettingsClosed(): void {
  // 关闭设置悬浮窗后清除可能残留的按钮焦点/高亮状态
  ;(document.activeElement as HTMLElement | null)?.blur?.()
}

function handleMenuSelect(action: string | number, projectId: string): void {
  if (action === 'open') {
    openProject(projectId)
    return
  }

  if (action === 'edit') {
    const project = appStore.projects.find((item) => item.id === projectId)
    if (project) {
      openProjectEditor(project)
    }
    return
  }

  if (action === 'recycle') {
    openProjectRecycleBin(projectId)
    return
  }

  if (action === 'delete') {
    requestDeleteProject(projectId)
  }
}

async function handlePickCover(): Promise<void> {
  if (!editingProject.value) {
    return
  }

  const result = await window.characterArc.pickCoverImage()
  if (!result.success || result.canceled || !result.dataUrl) {
    return
  }

  editingProject.value = {
    ...editingProject.value,
    cover: result.dataUrl
  }
  message.success('项目封面已更新')
}

function submitProject(payload: {
  id: string
  title: string
  genre: string
  premise: string
  novelLength: ProjectSummary['novelLength']
  cover: string
  targetPlatform: string
}): void {
  appStore.updateProject(payload.id, {
    title: payload.title,
    genre: payload.genre,
    premise: payload.premise,
    novelLength: payload.novelLength,
    cover: payload.cover,
    targetPlatform: payload.targetPlatform
  })
  editorVisible.value = false
  message.success('项目信息已更新')
}

function requestDeleteProject(projectId: string): void {
  const project = appStore.projects.find((item) => item.id === projectId)
  if (!project) {
    return
  }

  dialog.warning({
    title: '确认删除项目',
    content: `确定要删除"${project.title}"吗？删除后整个项目会移入回收站，可在回收站中恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteProject(projectId)
    }
  })
}

function requestBatchDeleteProjects(projectIds: string[]): void {
  if (projectIds.length === 0) {
    return
  }

  const projectTitles = projectIds
    .map((id) => appStore.projects.find((item) => item.id === id)?.title)
    .filter(Boolean)
    .join('、')

  dialog.warning({
    title: '确认批量删除',
    content: `确定要删除以下 ${projectIds.length} 个项目吗？\n${projectTitles}\n\n删除后这些项目会移入回收站，可在回收站中恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      for (const projectId of projectIds) {
        appStore.deleteProject(projectId)
      }
      message.success(`已删除 ${projectIds.length} 个项目`)
    }
  })
}
</script>

<template>
  <section class="project-center">
    <div class="project-shell">
      <HomepageHero
        @create="appStore.openWizard()"
        @continue-import="appStore.openContinuationImport()"
        @import="archiveImportRef?.pickArchive()"
        @open-deconstruction="openDeconstructionLibrary"
        @open-fanqie-trends="appStore.openFanqieTrends()"
        @open-cover-workbench="openCoverWorkbenchPage"
        @open-skills="openSkillsPage"
        @open-recycle-bin="openRecycleBin"
        @open-settings="settingsVisible = true"
        @open-global-agent="appStore.openGlobalAgent()"
      />

      <HomepageProjectCollection
        :projects="appStore.projects"
        :menu-options="projectMenuOptions"
        @open="openProject"
        @menu-select="handleMenuSelect"
        @batch-delete="requestBatchDeleteProjects"
        @batch-create="batchCreateVisible = true"
      />
    </div>

    <ProjectEditorModal
      v-model:show="editorVisible"
      :project="editingProject"
      @pick-cover="handlePickCover"
      @submit="submitProject"
    />

    <BatchCreateProjectsModal v-model:show="batchCreateVisible" />

    <HomepageSettingsModal v-model:show="settingsVisible" @closed="handleSettingsClosed" />
    <ProjectArchiveImportModal ref="archiveImportRef" />
  </section>
</template>

<style scoped>
.project-center {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 100%;
  overflow-y: auto;
  background: var(--arc-bg-body);
}

.project-shell {
  width: min(100%, 1100px);
  margin: 0 auto;
  padding:
    calc(var(--arc-titlebar-height) + clamp(20px, 3vw, 28px))
    clamp(16px, 2.6vw, 28px)
    clamp(28px, 4vw, 44px);
}

@supports (padding-right: max(1px, 2px)) {
  .project-shell {
    padding-right: max(clamp(16px, 2.6vw, 28px), calc(env(titlebar-area-x, 0px) + env(titlebar-area-width, 100vw) - 100% + 18px));
  }
}

:deep(.project-menu-danger-label) {
  color: var(--arc-danger);
}
</style>
