<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Archive, FileJson, FileStack, FileText, Lightbulb, Moon, Network, PenTool, Save, Upload, Users } from 'lucide-vue-next'
import { NButton, NCard, NFormItem, NInput, NSelect, NSwitch, useMessage } from 'naive-ui'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { autoSaveOptions } from '@/features/settings/autoSave'
import { buildProjectWritingStyleContext, defaultWritingStylePresetId } from '@/features/writingStyles/presets'
import {
  WRITING_STYLE_LIMIT,
  filterWritingStyles,
  loadCustomWritingStyles,
  nextCustomColor,
  persistCustomWritingStyles,
  resolveAllWritingStyles,
  type WritingStyleEntry,
  type WritingStyleSearchMode
} from '@/features/writingStyles/styles'
import ProjectArchiveImportModal from '@/components/ProjectArchiveImportModal.vue'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type {
  CharacterArcExportEnvelope,
  ImportExportModuleType,
  ProjectImportPayload
} from '@/types/app'

const appStore = useAppStore()
const message = useMessage()
const archiveImportRef = ref<{
  pickArchive: () => Promise<void>
  isInspectingArchive: boolean
} | null>(null)
const isExportingArchive = ref(false)
const draftWritingStylePresetId = ref('')
const draftWritingStylePrompt = ref('')

const autoSaveSelectOptions = [...autoSaveOptions]
const uiScaleOptions = [
  { label: '75%', value: 0.75 },
  { label: '85%', value: 0.85 },
  { label: '100%', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 },
  { label: '140%', value: 1.4 }
]

const activeWritingStyle = computed(() =>
  buildProjectWritingStyleContext({
    writingStylePresetId: draftWritingStylePresetId.value,
    writingStylePrompt: draftWritingStylePrompt.value
  })
)
const hasStyleDraftChanges = computed(() => {
  const project = appStore.currentProject
  if (!project) {
    return false
  }

  return (
    draftWritingStylePresetId.value !== (project.writingStylePresetId ?? '') ||
    draftWritingStylePrompt.value !== (project.writingStylePrompt ?? '')
  )
})
function saveWritingStyleSettings(): void {
  if (!appStore.currentProject?.id) {
    return
  }

  appStore.updateProject(appStore.currentProject.id, {
    writingStylePresetId: draftWritingStylePresetId.value || 'cinematic-cool',
    writingStylePrompt: draftWritingStylePrompt.value
  })
  message.success('写作风格设置已保存')
}

// ── 自定义写作风格系统 ──
const customWritingStyles = ref<WritingStyleEntry[]>(loadCustomWritingStyles())
const allWritingStyles = computed(() => resolveAllWritingStyles(customWritingStyles.value))
const writingStyleSearch = ref('')
const writingStyleSearchMode = ref<WritingStyleSearchMode>('keyword')
const filteredWritingStyles = computed(() =>
  filterWritingStyles(allWritingStyles.value, writingStyleSearch.value, writingStyleSearchMode.value)
)

// 新建自定义风格表单（内嵌于自定义风格卡片）
const styleForm = reactive({
  label: '',
  description: '',
  prompt: '',
  colorIndex: 0
})
const isImportingStyleSkill = ref(false)

function saveCustomStyle(): void {
  if (!styleForm.label.trim()) {
    message.warning('请填写风格名称')
    return
  }
  if (!styleForm.prompt.trim()) {
    message.warning('请填写风格指令文本')
    return
  }
  if (customWritingStyles.value.length >= WRITING_STYLE_LIMIT) {
    message.warning(`写作风格最多支持 ${WRITING_STYLE_LIMIT} 条，请先删除一些再添加`)
    return
  }
  const colors = nextCustomColor(styleForm.colorIndex)
  customWritingStyles.value = [
    {
      id: `custom-${Date.now()}`,
      label: styleForm.label.trim(),
      description: styleForm.description.trim() || styleForm.label.trim(),
      prompt: styleForm.prompt.trim(),
      accent: colors.accent,
      accentDark: colors.accentDark,
      source: 'custom',
      updatedAt: new Date().toISOString()
    },
    ...customWritingStyles.value
  ]
  persistCustomWritingStyles(customWritingStyles.value)
  styleForm.label = ''
  styleForm.description = ''
  styleForm.prompt = ''
  styleForm.colorIndex = customWritingStyles.value.length % 8
  message.success('自定义写作风格已保存')
}

