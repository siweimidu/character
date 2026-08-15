<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArchiveRestore, ChevronDown, Download, FileCode, FileDown, FileJson, FileText, RefreshCw, ScrollText, Trash2 } from 'lucide-vue-next'
import { NCheckbox, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AiRunRecord } from '@/types/app'

const message = useMessage()
const appStore = useAppStore()
const isFetchingModels = ref(false)
const fetchedModels = ref<Array<{ id: string }>>([])
const logVisible = ref(false)
const LOG_PAGE_SIZE = 30
const visibleLogCount = ref(LOG_PAGE_SIZE)
const selectedRunIds = ref<Set<string>>(new Set())
const isExporting = ref(false)

const profileOptions = computed(() =>
  appStore.appSettings.aiProfiles.map(p => ({ label: p.name, value: p.id }))
)

const modelOptions = computed(() => {
  // 优先使用当前接口配置下已保存的模型列表，方便在同一接口内快速切换
  const activeProfile = appStore.appSettings.aiProfiles.find(
    (p) => p.id === appStore.appSettings.activeAiProfileId
  )
  const savedModels = activeProfile?.models?.filter(Boolean) ?? []
  const baseOptions = savedModels.map((m) => ({ label: m, value: m }))
  if (fetchedModels.value.length > 0) {
    const merged = new Map<string, { label: string; value: string }>()
    for (const m of fetchedModels.value) merged.set(m.id, { label: m.id, value: m.id })
    for (const opt of baseOptions) if (!merged.has(opt.value)) merged.set(opt.value, opt)
    return Array.from(merged.values())
  }
  if (baseOptions.length > 0) return baseOptions
  const current = appStore.appSettings.model
  return current ? [{ label: current, value: current }] : []
})

const activeProfileId = computed({
  get: () => appStore.appSettings.activeAiProfileId,
  set: (id: string) => appStore.switchAiProfile(id)
})

const activeModel = computed({
  get: () => appStore.appSettings.model,
  set: (model: string) => appStore.updateActiveAiProfileModel(model)
})

const hasProfiles = computed(() => appStore.appSettings.aiProfiles.length > 0)
const aiRunLogs = computed(() => appStore.allAiRuns)
const visibleAiRunLogs = computed(() =>
  aiRunLogs.value.slice(0, visibleLogCount.value).map((run) => {
    const readStats = toolReadStats(run)
    return {
      run,
      taskLabel: formatTaskLabel(run.task, run.clientKey),
      projectTitle: projectTitleFor(run),
      chapterTitle: chapterTitleFor(run),
      startedAt: formatTime(run.startedAt),
      finishedAt: run.finishedAt ? formatTime(run.finishedAt) : '',
      duration: formatDuration(run.durationMs),
      tokenUsage: formatTokenUsage(run),
      readStats
    }
  })
)
const hasMoreAiRunLogs = computed(() => visibleLogCount.value < aiRunLogs.value.length)
const projectTitleById = computed(() => {
  const map = new Map<string, string>()
  for (const project of appStore.projects) {
    map.set(project.id, project.title?.trim() || '未命名项目')
  }
  return map
})
function projectTitleFor(run: AiRunRecord): string {
  if (!run.projectId) return ''
  return projectTitleById.value.get(run.projectId) || '待创建或已删除项目'
}

const statusMeta: Record<AiRunRecord['status'], { label: string; type: 'default' | 'info' | 'success' | 'error' | 'warning' }> = {
  running: { label: '运行中', type: 'info' },
  success: { label: '成功', type: 'success' },
  error: { label: '失败', type: 'error' },
  canceled: { label: '已取消', type: 'warning' }
}

