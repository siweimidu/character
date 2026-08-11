<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { Moon, Sun } from 'lucide-vue-next'
import { createDiscreteApi, NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, NSpin, darkTheme } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { createNaiveThemeOverrides, getThemeColorScheme } from '@/theme/presets'
import ProjectCenter from '@/pages/ProjectCenter.vue'
import ProjectWizardPage from '@/pages/ProjectWizardPage.vue'
import ContinuationImportPage from '@/pages/ContinuationImportPage.vue'
import WorkbenchPage from '@/pages/WorkbenchPage.vue'
import ChapterStudioPage from '@/pages/ChapterStudioPage.vue'
import DeconstructionLibraryPage from '@/pages/DeconstructionLibraryPage.vue'
import SkillsPage from '@/pages/SkillsPage.vue'
import CoverWorkbenchPage from '@/pages/CoverWorkbenchPage.vue'
import FanqieTrendsPage from '@/pages/FanqieTrendsPage.vue'
import QimaoScoutPage from '@/pages/QimaoScoutPage.vue'
import AiTaskProgressDock from '@/components/AiTaskProgressDock.vue'
import TitlebarModelSwitcher from '@/components/TitlebarModelSwitcher.vue'

// 全局应用状态
const appStore = useAppStore()
// 当前运行平台（win32 / darwin / linux），用于适配标题栏高度
const platform = window.characterArc?.platform ?? 'unknown'
const appName = '弧光'
const { message } = createDiscreteApi(['message'])
let themeTransitionFrame: number | null = null

// 根据当前选中主题生成 Naive UI 主题覆盖变量
const themeOverrides = computed(() =>
  createNaiveThemeOverrides(
    appStore.theme,
    appStore.appSettings.darkMode,
    appStore.appSettings.darkModeStyle
  )
)
// 深色模式时启用 Naive UI 官方 darkTheme
const naiveTheme = computed(() => appStore.appSettings.darkMode ? darkTheme : null)

// 应用级 CSS 自定义变量集合，供全局样式引用
const appStyleVars = computed(() => {
  const dark = appStore.appSettings.darkMode
  const themeColors = getThemeColorScheme(appStore.theme, dark)
  return {
    '--arc-bg-body': themeColors.bgBody,
    '--arc-bg-weak': themeColors.bgWeak,
    '--arc-bg-surface': themeColors.bgSurface,
    '--arc-bg-surface-hover': themeColors.bgSurfaceHover,
    '--arc-bg-sidebar': themeColors.bgSidebar,
    '--arc-sidebar-border': themeColors.sidebarBorder,
    '--arc-text-primary': themeColors.textPrimary,
    '--arc-text-secondary': themeColors.textSecondary,
    '--arc-text-hint': themeColors.textHint,
    '--arc-primary': themeColors.primary,
    '--arc-primary-hover': themeColors.primaryHover,
    '--arc-primary-pressed': themeColors.primaryPressed,
    '--arc-primary-soft': themeColors.primarySoft,
    '--arc-border': themeColors.border,
    '--arc-border-strong': themeColors.borderStrong,
    '--arc-shadow-sm': themeColors.shadowSm,
    '--arc-shadow-md': themeColors.shadowMd,
    '--arc-shadow-lg': themeColors.shadowLg,
    '--arc-bg-mix': themeColors.bgMix,
    '--arc-glass-04': dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    '--arc-glass-06': dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    '--arc-glass-08': dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
    '--arc-glass-10': dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)',
    '--arc-glass-12': dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
    '--arc-success': themeColors.success,
    '--arc-warning': themeColors.warning,
    '--arc-danger': themeColors.danger,
    '--arc-selection-bg': dark
      ? `color-mix(in srgb, ${themeColors.primary} 48%, ${themeColors.bgBody})`
      : 'color-mix(in srgb, ' + themeColors.primary + ' 20%, transparent)',
    '--arc-selection-text': themeColors.textPrimary,
    '--arc-caret-color': themeColors.primary,
    '--arc-radius-sm': '4px',
    '--arc-radius-md': '6px',
    '--arc-radius-lg': '10px',
    '--arc-titlebar-height': '0px',
    '--arc-window-controls-width': '0px'
  }
})

// 监听 UI 缩放比例变化，限制在 0.75~1.75 倍之间并同步给 Electron 窗口
watch(
  () => appStore.appSettings.uiScale,
  async (factor) => {
    const nextFactor = Number.isFinite(factor) ? Math.min(1.75, Math.max(0.75, factor)) : 1
    await window.characterArc.setZoomFactor(nextFactor)
  },
  { immediate: true }
)