function removeCustomStyle(style: WritingStyleEntry): void {
  if (style.source === 'builtin') return
  customWritingStyles.value = customWritingStyles.value.filter((item) => item.id !== style.id)
  persistCustomWritingStyles(customWritingStyles.value)
  if (draftWritingStylePresetId.value === style.id) {
    draftWritingStylePresetId.value = defaultWritingStylePresetId
  }
  message.success('已删除该写作风格')
}

/** 从本地 skill 目录导入写作风格 */
async function importStyleFromSkill(): Promise<void> {
  if (isImportingStyleSkill.value) return
  if (customWritingStyles.value.length >= WRITING_STYLE_LIMIT) {
    message.warning(`写作风格最多支持 ${WRITING_STYLE_LIMIT} 条，请先删除一些再导入`)
    return
  }
  isImportingStyleSkill.value = true
  try {
    const projectId = appStore.currentProject?.id ?? ''
    const result = await window.characterArc.importProjectSkillsPackage(projectId)
    if (result.canceled) return
    if (!result.success) {
      message.error(result.error ?? 'Skill 导入失败')
      return
    }
    const skills = await window.characterArc.getProjectSkillsContext(projectId)
    const skillList = skills.success ? skills.skills ?? [] : []
    let imported = 0
    const now = new Date().toISOString()
    const nextStyles = [...customWritingStyles.value]
    for (const skill of skillList) {
      if (nextStyles.length >= WRITING_STYLE_LIMIT) break
      if (!skill.description) continue
      if (nextStyles.some((s) => s.label === skill.name)) continue
      const colors = nextCustomColor(nextStyles.length)
      nextStyles.push({
        id: `skill-${skill.id}-${Date.now()}`,
        label: `技能·${skill.name}`,
        description: skill.description,
        prompt: skill.content || skill.description,
        accent: colors.accent,
        accentDark: colors.accentDark,
        source: 'skill',
        updatedAt: now
      })
      imported++
    }
    if (imported > 0) {
      customWritingStyles.value = nextStyles
      persistCustomWritingStyles(customWritingStyles.value)
      message.success(`已从 Skill 导入 ${imported} 个写作风格`)
    } else {
      message.info('未找到可用于写作风格的新 Skill 描述')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'Skill 导入失败')
  } finally {
    isImportingStyleSkill.value = false
  }
}

function buildExportStem(suffix: string): string {
  const projectTitle = appStore.currentProject?.title?.trim() || 'characterarc'
  const safeTitle = projectTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-')
  return `${safeTitle}-${suffix}`
}

// 构建导出信封：包装数据为标准的 CharacterArc 导出格式，包含版本号和模块类型
function buildExportEnvelope(moduleType: ImportExportModuleType, data: ProjectImportPayload): CharacterArcExportEnvelope {
  return {
    app: 'CharacterArc',
    schemaVersion: '2.0',
    moduleType,
    compatibilityNote: '2.x 导出文件可直接导入当前版本；1.x 旧导出会按兼容模式解析，并默认按完整项目导入。',
    exportedAt: new Date().toISOString(),
    data
  }
}

// 导出 .carc 归档：只传项目 ID，主进程直接从 SQLite 读取并打包，避免大项目数据走 IPC。
async function handleExportProjectArchive(): Promise<void> {
  const project = appStore.currentProject
  if (!project?.id) {
    message.warning('请先打开一个项目再导出归档')
    return
  }

  isExportingArchive.value = true
  try {
    const result = await window.characterArc.exportProjectArchive({
      projectId: project.id,
      projectTitle: project.title
    })
    if (result.success) {
      message.success('项目归档包已导出')
    } else if (!result.canceled) {
      message.error(result.error ?? '导出项目归档失败')
    }
  } finally {
    isExportingArchive.value = false
  }
}

// 导出章节正文为 TXT 文件（仅包含纯文本内容）
async function handleExportText(): Promise<void> {
  const payload = {
    project: appStore.currentProject,
    outlineVolumes: appStore.outlineVolumes,
    chapters: appStore.chapters.map((chapter) => ({
      volumeId: chapter.volumeId,
      title: chapter.title,
      content: getPlainTextFromEditorContent(chapter.content)
    })),
    exportedAt: new Date().toISOString()
  }

  const result = await window.characterArc.exportText(toIpcPayload({
    data: payload,
    title: '导出章节正文 TXT',
    defaultPath: `${buildExportStem('chapters')}.txt`
  }))
  if (result.success) {
    message.success('章节内容已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出 TXT 失败，请稍后重试')
  }
}