const taskLabelMap: Record<string, string> = {
  'global-assistant': '全局助理',
  'global-assistant-proposal': '写回提案',
  'chapter-assistant': '章节助理',
  'chapter-first-draft': '章节初稿',
  'chapter-memo': '写作备忘',
  'chapter-audit': '章节审计',
  'chapter-repair': '章节修复',
  'chapter-humanize': '章节去 AI 味',
  'chapter-summarize': '章节摘要',
  'chapter-scene-plan': '场景规划',
  'chapter-analysis': '章节分析',
  'chapter-session-note': '写作日志',
  'story-deep-audit': '全书审计',
  'state-backfill': '状态补录',
  'assistant-intent': '意图判断',
  'assistant-action-proposal': '操作建议',
  'worldview-entry': '世界观生成',
  'worldview-enhance': '世界观补充',
  'character-card': '角色生成',
  'character-enhance': '角色补充',
  'relation-enhance': '关系补充',
  'outline-item': '大纲扩写',
  'outline-batch': '分卷补全',
  'outline-chain': '大纲链编',
  'outline-enhance': '大纲补充',
  'reference-deep-analyze': '深度拆书',
  'reference-style-chunk': '风格拆解',
  'reference-style-analysis': '风格分析',
  'style-fingerprint-extract': '风格指纹提取',
  'workflow-documents': '设定导出',
  'plot-thread-detect': '伏笔检测',
  'premise-enhance': '小说简介优化',
  'premise-generate': '小说简介创作',
  'project-bootstrap': '项目初始化',
  'project-batch-seed': '批量生成作品',
  'spiral-seed': '项目核心设计',
  'spiral-expand': '角色关系与大纲扩展',
  'spiral-characters': '深度构建配角',
  'spiral-organizations': '深度构建组织',
  'spiral-relationships': '深度构建关系',
  'spiral-worldview-expand': '深度补充世界观',
  'spiral-outline': '深度构建大纲',
  'spiral-validate': '项目一致性校验',
  'inspiration-pack': '灵感整理',
  'catalog-batch': '图鉴批量生成',
  'catalog-batch:character': '角色批量生成',
  'catalog-batch:organization': '组织批量生成',
  'catalog-batch:relationship': '人物关系批量生成',
  'catalog-batch:membership': '组织成员批量生成',
  'catalog-batch:worldview': '世界观批量生成',
  'catalog-batch:inspiration': '灵感批量生成',
  'catalog-batch:plot-thread': '伏笔线索批量生成',
  'cover-generate': '封面生成',
  'ai-novel-from-reference': '按拆书风格生成作品',
  'prompt-generate': 'AI 生成写作提示词',
  'fanqie-seed': '番茄风向选题'
}

async function handleFetchModels(): Promise<void> {
  if (isFetchingModels.value) return
  isFetchingModels.value = true
  try {
    const result = await window.characterArc.fetchModels(toIpcPayload({ ...appStore.appSettings }))
    if (result.success && result.result) {
      fetchedModels.value = result.result
    }
  } catch {
    // silent
  } finally {
    isFetchingModels.value = false
  }
}

function formatTaskLabel(task: string, clientKey?: string): string {
  // 多批次批量生成时 clientKey 会带 #N 后缀（如 catalog-batch:plot-thread#2），需剥离后匹配
  const baseClientKey = clientKey?.split('#')[0]
  return (baseClientKey && taskLabelMap[baseClientKey]) || taskLabelMap[task] || task
}