// 将 CSS 变量同步到 :root，使 Naive UI 弹出层（portal 渲染到 body）也能继承正确的深色值
watch(
  appStyleVars,
  (vars) => {
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value)
    }
    if (platform === 'win32') {
      void window.characterArc.setTitleBarOverlay({
        color: vars['--arc-bg-body'],
        symbolColor: vars['--arc-text-secondary']
      })
    }
  },
  { immediate: true }
)

// 将 dark-mode class 同步到 <html>，使 teleport 到 body 的弹窗（NModal 等）也能命中暗黑样式
watch(
  () => appStore.appSettings.darkMode,
  (dark) => {
    document.documentElement.classList.toggle('dark-mode', dark)
  },
  { immediate: true }
)

function shouldShowManualSaveToast(): boolean {
  return appStore.currentView === 'chapter-studio' || appStore.activePanel === 'chapters'
}

function toggleDarkMode(): void {
  const root = document.documentElement
  root.classList.add('theme-switching')
  if (themeTransitionFrame !== null) {
    window.cancelAnimationFrame(themeTransitionFrame)
  }
  appStore.updateAppSetting('darkMode', !appStore.appSettings.darkMode, { flushWorkspace: false })
  themeTransitionFrame = window.requestAnimationFrame(() => {
    themeTransitionFrame = window.requestAnimationFrame(() => {
      root.classList.remove('theme-switching')
      themeTransitionFrame = null
    })
  })
}

// Ctrl+S 全局保存快捷键
async function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    await appStore.persistWorkspace()
    if (appStore.persistenceError) {
      if (shouldShowManualSaveToast()) {
        message.error(appStore.persistenceError)
      }
      return
    }
    if (shouldShowManualSaveToast()) {
      message.success('当前章节已保存')
    }
  }
}

function handleBeforeUnload() {
  appStore.flushWorkspaceSync()
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('beforeunload', handleBeforeUnload)
})
onBeforeUnmount(() => {
  if (themeTransitionFrame !== null) {
    window.cancelAnimationFrame(themeTransitionFrame)
    document.documentElement.classList.remove('theme-switching')
  }
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-global-style />
        <div class="app-shell" :class="{ 'platform-darwin': platform === 'darwin' }">
          <div class="app-titlebar">
            <span class="app-titlebar__brand">
              {{ appName }}
              <span class="app-titlebar__tag">开源免费</span>
            </span>
            <div class="app-titlebar__tools">
              <TitlebarModelSwitcher />
              <button
                type="button"
                class="app-titlebar__theme-toggle"
                :class="{ 'is-dark': appStore.appSettings.darkMode }"
                :title="appStore.appSettings.darkMode ? '切换到浅色模式' : '切换到深色模式'"
                :aria-label="appStore.appSettings.darkMode ? '切换到浅色模式' : '切换到深色模式'"
                @click="toggleDarkMode"
              >
                <Sun v-if="appStore.appSettings.darkMode" :size="15" />
                <Moon v-else :size="15" />
              </button>
            </div>
          </div>
          <div class="app-content">
            <div v-if="appStore.persistenceError" class="app-error-banner">
              <strong>本地数据读写异常</strong>
              <span>{{ appStore.persistenceError }}</span>
            </div>
            <div v-if="!appStore.hasHydrated" class="app-loading">
              <n-spin size="large" />
              <p>正在载入本地工作区...</p>
            </div>
            <Transition v-else name="view-fade" mode="out-in">
              <ProjectCenter v-if="appStore.currentView === 'projects'" key="projects" />
              <ProjectWizardPage v-else-if="appStore.currentView === 'wizard'" key="wizard" />
              <ContinuationImportPage v-else-if="appStore.currentView === 'continuation-import'" key="continuation-import" />
              <ChapterStudioPage v-else-if="appStore.currentView === 'chapter-studio'" key="chapter-studio" />
              <DeconstructionLibraryPage v-else-if="appStore.currentView === 'deconstruction-library'" key="deconstruction-library" />
              <SkillsPage v-else-if="appStore.currentView === 'skills'" key="skills" />
              <CoverWorkbenchPage v-else-if="appStore.currentView === 'cover-workbench'" key="cover-workbench" />
              <FanqieTrendsPage v-else-if="appStore.currentView === 'fanqie-trends'" key="fanqie-trends" />
              <QimaoScoutPage v-else-if="appStore.currentView === 'qimao-scout'" key="qimao-scout" />
              <WorkbenchPage v-else key="workbench" />
            </Transition>
          </div>
          <AiTaskProgressDock />
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