// 导出角色资料为 JSON 文件
async function handleExportCharacters(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('characters', {
      project: appStore.currentProject,
      characters: appStore.characters
    }),
    title: '导出角色资料 JSON',
    defaultPath: `${buildExportStem('characters')}.json`
  }))

  if (result.success) {
    message.success('角色资料已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出角色资料失败，请稍后重试')
  }
}

// 导出大纲节点为 JSON 文件
async function handleExportOutline(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('outline', {
      project: appStore.currentProject,
      outlineVolumes: appStore.outlineVolumes,
      outlineItems: appStore.outlineItems
    }),
    title: '导出大纲节点 JSON',
    defaultPath: `${buildExportStem('outline')}.json`
  }))

  if (result.success) {
    message.success('大纲节点已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出大纲节点失败，请稍后重试')
  }
}

// 导出灵感卡片为 JSON 文件
async function handleExportInspiration(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('inspiration', {
      project: appStore.currentProject,
      inspirationEntries: appStore.inspirationEntries
    }),
    title: '导出灵感卡片 JSON',
    defaultPath: `${buildExportStem('inspiration')}.json`
  }))

  if (result.success) {
    message.success('灵感卡片已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出灵感卡片失败，请稍后重试')
  }
}

// 导出关系组织数据为 JSON 文件
async function handleExportRelations(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('relations', {
      project: appStore.currentProject,
      characters: appStore.characters,
      organizations: appStore.organizations,
      characterRelationships: appStore.characterRelationships,
      organizationMemberships: appStore.organizationMemberships
    }),
    title: '导出关系组织 JSON',
    defaultPath: `${buildExportStem('relations')}.json`
  }))

  if (result.success) {
    message.success('关系组织数据已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出关系组织数据失败，请稍后重试')
  }
}

// 导出章节数据（含正文和元信息）为 JSON 文件
async function handleExportChaptersJson(): Promise<void> {
  const result = await window.characterArc.exportJson(toIpcPayload({
    data: buildExportEnvelope('chapters', {
      project: appStore.currentProject,
      outlineVolumes: appStore.outlineVolumes,
      chapters: appStore.chapters,
      chapterVersions: appStore.chapterVersions
    }),
    title: '导出章节数据 JSON',
    defaultPath: `${buildExportStem('chapters')}.json`
  }))

  if (result.success) {
    message.success('章节数据已导出')
    return
  }

  if (!result.canceled) {
    message.error('导出章节数据失败，请稍后重试')
  }
}

watch(
  () => appStore.currentProject,
  (project) => {
    draftWritingStylePresetId.value = project?.writingStylePresetId ?? ''
    draftWritingStylePrompt.value = project?.writingStylePrompt ?? ''
  },
  { immediate: true }
)
</script>

