<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bot, Home, Image, Library, Moon, Settings, Sparkles, Sun, Trash2, TrendingUp } from 'lucide-vue-next'
import { createDiscreteApi, NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, NSpin, darkTheme } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { createNaiveThemeOverrides, getThemeColorScheme } from '@/theme/presets'
import { useThemeTransition } from '@/composables/useThemeTransition'
import ProjectCenter from '@/pages/ProjectCenter.vue'
import ProjectWizardPage from '@/pages/ProjectWizardPage.vue'
import ContinuationImportPage from '@/pages/ContinuationImportPage.vue'
import WorkbenchPage from '@/pages/WorkbenchPage.vue'
import ChapterStudioPage from '@/pages/ChapterStudioPage.vue'
import DeconstructionLibraryPage from '@/pages/DeconstructionLibraryPage.vue'
import SkillsPage from '@/pages/SkillsPage.vue'
import CoverWorkbenchPage from '@/pages/CoverWorkbenchPage.vue'
import FanqieTrendsPage from '@/pages/FanqieTrendsPage.vue'
import TitlebarModelSwitcher from '@/components/TitlebarModelSwitcher.vue'
import TitlebarAiTaskCenter from '@/components/TitlebarAiTaskCenter.vue'
import RecycleBinPage from '@/pages/RecycleBinPage.vue'
import GlobalAgentPage from '@/pages/GlobalAgentPage.vue'
import GlobalAiGenerateModal from '@/components/GlobalAiGenerateModal.vue'
import HomepageSettingsModal from '@/components/home/HomepageSettingsModal.vue'

// 全局应用状态
const appStore = useAppStore()
// 当前运行平台（win32 / darwin / linux），用于适配标题栏高度
const platform = window.characterArc?.platform ?? 'unknown'
const settingsVisible = ref(false)
const { message } = createDiscreteApi(['message'])
const { transition: runThemeTransition } = useThemeTransition()

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
  const intensity = appStore.appSettings.themeColorIntensity ?? 0.5
  const safeIntensity = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0.5
  // 主色深浅：向左（接近 0）混合背景色变浅，向右（接近 1）加深主色饱和/深度。
  const mixTarget = dark ? '#000000' : '#ffffff'
  const mixRatio = Math.round(safeIntensity * 100)
  const primary = `color-mix(in srgb, ${themeColors.primary} ${mixRatio}%, ${mixTarget})`
  const primaryHover = `color-mix(in srgb, ${themeColors.primaryHover} ${mixRatio}%, ${mixTarget})`
  const primaryPressed = `color-mix(in srgb, ${themeColors.primaryPressed} ${mixRatio}%, ${mixTarget})`
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
    '--arc-primary': primary,
    '--arc-primary-hover': primaryHover,
    '--arc-primary-pressed': primaryPressed,
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

// 主题主色深浅：把 0-1 的强度值映射为 CSS 变量，供全局样式微调主色浓淡
const themeColorIntensityStyle = computed(() => {
  const intensity = appStore.appSettings.themeColorIntensity ?? 0.5
  const safe = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0.5
  return {
    '--arc-theme-color-intensity': safe
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
  runThemeTransition(() => {
    appStore.updateAppSetting('darkMode', !appStore.appSettings.darkMode, { flushWorkspace: false })
  })
}

// Ctrl+S 全局保存快捷键
async function handleGlobalKeydown(e: KeyboardEvent) {
  // 组合输入（IME）期间不触发 Ctrl+S 全局保存，避免打断中文输入
  if (e.isComposing) return
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

// 窗口隐藏/最小化时给 <html> 打上 .window-hidden 标记，配合全局 CSS 暂停
// 无必要的 CSS 动画与过渡；恢复可见后移除。降低空闲时的 GPU/CPU 占用。
function syncVisibilityClass() {
  const hidden = document.hidden
  document.documentElement.classList.toggle('window-hidden', hidden)
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('beforeunload', handleBeforeUnload)
  document.addEventListener('visibilitychange', syncVisibilityClass)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  document.removeEventListener('visibilitychange', syncVisibilityClass)
})
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-global-style />
        <div class="app-shell" :class="{ 'platform-darwin': platform === 'darwin' }" :style="themeColorIntensityStyle">
          <div class="app-titlebar">
            <div class="app-titlebar__nav">
              <button
                type="button"
                class="app-titlebar__nav-btn"
                title="回到主页"
                aria-label="回到主页"
                @click="appStore.backToProjects()"
              >
                <Home :size="16" />
              </button>
              <button
                type="button"
                class="app-titlebar__nav-btn"
                title="设置"
                aria-label="设置"
                @click="settingsVisible = true"
              >
                <Settings :size="16" />
              </button>
              <button
                type="button"
                class="app-titlebar__nav-btn"
                title="封面生图工作台"
                aria-label="封面生图工作台"
                @click="appStore.openCoverWorkbenchPage()"
              >
                <Image :size="16" />
              </button>
              <button
                type="button"
                class="app-titlebar__nav-btn"
                title="内置 Skills 与项目扩展"
                aria-label="内置 Skills 与项目扩展"
                @click="appStore.openSkillsPage()"
              >
                <Sparkles :size="16" />
              </button>
              <button
                type="button"
                class="app-titlebar__nav-btn"
                title="拆书知识库"
                aria-label="拆书知识库"
                @click="appStore.openDeconstructionLibrary()"
              >
                <Library :size="16" />
              </button>
              <button
                type="button"
                class="app-titlebar__nav-btn"
                title="番茄风向标"
                aria-label="番茄风向标"
                @click="appStore.openFanqieTrends()"
              >
                <TrendingUp :size="16" />
              </button>
              <button
                type="button"
                class="app-titlebar__nav-btn"
                title="全局回收站"
                aria-label="全局回收站"
                @click="appStore.openRecycleBin('global')"
              >
                <Trash2 :size="16" />
              </button>
              <button
                type="button"
                class="app-titlebar__nav-btn"
                title="全局智能体"
                aria-label="全局智能体"
                @click="appStore.openGlobalAgent()"
              >
                <Bot :size="16" />
              </button>
            </div>
            <div class="app-titlebar__tools">
              <TitlebarModelSwitcher />
              <TitlebarAiTaskCenter />
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
              <KeepAlive :max="10">
                <ProjectCenter v-if="appStore.currentView === 'projects'" key="projects" />
                <ProjectWizardPage v-else-if="appStore.currentView === 'wizard'" key="wizard" />
                <ContinuationImportPage v-else-if="appStore.currentView === 'continuation-import'" key="continuation-import" />
                <ChapterStudioPage v-else-if="appStore.currentView === 'chapter-studio'" key="chapter-studio" />
                <DeconstructionLibraryPage v-else-if="appStore.currentView === 'deconstruction-library'" key="deconstruction-library" />
                <SkillsPage v-else-if="appStore.currentView === 'skills'" key="skills" />
                <CoverWorkbenchPage v-else-if="appStore.currentView === 'cover-workbench'" key="cover-workbench" />
                <FanqieTrendsPage v-else-if="appStore.currentView === 'fanqie-trends'" key="fanqie-trends" />
                <RecycleBinPage v-else-if="appStore.currentView === 'recycle-bin'" key="recycle-bin" />
                <GlobalAgentPage v-else-if="appStore.currentView === 'global-agent'" key="global-agent" />
                <WorkbenchPage v-else key="workbench" />
              </KeepAlive>
            </Transition>
          </div>
          <GlobalAiGenerateModal />
        </div>
        <HomepageSettingsModal v-model:show="settingsVisible" />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