function formatTime(value?: string): string {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return '未记录'
  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${(durationMs / 60_000).toFixed(1)}min`
}

function formatTokenUsage(run: AiRunRecord): string {
  const total = run.usage?.totalTokens
  const prompt = run.usage?.promptTokens
  const completion = run.usage?.completionTokens
  if (total) {
    return `总 ${total} tokens${prompt || completion ? ` · 输入 ${prompt || 0} / 输出 ${completion || 0}` : ''}`
  }
  if (prompt || completion) {
    return `输入 ${prompt || 0} / 输出 ${completion || 0}`
  }
  return '未记录 token'
}

function chapterTitleFor(run: AiRunRecord): string {
  if (!run.chapterId) return ''
  return appStore.chapters.find((chapter) => chapter.id === run.chapterId)?.title ?? ''
}

function toolReadStats(run: AiRunRecord): { reads: number; hits: number } {
  const calls = Array.isArray(run.toolCalls) ? run.toolCalls : []
  const readTools = new Set(['read_project_data', 'read_chapter', 'list_chapters'])
  const discoveryTools = new Set(['search_project'])

  let reads = 0
  let hits = 0

  for (const call of calls) {
    if (!call || call.status !== 'ok') {
      continue
    }

    if (readTools.has(call.tool) || discoveryTools.has(call.tool)) {
      reads += 1
    }

    if (call.tool === 'read_project_data' || call.tool === 'read_chapter') {
      hits += 1
      continue
    }

    if (call.tool === 'list_chapters') {
      hits += 1
      continue
    }

    if (call.tool === 'search_project') {
      const rawQuery = typeof call.args.query === 'string' ? call.args.query.trim() : ''
      hits += rawQuery ? 1 : 0
    }
  }

  return { reads, hits }
}

function openLogModal(): void {
  visibleLogCount.value = LOG_PAGE_SIZE
  logVisible.value = true
}

function loadMoreAiRunLogs(): void {
  visibleLogCount.value += LOG_PAGE_SIZE
}

const isAllSelected = computed(() =>
  aiRunLogs.value.length > 0 && aiRunLogs.value.every((item) => selectedRunIds.value.has(item.id))
)

function toggleSelectAll(): void {
  if (isAllSelected.value) {
    selectedRunIds.value = new Set()
  } else {
    selectedRunIds.value = new Set(aiRunLogs.value.map((item) => item.id))
  }
}

function toggleSelectRun(id: string): void {
  const next = new Set(selectedRunIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedRunIds.value = next
}

function openGlobalRecycleBin(): void {
  logVisible.value = false
  appStore.openRecycleBin('global')
}

function exportAiRuns(format: 'txt' | 'markdown' | 'json' | 'xlsx', rows: Array<Record<string, unknown>>): Promise<boolean> {
  return window.characterArc.exportAiRuns({
    format,
    rows,
    defaultFileName: 'AI调用日志'
  }).then((result) => {
    if (result.success) {
      message.success('AI 调用日志已导出')
      return true
    }
    if (!result.canceled && result.error) {
      message.error(result.error)
    }
    return false
  }).catch((error) => {
    message.error(error instanceof Error ? error.message : '导出失败')
    return false
  })
}

function toExportRows(runs: AiRunRecord[]): Array<Record<string, unknown>> {
  return runs.map((run) => ({
    任务: formatTaskLabel(run.task, run.clientKey),
    厂商: run.provider,
    模型: run.model,
    状态: statusMeta[run.status]?.label || run.status,
    开始时间: run.startedAt ? formatTime(run.startedAt) : '',
    结束时间: run.finishedAt ? formatTime(run.finishedAt) : '',
    耗时: formatDuration(run.durationMs),
    token用量: formatTokenUsage(run),
    关联项目: projectTitleFor(run),
    关联章节: chapterTitleFor(run),
    响应预览: run.responsePreview || '',
    错误信息: run.error || ''
  }))
}

async function handleExport(format: 'txt' | 'markdown' | 'json' | 'xlsx'): Promise<void> {
  const target = selectedRunIds.value.size > 0
    ? aiRunLogs.value.filter((item) => selectedRunIds.value.has(item.id))
    : aiRunLogs.value
  if (!target.length) {
    message.warning('没有可导出的记录')
    return
  }
  if (isExporting.value) return
  isExporting.value = true
  try {
    await exportAiRuns(format, toExportRows(target))
  } finally {
    isExporting.value = false
  }
}

function handleBatchDelete(): void {
  if (!selectedRunIds.value.size) {
    message.warning('请先勾选要删除的日志')
    return
  }
  const ids = [...selectedRunIds.value]
  appStore.moveAiRunsToRecycle(ids)
  selectedRunIds.value = new Set()
  message.success(`已将 ${ids.length} 条日志移入全局回收站`)
}
</script>

<template>
  <div v-if="hasProfiles" class="titlebar-switcher">
    <div class="switcher-combined" title="模型切换">
      <n-select
        :value="activeProfileId"
        :options="profileOptions"
        size="tiny"
        class="switcher-profile"
        :consistent-menu-width="false"
        @update:value="(v: string) => { activeProfileId = v; fetchedModels = [] }"
      />
      <span class="switcher-sep" />
      <n-select
        :value="activeModel"
        :options="modelOptions"
        size="tiny"
        class="switcher-model"
        filterable
        tag
        :consistent-menu-width="false"
        @update:value="(v: string) => { activeModel = v }"
      />
    </div>
    <button
      class="switcher-refresh"
      title="刷新模型列表"
      :disabled="isFetchingModels"
      @click="handleFetchModels"
    >
      <RefreshCw :size="13" :class="{ spinning: isFetchingModels }" />
    </button>
    <button
      class="switcher-log"
      title="查看 AI 调用日志"
      @click="openLogModal"
    >
      <ScrollText :size="13" />
      <span>AI调用日志</span>
    </button>
  </div>

  <n-modal
    v-if="logVisible"
    :show="logVisible"
    preset="card"
    class="ai-log-modal"
    :bordered="false"
    :style="{ width: 'min(720px, calc(100vw - 24px))' }"
    @close="logVisible = false"
  >
    <div class="ai-log-modal__summary">
      <strong>AI 调用日志</strong>
      <span>全部调用 · {{ aiRunLogs.length }} 条记录</span>
    </div>

    <div v-if="aiRunLogs.length" class="ai-log-toolbar">
      <label class="ai-log-select-all">
        <n-checkbox :checked="isAllSelected" @update:checked="toggleSelectAll" />
        <span>全选</span>
      </label>
      <div class="ai-log-toolbar__spacer" />
      <div class="ai-log-toolbar__actions">
        <button
          class="ai-log-tool-btn"
          type="button"
          :disabled="!selectedRunIds.size"
          title="删除所选日志（移入全局回收站）"
          @click="handleBatchDelete"
        >
          <Trash2 :size="13" />
          <span>批量删除</span>
        </button>
        <div class="ai-log-export">
          <button class="ai-log-tool-btn" type="button" :disabled="isExporting" title="导出所选（未勾选则导出全部）">
            <Download :size="13" />
            <span>导出</span>
          </button>
          <div class="ai-log-export__menu">
            <button type="button" @click="handleExport('txt')"><FileText :size="13" /><span>TXT</span></button>
            <button type="button" @click="handleExport('markdown')"><FileDown :size="13" /><span>Markdown</span></button>
            <button type="button" @click="handleExport('json')"><FileJson :size="13" /><span>JSON</span></button>
            <button type="button" @click="handleExport('xlsx')"><FileCode :size="13" /><span>Excel</span></button>
          </div>
        </div>
        <button
          class="ai-log-tool-btn ai-log-tool-btn--recycle"
          type="button"
          title="前往全局回收站查看已删除内容"
          @click="openGlobalRecycleBin"
        >
          <ArchiveRestore :size="13" />
          <span>全局回收站</span>
        </button>
      </div>
    </div>

    <div v-if="!aiRunLogs.length" class="ai-log-empty">
      还没有任何 AI 调用日志。
    </div>

    <div v-else class="ai-log-list arc-scrollbar">
      <article
        v-for="item in visibleAiRunLogs"
        :key="item.run.id"
        class="ai-log-card"
        :class="[`ai-log-card--${item.run.status}`, { 'ai-log-card--selected': selectedRunIds.has(item.run.id) }]"
      >
        <div class="ai-log-card__select" @click.stop>
          <n-checkbox :checked="selectedRunIds.has(item.run.id)" @update:checked="toggleSelectRun(item.run.id)" />
        </div>
        <div class="ai-log-card__body">
          <div class="ai-log-card__head">
            <div class="ai-log-card__title">
              <div class="ai-log-card__title-row">
                <strong>{{ item.taskLabel }}</strong>
                <span class="ai-log-card__run-id">#{{ item.run.id.slice(-6) }}</span>
              </div>
              <span>{{ item.run.provider }} / {{ item.run.model }}</span>
            </div>
            <n-tag size="small" :type="statusMeta[item.run.status]?.type || 'default'" :bordered="false">
              {{ statusMeta[item.run.status]?.label || item.run.status }}
            </n-tag>
          </div>

          <div class="ai-log-card__meta">
            <span v-if="item.projectTitle">关联项目：{{ item.projectTitle }}</span>
            <span>开始：{{ item.startedAt }}</span>
            <span>耗时：{{ item.duration }}</span>
            <span>{{ item.tokenUsage }}</span>
          </div>

          <div v-if="item.chapterTitle" class="ai-log-card__chapter">
            关联章节：{{ item.chapterTitle }}
          </div>

          <div v-if="item.run.responsePreview" class="ai-log-card__preview">
            <span class="ai-log-card__section-label">响应预览</span>
            {{ item.run.responsePreview }}
          </div>

          <div v-if="item.run.error" class="ai-log-card__error">
            <span class="ai-log-card__section-label">错误信息</span>
            {{ item.run.error }}
          </div>

          <div class="ai-log-card__foot">
            <span class="ai-log-chip">工具读取：{{ item.readStats.reads }} 次 / 命中资料：{{ item.readStats.hits }} 条</span>
            <span v-if="item.run.repairTriggered" class="ai-log-chip">触发过结构化修复</span>
            <span v-if="item.finishedAt" class="ai-log-chip">结束：{{ item.finishedAt }}</span>
          </div>
        </div>
      </article>

      <button
        v-if="hasMoreAiRunLogs"
        class="ai-log-load-more"
        type="button"
        @click="loadMoreAiRunLogs"
      >
        <ChevronDown :size="15" />
        <span>加载更多（已显示 {{ visibleAiRunLogs.length }} / {{ aiRunLogs.length }}）</span>
      </button>
    </div>
  </n-modal>
</template>
</template>

<style scoped>
.titlebar-switcher {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.switcher-combined {
  position: relative;
  display: flex;
  height: 26px;
  align-items: center;
  border: 1px solid var(--arc-border);
  border-radius: 7px;
  background: color-mix(in srgb, var(--arc-bg-surface) 90%, var(--arc-bg-weak));
  overflow: hidden;
}

.switcher-combined:hover {
  border-color: var(--arc-border-strong);
}

.switcher-profile {
  width: 104px;
  flex: 0 0 auto;
}

.switcher-model {
  width: 142px;
  flex: 0 0 auto;
}

.switcher-combined :deep(.n-base-selection) {
  border: none !important;
  box-shadow: none !important;
  background: transparent !important;
}

.switcher-combined :deep(.n-base-selection:hover),
.switcher-combined :deep(.n-base-selection.n-base-selection--active) {
  box-shadow: none !important;
}

.switcher-combined :deep(.n-base-selection__input input),
.switcher-combined :deep(.n-base-selection-label) {
  font-size: 12px;
}

.switcher-sep {
  width: 1px;
  height: 16px;
  background: var(--arc-border);
  margin: 0 2px;
  flex: 0 0 auto;
}

.switcher-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.switcher-refresh:hover,
.switcher-log:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
  background: var(--arc-bg-weak);
}

.switcher-refresh:disabled,
.switcher-log:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.switcher-log {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.ai-log-modal :deep(.n-card) {
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(180deg, color-mix(in srgb, var(--arc-bg-surface) 96%, white 4%) 0%, var(--arc-bg-surface) 100%);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
}

.ai-log-modal :deep(.n-card-header) {
  display: none;
}

.ai-log-modal :deep(.n-card__content) {
  padding: 18px;
}

.ai-log-modal__summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.ai-log-modal__summary strong {
  color: var(--arc-text-primary);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.ai-log-modal__summary span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.ai-log-empty {
  padding: 28px 18px;
  border: 1px dashed color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border));
  border-radius: 14px;
  color: var(--arc-text-hint);
  text-align: center;
  background: var(--arc-bg-weak);
}

.ai-log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: min(62vh, 620px);
  overflow: auto;
  padding-right: 4px;
}

.ai-log-card {
  position: relative;
  padding: 14px 16px 16px;
  border: 1px solid var(--arc-border);
  border-radius: 14px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--arc-bg-surface) 94%, white 6%) 0%, var(--arc-bg-surface) 100%);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
}

.ai-log-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-border) 70%, transparent);
}

.ai-log-card--success::before {
  background: linear-gradient(180deg, #10b981 0%, #34d399 100%);
}

.ai-log-card--error::before {
  background: linear-gradient(180deg, #ef4444 0%, #f87171 100%);
}

.ai-log-card--running::before {
  background: linear-gradient(180deg, #3b82f6 0%, #60a5fa 100%);
}

.ai-log-card--canceled::before {
  background: linear-gradient(180deg, #f59e0b 0%, #fbbf24 100%);
}

.ai-log-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ai-log-card__title {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ai-log-card__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ai-log-card__title strong {
  color: var(--arc-text-primary);
  font-size: 15px;
  letter-spacing: -0.02em;
}

.ai-log-card__title span {
  color: var(--arc-text-hint);
  font-size: 12px;
  word-break: break-all;
}

.ai-log-card__run-id {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
  font-size: 11px;
  letter-spacing: 0.03em;
}

.ai-log-card__meta,
.ai-log-card__foot {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 10px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.ai-log-card__chapter {
  margin-top: 10px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.ai-log-card__preview {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 10%, var(--arc-border));
  border-radius: 10px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface)) 0%, var(--arc-bg-weak) 100%);
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.ai-log-card__error {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, #ef4444 24%, var(--arc-border));
  border-radius: 10px;
  background: linear-gradient(180deg, color-mix(in srgb, #ef4444 10%, var(--arc-bg-surface)) 0%, color-mix(in srgb, #ef4444 5%, var(--arc-bg-surface)) 100%);
  color: #b91c1c;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.ai-log-card__section-label {
  display: block;
  margin-bottom: 6px;
  color: var(--arc-text-hint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ai-log-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
}

.ai-log-load-more {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.ai-log-load-more:hover {
  border-color: var(--arc-border-strong);
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
}

@media (max-width: 900px) {
  .ai-log-modal {
    width: calc(100vw - 14px);
  }

  .ai-log-modal :deep(.n-card__content) {
    padding: 14px;
  }
}

@media (max-width: 640px) {
  .ai-log-modal__summary {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
}

.ai-log-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-weak);
}

.ai-log-select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--arc-text-secondary);
  font-size: 12px;
  user-select: none;
  cursor: pointer;
}

.ai-log-toolbar__spacer {
  flex: 1 1 auto;
}

.ai-log-toolbar__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ai-log-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.ai-log-tool-btn:hover:not(:disabled) {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
  background: var(--arc-bg-weak);
}

.ai-log-tool-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ai-log-export {
  position: relative;
  display: inline-flex;
}

.ai-log-export__menu {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 140px;
  padding: 4px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
}

.ai-log-export:hover .ai-log-export__menu,
.ai-log-export:focus-within .ai-log-export__menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-log-export__menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}

.ai-log-export__menu button:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}

.ai-log-card {
  display: flex;
  gap: 10px;
}

.ai-log-card__select {
  display: flex;
  align-items: flex-start;
  padding-top: 14px;
  flex: 0 0 auto;
}

.ai-log-card__body {
  flex: 1 1 auto;
  min-width: 0;
}

.ai-log-card--selected {
  border-color: color-mix(in srgb, var(--arc-primary) 55%, var(--arc-border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--arc-primary) 28%, transparent), 0 8px 20px rgba(15, 23, 42, 0.08);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