<template>
  <section class="settings-panel">
    <div class="section-head">
      <div>
        <h2>项目设置</h2>
        <p>管理当前项目的备份、导入导出与创作偏好。</p>
      </div>
    </div>

    <div class="settings-wrap">
      <n-card class="setting-card" :bordered="false">
        <template #header>
          <div class="block-title">
            <Save :size="18" />
            <span>存储与备份</span>
          </div>
        </template>
        <div class="storage-status" :class="{ error: appStore.persistenceError }">
          <strong>{{ appStore.persistenceError ? '本地数据状态异常' : '本地数据状态正常' }}</strong>
          <span>
            {{ appStore.persistenceError || '当前工作区内容已接入本地 SQLite 持久化。' }}
          </span>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-name">自动保存时间间隔</div>
            <div class="setting-hint">
              {{ appStore.isLiveAutoSave ? '正文与工作区修改会尽快落盘。' : `正文修改会按 ${appStore.autoSaveIntervalLabel} 进入自动保存队列。` }}
            </div>
          </div>
          <n-select
            class="compact-select"
            :options="autoSaveSelectOptions"
            :value="appStore.appSettings.autoSaveInterval"
            @update:value="(value) => appStore.updateAppSetting('autoSaveInterval', value ?? '5m')"
          />
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-name">界面缩放比例</div>
            <div class="setting-hint">调整整个应用的显示比例，适配高分屏和不同窗口尺寸。</div>
          </div>
          <n-select
            class="compact-select"
            :options="uiScaleOptions"
            :value="appStore.appSettings.uiScale"
            @update:value="(value) => appStore.updateAppSetting('uiScale', value ?? 1)"
          />
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-name">
              <Moon :size="14" style="vertical-align: -2px; margin-right: 5px;" />
              深色模式
            </div>
            <div class="setting-hint">将界面切换为深色背景，适合夜间长时间写作。</div>
          </div>
          <n-switch
            :value="appStore.appSettings.darkMode"
            @update:value="(value) => appStore.updateAppSetting('darkMode', value)"
          />
        </div>
        <div class="setting-actions">
          <n-button type="primary" round strong :loading="isExportingArchive" @click="handleExportProjectArchive">
            <template #icon>
              <Archive :size="16" />
            </template>
            导出项目归档 .carc
          </n-button>
          <n-button round strong :loading="archiveImportRef?.isInspectingArchive" @click="archiveImportRef?.pickArchive()">
            <template #icon>
              <Upload :size="16" />
            </template>
            导入项目归档 .carc
          </n-button>
          <n-button round strong @click="handleExportText">
            <template #icon>
              <FileText :size="16" />
            </template>
            导出为 TXT
          </n-button>
        </div>
        <div class="module-export-block">
          <div class="module-export-copy">
            <div class="setting-name">按模块导出</div>
            <div class="setting-hint">把角色、大纲或章节单独导出，便于分发和复用。</div>
          </div>
          <div class="module-export-grid">
            <button class="module-export-card" @click="handleExportCharacters">
              <Users :size="18" />
              <strong>角色资料</strong>
              <span>导出角色卡与标签</span>
            </button>
            <button class="module-export-card" @click="handleExportOutline">
              <FileStack :size="18" />
              <strong>剧情大纲</strong>
              <span>导出大纲节点与冲突</span>
            </button>
            <button class="module-export-card" @click="handleExportInspiration">
              <Lightbulb :size="18" />
              <strong>灵感卡片</strong>
              <span>导出标题、桥段与转折素材</span>
            </button>
            <button class="module-export-card" @click="handleExportRelations">
              <Network :size="18" />
              <strong>关系组织</strong>
              <span>导出势力、人物关系与成员归属</span>
            </button>
            <button class="module-export-card" @click="handleExportChaptersJson">
              <FileJson :size="18" />
              <strong>章节 JSON</strong>
              <span>导出正文与元信息</span>
            </button>
          </div>
        </div>
      </n-card>

      <n-card class="setting-card" :bordered="false">
        <template #header>
          <div class="block-title">
            <PenTool :size="18" />
            <span>写作风格系统</span>
          </div>
        </template>
        <div class="style-hero">
          <div>
            <strong>{{ activeWritingStyle.label }}</strong>
            <p>{{ activeWritingStyle.description }}</p>
          </div>
          <span class="style-hero-badge">项目默认风格</span>
        </div>
        <div class="style-toolbar">
          <n-input
            v-model:value="writingStyleSearch"
            size="small"
            placeholder="搜索写作风格（名称 / 描述 / 指令）"
            clearable
            class="style-search-input"
          />
          <div class="style-search-mode">
            <button
              v-for="mode in (['keyword', 'fuzzy', 'exact'] as const)"
              :key="mode"
              class="style-mode-btn"
              :class="{ active: writingStyleSearchMode === mode }"
              @click="writingStyleSearchMode = mode"
            >{{ mode === 'keyword' ? '关键字' : mode === 'fuzzy' ? '模糊匹配' : '完整匹配' }}</button>
          </div>
          <n-button size="small" secondary :loading="isImportingStyleSkill" @click="importStyleFromSkill">
            <template #icon><Upload :size="13" /></template>
            导入 Skill
          </n-button>
        </div>
        <div class="style-count-hint">
          共 {{ allWritingStyles.length }} 个风格（内置 + 自定义），自定义与导入上限 {{ WRITING_STYLE_LIMIT }} 条。
        </div>
        <div class="style-preset-grid">
          <button
            v-for="preset in filteredWritingStyles"
            :key="preset.id"
            class="style-preset-card"
            :class="{ active: draftWritingStylePresetId === preset.id }"
            :style="{ background: appStore.appSettings.darkMode ? preset.accentDark : preset.accent }"
            @click="draftWritingStylePresetId = preset.id"
          >
            <strong>{{ preset.label }}</strong>
            <span>{{ preset.description }}</span>
            <span class="style-source-tag" :class="`source-${preset.source}`">
              {{ preset.source === 'builtin' ? '内置' : preset.source === 'skill' ? 'Skill' : '自定义' }}
            </span>
            <span v-if="preset.source !== 'builtin'" class="style-delete-tag" @click.stop="removeCustomStyle(preset)">
              ✕
            </span>
          </button>

          <!-- 自定义风格卡片：与内置风格卡片同尺寸对齐 -->
          <div class="style-preset-card custom-style-card">
            <div class="custom-style-head">
              <strong>自定义风格卡片</strong>
              <span class="style-source-tag source-custom">自定义</span>
            </div>
            <div class="custom-style-fields">
              <label class="custom-field">
                <span class="custom-field-label">风格名称</span>
                <input v-model="styleForm.label" placeholder="例如：霓虹冷硬派" class="custom-input" />
              </label>
              <label class="custom-field">
                <span class="custom-field-label">风格描述</span>
                <input v-model="styleForm.description" placeholder="一句话说明适用场景（可选）" class="custom-input" />
              </label>
              <label class="custom-field">
                <span class="custom-field-label">风格指令文本</span>
                <textarea
                  v-model="styleForm.prompt"
                  rows="3"
                  placeholder="输入要保存为预设的风格指令，例如：对话克制、多用雨幕与霓虹意象、情绪内敛…"
                  class="custom-input"
                ></textarea>
              </label>
              <label class="custom-field">
                <span class="custom-field-label">按钮颜色</span>
                <div class="style-color-picker">
                  <button
                    v-for="(c, i) in 8"
                    :key="i"
                    class="style-color-dot"
                    :class="{ active: styleForm.colorIndex === i }"
                    :style="{ background: nextCustomColor(i).accent }"
                    @click="styleForm.colorIndex = i"
                  />
                </div>
              </label>
              <n-button type="primary" round strong block @click="saveCustomStyle">
                <template #icon><Save :size="14" /></template>
                保存风格
              </n-button>
            </div>
          </div>
        </div>
        <p v-if="!filteredWritingStyles.length" class="style-empty-tip">没有匹配的写作风格，试试更换搜索词或搜索模式。</p>
        <n-form-item label="补充风格要求">
          <n-input
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            v-model:value="draftWritingStylePrompt"
            placeholder="例如：对话更克制，避免现代网络口头禅；环境描写多用霓虹、雨幕、金属反光等意象。"
          />
        </n-form-item>
        <div class="style-save-row">
          <div class="style-save-hint">
            <strong>保存前预览</strong>
            <span>修改风格预设或补充规则后，需要点击保存才会写入当前项目。</span>
          </div>
          <n-button type="primary" round strong :disabled="!hasStyleDraftChanges" @click="saveWritingStyleSettings">
            <template #icon>
              <Save :size="16" />
            </template>
            保存设置
          </n-button>
        </div>
        <div class="style-footnote">
          当前章节助理、灵感生成、大纲扩写和角色/设定生成都会优先参考这里的项目风格。
        </div>
      </n-card>
    </div>

    <ProjectArchiveImportModal ref="archiveImportRef" />
  </section>
</template>

<style scoped>
.settings-panel {
  max-width: 960px;
  margin: 0 auto;
  min-width: 0;
}

.section-head {
  margin-bottom: 32px;
}

.section-head h2 {
  margin: 0 0 8px;
  font-size: clamp(30px, 3.4vw, 38px);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.section-head p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 15px;
}

.settings-wrap {
  display: flex;
  width: min(100%, 720px);
  margin: 0 auto;
  flex-direction: column;
  gap: 20px;
}

.setting-card {
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-sm);
}

.style-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface));
  padding: 16px 18px;
  margin-bottom: 16px;
}

.style-hero strong {
  display: block;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 700;
}

.style-hero p {
  margin: 8px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.style-hero-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  padding: 7px 10px;
  white-space: nowrap;
}

/* ── 写作风格系统：自定义 / 导入 / 搜索 ── */
.style-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.style-search-input {
  flex: 1 1 200px;
  min-width: 160px;
}
.style-search-mode {
  display: inline-flex;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  overflow: hidden;
}
.style-mode-btn {
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.style-mode-btn.active {
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-weight: 600;
}
.style-count-hint {
  color: var(--arc-text-hint);
  font-size: 12px;
  margin-bottom: 10px;
}
.style-color-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.style-empty-tip {
  color: var(--arc-text-hint);
  font-size: 13px;
  text-align: center;
  padding: 12px 0;
}
.style-preset-card {
  position: relative;
}
.style-preset-card .style-source-tag {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-size: 10px;
  font-weight: 800;
  padding: 4px 8px;
  white-space: nowrap;
}
.style-preset-card .style-source-tag.source-custom {
  background: color-mix(in srgb, #16a34a 10%, var(--arc-bg-surface));
  color: #16a34a;
}
.style-preset-card .style-source-tag.source-skill {
  background: color-mix(in srgb, #6366f1 10%, var(--arc-bg-surface));
  color: #6366f1;
}
.style-delete-tag {
  position: absolute;
  bottom: 10px;
  right: 10px;
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.85);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.style-preset-card:hover .style-delete-tag {
  opacity: 1;
}
.style-color-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.style-color-dot {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s;
}
.style-color-dot.active {
  border-color: var(--arc-text-primary);
  transform: scale(1.1);
}

.style-preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.style-preset-card {
  display: flex;
  min-height: 96px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  color: var(--arc-text-primary);
  cursor: pointer;
  padding: 14px;
  text-align: left;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.style-preset-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.style-preset-card.active {
  border-color: color-mix(in srgb, var(--arc-primary) 34%, var(--arc-bg-mix));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.style-preset-card strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--arc-text-primary);
}

.style-preset-card span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

/* 自定义风格卡片：与内置风格卡片同网格对齐，横跨整行占满容器宽度 */
.custom-style-card {
  grid-column: 1 / -1;
  cursor: default;
  background: var(--arc-bg-surface) !important;
}
.custom-style-card:hover {
  transform: none;
  box-shadow: none;
}
.custom-style-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.custom-style-head .style-source-tag {
  position: static;
  flex: 0 0 auto;
}
.custom-style-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.custom-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.custom-field-label {
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.custom-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  padding: 8px 10px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.custom-input:focus {
  border-color: color-mix(in srgb, var(--arc-primary) 55%, var(--arc-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}
.custom-input::placeholder {
  color: var(--arc-text-hint);
}
.custom-style-fields textarea.custom-input {
  resize: vertical;
}

.style-footnote {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.style-save-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
  padding: 14px 16px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
}

.style-save-hint {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.style-save-hint strong {
  font-size: 13px;
  font-weight: 700;
}

.style-save-hint span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.block-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.setting-name {
  font-size: 14px;
  font-weight: 500;
}

.setting-hint {
  margin-top: 4px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.compact-select {
  width: 136px;
}

.setting-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.module-export-block {
  margin-top: 22px;
  padding-top: 22px;
  border-top: 1px solid var(--arc-border);
}

.module-export-copy {
  margin-bottom: 14px;
}

.module-export-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.module-export-card {
  display: flex;
  min-height: 120px;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  padding: 16px;
  text-align: left;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.module-export-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border));
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.module-export-card :deep(svg) {
  color: var(--arc-primary);
}

.module-export-card strong {
  font-size: 14px;
}

.module-export-card span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.storage-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 14px 16px;
  margin-bottom: 18px;
}

.storage-status strong {
  font-size: 13px;
}

.storage-status span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.storage-status.error {
  border-color: color-mix(in srgb, var(--arc-danger) 30%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-danger) 8%, var(--arc-bg-surface));
}

.storage-status.error span,
.storage-status.error strong {
  color: var(--arc-danger);
}

@media (max-width: 1240px) {
  .setting-actions :deep(.n-button) {
    justify-content: center;
  }
}

@media (max-width: 760px) {
  .style-preset-grid {
    grid-template-columns: 1fr;
  }

  .setting-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .compact-select {
    width: 100%;
  }

  .setting-actions {
    flex-direction: column;
  }

  .setting-actions :deep(.n-button) {
    width: 100%;
    justify-content: center;
  }

  .module-export-grid {
    grid-template-columns: 1fr;
  }

  .style-save-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
