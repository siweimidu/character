<script setup lang="ts">
import { ChevronLeft, Copy, Download, ExternalLink, Flame, Lightbulb, RefreshCw } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NCheckbox, NInput, NInputNumber, NModal, NTag, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { useGlobalAiGenerateStore } from '@/stores/globalAiGenerate'
import { toIpcPayload } from '@/utils/ipcPayload'

const appStore = useAppStore()
const globalAiGenerate = useGlobalAiGenerateStore()
const message = useMessage()

function openBookUrl(url: unknown): void {
  const target = typeof url === 'string' ? url.trim() : ''
  if (!target) {
    message.warning('该书暂无原文链接')
    return
  }
  void window.characterArc.openExternalUrl(target)
}

async function copyBookIntro(intro: unknown): Promise<void> {
  const text = typeof intro === 'string' ? intro.trim() : ''
  if (!text) {
    message.warning('该书暂无简介可复制')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    message.success('简介已复制到剪贴板')
  } catch {
    message.error('复制失败，请重试')
  }
}

function backToProjectCenter(): void {
  appStore.backToProjects()
}

// ===== 频道标签与展示顺序 =====
const BOARD_ORDER = ['female-new', 'male-new']
const CHANNEL_LABEL: Record<string, string> = { female: '女频', male: '男频', mixed: '综合' }

type BoardItem = {
  slug: string
  name: string
  channel?: string
  has_genres?: boolean
  _empty?: boolean
}

type AnyRecord = Record<string, any>

// ===== 状态 =====
const loading = ref(true)
const switching = ref(false)
const errorMsg = ref('')
const boardsList = ref<BoardItem[]>([])
const curBoard = ref<string | null>(null)
const summaryData = ref<AnyRecord | null>(null)
const allData = ref<AnyRecord | null>(null)
const curPeriod = ref('7')
const curCat = ref<string | null>(null)
const dataDate = ref('—')
const dataPrev = ref('')
const srcNote = ref('')
const boardEmptyName = ref('')
const boardEmpty = ref(false)

// ===== 工具 =====
function fmtScore(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万'
  return String(n)
}

async function fetchJson(path: string, force = false): Promise<AnyRecord> {
  const res = await window.characterArc.fetchFanqieTrends(path, force)
  if (!res.success || res.data == null) {
    throw new Error(res.error || '加载失败')
  }
  if (res.mirror) {
    srcNote.value = (res.fromCache ? '缓存 · ' : '镜像 · ') + res.mirror
  }
  return res.data as AnyRecord
}

// ===== 切换榜单 =====
async function switchBoard(slug: string, force = false): Promise<void> {
  const board = boardsList.value.find((b) => b.slug === slug)
  if (!board) return
  curBoard.value = slug
  curCat.value = null
  curPeriod.value = '7'

  if (board._empty) {
    boardEmpty.value = true
    boardEmptyName.value = board.name
    summaryData.value = null
    allData.value = null
    loading.value = false
    return
  }
  boardEmpty.value = false
  switching.value = true
  errorMsg.value = ''
  try {
    const [summary, all] = await Promise.all([
      fetchJson(`data/${slug}/market_summary.json`, force),
      fetchJson(`api/${slug}/lastest/all.json`, force)
    ])
    summaryData.value = summary
    allData.value = all
    dataDate.value = '数据日期 ' + (all.date || summary.date || '—')
    dataPrev.value = summary.prev_date ? `对比 ${summary.prev_date}` : ''
    const cats = (all.categories || []) as AnyRecord[]
    if (cats.length) curCat.value = cats[0].name
    loading.value = false
    switching.value = false
  } catch (e) {
    loading.value = false
    switching.value = false
    errorMsg.value = `加载榜单「${board.name}」失败：` + (e instanceof Error ? e.message : String(e))
  }
}

// ===== 主加载 =====
async function loadAll(force = false): Promise<void> {
  loading.value = true
  errorMsg.value = ''
  try {
    let known: BoardItem[] = []
    try {
      known = ((await fetchJson('api/boards.json', force)).boards || []) as BoardItem[]
    } catch {
      known = []
    }
    const knownMap: Record<string, BoardItem> = {}
    known.forEach((b) => { knownMap[b.slug] = b })

    const defaults: Record<string, BoardItem> = {
      'female-new': { slug: 'female-new', name: '女频新书榜', channel: 'female', has_genres: true },
      'male-new': { slug: 'male-new', name: '男频新书榜', channel: 'male', has_genres: true }
    }
    boardsList.value = BOARD_ORDER.map((slug) => {
      if (knownMap[slug]) return { ...knownMap[slug], _empty: false }
      return { ...defaults[slug], _empty: true }
    })
    known.forEach((b) => {
      if (!BOARD_ORDER.includes(b.slug)) boardsList.value.push({ ...b, _empty: false })
    })

    const firstReady = boardsList.value.find((b) => b.slug === curBoard.value && !b._empty)
      || boardsList.value.find((b) => !b._empty)
      || boardsList.value[0]
    if (firstReady) {
      await switchBoard(firstReady.slug, force)
    } else {
      loading.value = false
    }
  } catch (e) {
    loading.value = false
    errorMsg.value = e instanceof Error ? e.message : String(e)
  }
}

function selectPeriod(p: string): void {
  curPeriod.value = p
}

function selectCat(name: string): void {
  curCat.value = name
}

function channelLabel(b: BoardItem): string {
  return CHANNEL_LABEL[b.channel || ''] || b.channel || ''
}

// ===== 派生数据 =====
const curBoardItem = computed(() => boardsList.value.find((b) => b.slug === curBoard.value) || null)

const periodTabs = computed<Array<{ key: string; label: string }>>(() => {
  const periods = summaryData.value?.periods
  if (!periods) return []
  return ['7', '14', '30', 'all']
    .filter((k) => periods[k])
    .map((k) => ({ key: k, label: periods[k].period as string }))
})

const curPeriodData = computed<AnyRecord | null>(() => summaryData.value?.periods?.[curPeriod.value] ?? null)

const summaryText = computed(() => {
  const p = curPeriodData.value
  return p ? (p.summary || p.fallback_summary || '暂无速评') : ''
})
const summarySrc = computed(() => (curPeriodData.value?.source === 'ai' ? 'AI 生成' : '规则统计'))

const hotGenres = computed<AnyRecord[]>(() => curPeriodData.value?.hot_genres || [])

const hotTypes = computed<Array<AnyRecord & { _pct: number; _val: number }>>(() => {
  const types: AnyRecord[] = curPeriodData.value?.hot_types || []
  const maxScore = Math.max(...types.map((t) => Number(t.score) || 0), 1)
  return types.map((t) => ({
    ...t,
    _pct: Math.max(8, ((Number(t.score) || 0) / maxScore) * 100),
    _val: Number(t.read_growth_total ?? t.score) || 0
  }))
})

const hotThemes = computed<Array<AnyRecord & { _size: number }>>(() => {
  const themes: AnyRecord[] = curPeriodData.value?.hot_themes || []
  const maxCount = Math.max(...themes.map((t) => Number(t.count) || 0), 1)
  return themes.map((t) => ({
    ...t,
    _size: Number((((0.86 + ((Number(t.count) || 0) / maxCount) * 0.6) * 14).toFixed(1)))
  }))
})

const categories = computed<AnyRecord[]>(() => allData.value?.categories || [])

const curCatData = computed<AnyRecord | null>(() => categories.value.find((c) => c.name === curCat.value) ?? null)

const curCatTrend = computed<AnyRecord>(() => curCatData.value?.trend || {})

const curCatSummaryHtml = computed(() =>
  String(curCatTrend.value.summary || '暂无该分类速评')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
)

const curCatBooks = computed<AnyRecord[]>(() => (curCatData.value?.books || []).slice(0, 15))

function isNewBook(title: string): boolean {
  return (curCatTrend.value.new_books || []).includes(title)
}

function fmt(n: unknown): string {
  return fmtScore(Number(n) || 0)
}

onMounted(() => {
  void loadAll()
})

// ===== AI 一键生成新书选题 =====
export interface FanqieSeedCandidate {
  title: string
  concept: string
  genre: string
  hook: string
  protagonist: string
  goldFinger: string
  first3Hooks: string[]
  outline: string
}

// 每次点击“AI 生成新书选题”都会创建一个独立的后台任务（唯一 key），
// 可同时并行多次生成，全部在后台执行、互不阻塞按钮。
interface SeedBatch {
  id: string
  status: 'running' | 'done' | 'error'
  error?: string
  candidates: FanqieSeedCandidate[]
  selected: boolean[]
}
const seedModalVisible = ref(false)
const targetGenre = ref('')
const seedCount = ref(3)
const seedBatches = ref<SeedBatch[]>([])

// 正在后台运行的选题生成任务数（驱动按钮文案与运行中批次图标）
const seedRunningCount = computed(() => seedBatches.value.filter((b) => b.status === 'running').length)

// ===== 热门综合赛道多选 =====
const seedGenres = computed<AnyRecord[]>(() => curPeriodData.value?.hot_genres || [])
const selectedGenres = ref<string[]>([])
const seedGenresCollapsed = ref(false)

function toggleGenre(name: string): void {
  const idx = selectedGenres.value.indexOf(name)
  if (idx >= 0) selectedGenres.value.splice(idx, 1)
  else selectedGenres.value.push(name)
}

function isGenreSelected(name: string): boolean {
  return selectedGenres.value.includes(name)
}

function toggleAllGenres(): void {
  if (selectedGenres.value.length === seedGenres.value.length) {
    selectedGenres.value = []
  } else {
    selectedGenres.value = seedGenres.value.map((g) => String(g.name))
  }
}


function buildSeedContext(): Record<string, unknown> {
  const hotGenres = (curPeriodData.value?.hot_genres || []).slice(0, 8).map((g: AnyRecord) => ({
    name: g.name,
    lead_category: g.lead_category ?? '',
    read_growth_total: g.read_growth_total ?? g.score ?? '',
    new_count: g.new_count ?? ''
  }))
  const hotThemes = (curPeriodData.value?.hot_themes || []).slice(0, 12).map((t: AnyRecord) => t.name)
  const categoryBooks = curCatBooks.value.slice(0, 8).map((b: AnyRecord) => ({
    title: b.title,
    intro: typeof b.intro === 'string' ? b.intro.slice(0, 200) : '',
    reads: b.reads ?? ''
  }))
  // 用户勾选的综合赛道：作为生成选题时的目标赛道偏好
  const checkedGenres = selectedGenres.value
  return {
    platform: curBoardItem.value?.name || '番茄小说',
    targetGenre: targetGenre.value.trim(),
    checkedGenres: checkedGenres.join('、'),
    count: seedCount.value,
    summary: summaryText.value,
    hotGenres: JSON.stringify(hotGenres),
    hotThemes: JSON.stringify(hotThemes),
    categoryBooks: JSON.stringify(categoryBooks)
  }
}

async function handleSeedGenerate(): Promise<void> {
  // 每次点击都创建独立后台任务，不再阻塞按钮、可多次并行生成。
  const batchId = `fanqie-seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const batch: SeedBatch = { id: batchId, status: 'running', candidates: [], selected: [] }
  seedBatches.value.push(batch)
  seedModalVisible.value = false

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: batchId,
        kind: 'inspiration',
        label: 'AI 生成新书选题',
        description: '正在根据榜单风向设计新书选题方案',
        panel: 'fanqie'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'fanqie-seed',
          settings: appStore.appSettings,
          context: buildSeedContext()
        }))
    )
    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 生成新书选题失败')
    }
    const entries = Array.isArray((result.result as Record<string, unknown>)?.entries)
      ? ((result.result as Record<string, unknown>).entries as Array<Record<string, unknown>>)
      : []
    if (entries.length === 0) {
      message.warning('AI 未返回有效的选题方案')
      updateSeedBatch(batchId, { status: 'error', error: 'AI 未返回有效的选题方案' })
      return
    }
    const candidates = entries.map((e) => ({
      sourceTitle: '',
      title: String(e.title ?? '未命名选题'),
      concept: String(e.concept ?? ''),
      genre: String(e.genre ?? ''),
      hook: String(e.hook ?? ''),
      protagonist: String(e.protagonist ?? ''),
      goldFinger: String(e.goldFinger ?? ''),
      first3Hooks: Array.isArray(e.first3Hooks) ? (e.first3Hooks as string[]).map(String) : [],
      outline: String(e.outline ?? '')
    }))
    updateSeedBatch(batchId, { status: 'done', candidates, selected: candidates.map(() => true) })
    // 无论用户当前在哪个页面，都全局弹出 AI 生成的新书选题结果悬浮窗
    syncSeedsToGlobal()
  } catch (error) {
    updateSeedBatch(batchId, { status: 'error', error: error instanceof Error ? error.message : String(error) })
    message.error(error instanceof Error ? error.message : 'AI 生成新书选题失败，请检查模型配置')
  }
}

function updateSeedBatch(id: string, patch: Partial<Pick<SeedBatch, 'status' | 'error' | 'candidates' | 'selected'>>): void {
  const idx = seedBatches.value.findIndex((b) => b.id === id)
  if (idx < 0) return
  const cur = seedBatches.value[idx]
  seedBatches.value[idx] = {
    ...cur,
    ...patch,
    // 合并：新的 candidates/selected 替换，但保留已有字段
    candidates: patch.candidates ?? cur.candidates,
    selected: patch.selected ?? cur.selected
  }
}

/**
 * 把当前所有已完成批次的候选合并写入全局弹窗 store，并全局弹出结果悬浮窗。
 * 若结果弹窗已打开则刷新候选，否则打开。
 */
function syncSeedsToGlobal(): void {
  const doneCands = seedBatches.value
    .filter((b) => b.status === 'done')
    .flatMap((b) => b.candidates)
    .map((c) => ({ ...c, sourceTitle: '' }))
  const running = seedRunningCount.value
  if (globalAiGenerate.resultVisible) {
    globalAiGenerate.resetResult(doneCands, running)
  } else {
    globalAiGenerate.openResult('fanqie', doneCands, { running })
  }
}

function openSeedGenerator(): void {
  targetGenre.value = ''
  selectedGenres.value = []
  seedGenresCollapsed.value = false
  globalAiGenerate.closeResult()
  seedModalVisible.value = true
}

// 全局结果弹窗“换一批”请求：打开本页面的“AI 生成新书选题”输入配置弹窗
watch(
  () => globalAiGenerate.fanqieGeneratorRequest,
  () => {
    if (globalAiGenerate.fanqieGeneratorRequest > 0) {
      openSeedGenerator()
    }
  }
)

// ===== 导出当前榜单数据 =====
export type FanqieExportFormat = 'txt' | 'md' | 'json'

const exportModalVisible = ref(false)
const exportLoading = ref(false)
const exportBoard = ref<string>('')
const exportPeriod = ref('7')
const exportFormat = ref<FanqieExportFormat>('txt')

const EXPORT_BOARD_OPTIONS = [
  { slug: 'all', name: '全部榜单' },
  { slug: 'female-new', name: '女频新书榜' },
  { slug: 'male-new', name: '男频新书榜' },
  { slug: 'female-read', name: '女频阅读榜' },
  { slug: 'male-read', name: '男频阅读榜' }
]
/** “全部榜单”导出时实际汇总的榜单列表（不包含 all 本身） */
const EXPORT_ALL_SLUGS = ['female-new', 'male-new', 'female-read', 'male-read']
const EXPORT_PERIOD_OPTIONS = [
  { key: '7', label: '近 7 日' },
  { key: '14', label: '近 14 日' },
  { key: '30', label: '近 30 日' },
  { key: 'all', label: '全部样本' }
]
const EXPORT_FORMAT_LABEL: Record<FanqieExportFormat, string> = {
  txt: 'TXT 文本',
  md: 'Markdown 文档',
  json: 'JSON 数据'
}

function openExportDialog(): void {
  exportBoard.value = curBoard.value || EXPORT_BOARD_OPTIONS[0].slug
  exportPeriod.value = curPeriod.value
  exportFormat.value = 'txt'
  exportModalVisible.value = true
}

function fmtScoreRaw(n: unknown): string {
  const v = Number(n) || 0
  return fmtScore(v)
}

export type ExportDataBlock = {
  slug: string
  summary: AnyRecord
  all: AnyRecord
  boardName: string
  date: string
  periodLabel: string
  periodData: AnyRecord
}

async function collectSingleExportData(
  slug: string,
  period: string
): Promise<ExportDataBlock> {
  const board = EXPORT_BOARD_OPTIONS.find((b) => b.slug === slug)
  const boardName = board?.name ?? slug
  const periodLabel = EXPORT_PERIOD_OPTIONS.find((p) => p.key === period)?.label ?? period
  const [summary, all] = await Promise.all([
    fetchJson(`data/${slug}/market_summary.json`),
    fetchJson(`api/${slug}/lastest/all.json`)
  ])
  const periodData: AnyRecord = summary?.periods?.[period] ?? {}
  const date = String(all?.date || summary?.date || '')
  return { slug, summary, all, boardName, date, periodLabel, periodData }
}

async function collectExportData(slug: string, period: string): Promise<ExportDataBlock[]> {
  if (slug === 'all') {
    return Promise.all(EXPORT_ALL_SLUGS.map((s) => collectSingleExportData(s, period)))
  }
  return [await collectSingleExportData(slug, period)]
}

function buildExportTextBlock(d: ExportDataBlock): string {
  const lines: string[] = []
  const p = d.periodData
  lines.push(`【${d.boardName}】${d.periodLabel} 导出报告`)
  lines.push(`数据日期：${d.date || '—'}`)
  lines.push('')
  lines.push('一、AI 风向速评')
  lines.push(p.summary || p.fallback_summary || '暂无速评')
  lines.push('')
  const genres: AnyRecord[] = p.hot_genres || []
  if (genres.length) {
    lines.push('二、热门综合赛道（按阅读增长加权）')
    genres.forEach((g, i) => {
      const lead = g.lead_category ? ` | 领涨：${g.lead_category}` : ''
      lines.push(`${i + 1}. ${g.name}${lead}`)
      lines.push(`   在读增长：${fmtScoreRaw(g.read_growth_total ?? g.score)}`)
      const metrics: string[] = []
      if (g.new_count != null) metrics.push(`新书 +${g.new_count}`)
      if (g.dropped_count != null) metrics.push(`掉榜 −${g.dropped_count}`)
      if (g.active_days != null) metrics.push(`活跃 ${g.active_days}d`)
      if (metrics.length) lines.push(`   ${metrics.join('  ')}`)
      const cats: string[] = g.categories || []
      if (cats.length) lines.push(`   分类：${cats.join('、')}`)
      lines.push('')
    })
  }
  const types: AnyRecord[] = p.hot_types || []
  if (types.length) {
    lines.push('三、热门具体分类')
    types.forEach((t) => {
      lines.push(`  ${t.name}：+${fmtScoreRaw(t.read_growth_total ?? t.score)}`)
    })
    lines.push('')
  }
  const themes: AnyRecord[] = p.hot_themes || []
  if (themes.length) {
    lines.push('四、高频题材标签')
    themes.forEach((t) => {
      lines.push(`  ${t.name}：×${t.count}`)
    })
    lines.push('')
  }
  const cats = (d.all.categories || []) as AnyRecord[]
  if (cats.length) {
    lines.push('五、分类榜单 & 趋势')
    cats.forEach((c) => {
      const trend = c.trend || {}
      lines.push(`【${c.name}】`)
      const summaryHtml = String(trend.summary || '暂无该分类速评').replace(/<[^>]+>/g, '').replace(/\*\*/g, '')
      lines.push(summaryHtml)
      lines.push('')
      const books: AnyRecord[] = (c.books || []).slice(0, 15)
      if (books.length) {
        lines.push('排名前十书目：')
        books.forEach((b, i) => {
          const newTag = (trend.new_books || []).includes(b.title) ? ' [NEW]' : ''
          lines.push(`  ${i + 1}. ${b.title}${newTag}（${b.author || ''} · ${b.reads || ''} 在读）`)
        })
      }
      if ((trend.top_risers || []).length) {
        lines.push('排名上升：')
        ;(trend.top_risers as AnyRecord[]).forEach((x) => lines.push(`  ${x.title} ${x.change}`))
      }
      if ((trend.top_fallers || []).length) {
        lines.push('排名下降：')
        ;(trend.top_fallers as AnyRecord[]).forEach((x) => lines.push(`  ${x.title} ${x.change}`))
      }
      if ((trend.reads_growth || []).length) {
        lines.push('阅读增长：')
        ;(trend.reads_growth as AnyRecord[]).forEach((x) => lines.push(`  ${x.title} ${x.growth}`))
      }
      if ((trend.new_books || []).length) {
        lines.push('新上榜：')
        ;(trend.new_books as string[]).forEach((t) => lines.push(`  ${t}`))
      }
      lines.push('')
    })
  }
  return lines.join('\n')
}

function buildExportText(blocks: ExportDataBlock[]): string {
  return blocks
    .map((d, i) => {
      const block = buildExportTextBlock(d)
      if (i === 0) return block
      return `\n${'='.repeat(60)}\n\n${block}`
    })
    .join('\n')
}

function buildExportMarkdownBlock(d: ExportDataBlock): string {
  const out: string[] = []
  const p = d.periodData
  out.push(`# ${d.boardName} · ${d.periodLabel}导出报告`)
  out.push('')
  out.push(`> 数据日期：${d.date || '—'}`)
  out.push('')
  out.push('## AI 风向速评')
  out.push(p.summary || p.fallback_summary || '暂无速评')
  out.push('')
  const genres: AnyRecord[] = p.hot_genres || []
  if (genres.length) {
    out.push('## 热门综合赛道')
    out.push('')
    out.push('| 排名 | 赛道 | 领涨 | 在读增长 | 新书 | 掉榜 | 活跃 |')
    out.push('| --- | --- | --- | --- | --- | --- | --- |')
    genres.forEach((g, i) => {
      out.push(`| ${i + 1} | ${g.name} | ${g.lead_category || '—'} | ${fmtScoreRaw(g.read_growth_total ?? g.score)} | ${g.new_count != null ? '+' + g.new_count : '—'} | ${g.dropped_count != null ? '−' + g.dropped_count : '—'} | ${g.active_days != null ? g.active_days + 'd' : '—'} |`)
    })
    out.push('')
  }
  const types: AnyRecord[] = p.hot_types || []
  if (types.length) {
    out.push('## 热门具体分类')
    out.push('')
    out.push('| 分类 | 在读增长 |')
    out.push('| --- | --- |')
    types.forEach((t) => out.push(`| ${t.name} | +${fmtScoreRaw(t.read_growth_total ?? t.score)} |`))
    out.push('')
  }
  const themes: AnyRecord[] = p.hot_themes || []
  if (themes.length) {
    out.push('## 高频题材标签')
    out.push('')
    themes.forEach((t) => out.push(`- **${t.name}** ×${t.count}`))
    out.push('')
  }
  const cats = (d.all.categories || []) as AnyRecord[]
  if (cats.length) {
    out.push('## 分类榜单 & 趋势')
    cats.forEach((c) => {
      const trend = c.trend || {}
      out.push(`### ${c.name}`)
      out.push('')
      const summaryPlain = String(trend.summary || '暂无该分类速评').replace(/<[^>]+>/g, '')
      out.push(summaryPlain)
      out.push('')
      const books: AnyRecord[] = (c.books || []).slice(0, 15)
      if (books.length) {
        out.push('**排名靠前书目：**')
        books.forEach((b, i) => {
          const newTag = (trend.new_books || []).includes(b.title) ? ' 🆕' : ''
          out.push(`${i + 1}. ${b.title}${newTag}（${b.author || ''} · ${b.reads || ''} 在读）`)
        })
        out.push('')
      }
      if ((trend.top_risers || []).length) {
        out.push('**排名上升：**')
        ;(trend.top_risers as AnyRecord[]).forEach((x) => out.push(`- ${x.title}（${x.change}）`))
        out.push('')
      }
      if ((trend.top_fallers || []).length) {
        out.push('**排名下降：**')
        ;(trend.top_fallers as AnyRecord[]).forEach((x) => out.push(`- ${x.title}（${x.change}）`))
        out.push('')
      }
      if ((trend.reads_growth || []).length) {
        out.push('**阅读增长：**')
        ;(trend.reads_growth as AnyRecord[]).forEach((x) => out.push(`- ${x.title}（${x.growth}）`))
        out.push('')
      }
      if ((trend.new_books || []).length) {
        out.push('**新上榜：**')
        ;(trend.new_books as string[]).forEach((t) => out.push(`- ${t}`))
        out.push('')
      }
    })
  }
  return out.join('\n')
}

function buildExportMarkdown(blocks: ExportDataBlock[]): string {
  return blocks
    .map((d, i) => {
      const block = buildExportMarkdownBlock(d)
      if (i === 0) return block
      return `\n---\n\n${block}`
    })
    .join('\n')
}

function buildExportJsonBlock(d: ExportDataBlock): AnyRecord {
  return {
    board: {
      slug: d.slug,
      name: d.boardName
    },
    period: exportPeriod.value,
    period_label: d.periodLabel,
    date: d.date,
    summary: d.periodData.summary || d.periodData.fallback_summary || '',
    summary_source: d.periodData.source || '',
    hot_genres: d.periodData.hot_genres || [],
    hot_types: d.periodData.hot_types || [],
    hot_themes: d.periodData.hot_themes || [],
    categories: (d.all.categories || []).map((c: AnyRecord) => ({
      name: c.name,
      trend: c.trend || {},
      books: (c.books || []).slice(0, 15)
    }))
  }
}

function buildExportJson(blocks: ExportDataBlock[]): unknown {
  if (blocks.length === 1) return buildExportJsonBlock(blocks[0])
  return {
    all_boards: blocks.map((d) => buildExportJsonBlock(d))
  }
}

function buildExportContent(format: FanqieExportFormat, blocks: ExportDataBlock[]): string | unknown {
  if (format === 'json') return buildExportJson(blocks)
  if (format === 'md') return buildExportMarkdown(blocks)
  return buildExportText(blocks)
}

function sanitizeFileName(name: string): string {
  return String(name).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-')
}

async function handleExport(): Promise<void> {
  if (exportLoading.value) return
  const slug = exportBoard.value
  const boardName = EXPORT_BOARD_OPTIONS.find((b) => b.slug === slug)?.name || slug
  const format = exportFormat.value
  exportLoading.value = true
  try {
    const blocks = await collectExportData(slug, exportPeriod.value)
    const content = buildExportContent(format, blocks)
    const datePart = (blocks[0]?.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '')
    const defaultPath = `${datePart}-${sanitizeFileName(boardName)}.${format === 'json' ? 'json' : format === 'md' ? 'md' : 'txt'}`
    const res = await window.characterArc.exportFanqieTrends({
      data: content,
      title: `导出「${boardName}」数据`,
      defaultPath,
      format
    })
    exportLoading.value = false
    if (res.success) {
      message.success('数据已导出')
      exportModalVisible.value = false
    } else if (res.canceled) {
      // 用户取消，无需提示
    } else {
      message.error(res.error || '导出失败')
    }
  } catch (e) {
    exportLoading.value = false
    message.error(e instanceof Error ? e.message : '导出失败，请重试')
  }
}
</script>

<template>
  <section class="fanqie-page arc-scrollbar">
    <div class="fanqie-shell">
      <div class="topbar">
        <div class="topbar-lead">
          <n-button quaternary size="small" class="back-btn" @click="backToProjectCenter">
            <template #icon><ChevronLeft :size="16" /></template>
            返回项目中心
          </n-button>
          <h1><span class="flame"><Flame :size="24" /></span> 番茄风向标</h1>
          <p class="sub">番茄小说榜单 · 每日趋势与题材风向</p>
          <p class="sub">数据来源于https://github.com/uu201/FanqieRankTracker</p>
        </div>
        <div class="meta">
          <div class="date num">{{ dataDate }}</div>
          <div v-if="dataPrev" class="prev">{{ dataPrev }}</div>
          <button class="export-btn" :disabled="loading || exportLoading" @click="openExportDialog">
            <Download :size="13" /> 导出当前数据
          </button>
          <button class="seed-btn" :disabled="loading" @click="openSeedGenerator">
            <Lightbulb :size="13" /> {{ seedRunningCount > 0 ? `AI 生成新书选题（${seedRunningCount} 个后台运行中）` : 'AI 生成新书选题' }}
          </button>
          <button class="refresh-btn" :disabled="loading" @click="loadAll(true)">
            <RefreshCw :size="13" /> 刷新
          </button>
          <div v-if="srcNote" class="src-note">{{ srcNote }}</div>
        </div>
      </div>

      <div v-if="loading" class="state">
        <div class="spinner" aria-hidden="true"></div>
        正在加载榜单数据…
      </div>

      <div v-else-if="errorMsg" class="state">
        <div>数据加载失败</div>
        <div class="err-detail">{{ errorMsg }}</div>
        <button class="refresh-btn" style="margin-top:16px" @click="loadAll(true)">重试</button>
      </div>

      <div v-else class="content" :class="{ switching }">
        <div class="board-tabs">
          <button
            v-for="b in boardsList"
            :key="b.slug"
            class="board-tab"
            :class="{ active: b.slug === curBoard, empty: b._empty }"
            :title="b._empty ? '该榜单暂无数据' : ''"
            @click="switchBoard(b.slug)"
          >
            {{ b.name }}<span class="ch">{{ channelLabel(b) }}</span>
          </button>
        </div>

        <div v-if="boardEmpty" class="state">
          <div>「{{ boardEmptyName }}」榜单暂无数据</div>
          <div class="src-note" style="margin-top:10px;max-width:460px;line-height:1.7">
            该榜单需在 fork 仓库里配置榜单 ID 并跑过一次抓取后才有数据。
          </div>
        </div>

        <template v-else>
          <div class="period-tabs">
            <button
              v-for="p in periodTabs"
              :key="p.key"
              class="period-tab"
              :class="{ active: p.key === curPeriod }"
              @click="selectPeriod(p.key)"
            >{{ p.label }}</button>
          </div>

          <div class="summary-card">
            <div class="label">AI 风向速评 <span class="badge-src">{{ summarySrc }}</span></div>
            <p class="text">{{ summaryText }}</p>
          </div>

          <div v-if="curBoardItem?.has_genres && hotGenres.length" class="section">
            <h3 class="section-title">热门综合赛道 <span class="hint">按阅读增长加权</span></h3>
            <div class="grid">
              <div v-for="(g, i) in hotGenres" :key="g.name" class="genre-card" :class="['rank-' + (i + 1), { top1: i === 0 }]">
                <div class="rank-badge num">#{{ i + 1 }}</div>
                <div class="genre-head">
                  <div class="name">{{ g.name }}</div>
                  <div v-if="g.lead_category" class="lead">
                    <span class="lead-label">领涨</span>
                    <span class="lead-val">{{ g.lead_category }}</span>
                  </div>
                </div>
                <div class="score-row">
                  <span class="score-arrow" aria-hidden="true">▲</span>
                  <span class="score num">{{ fmt(g.read_growth_total ?? g.score) }}</span>
                  <span class="score-unit">在读增长</span>
                </div>
                <div v-if="g.new_count != null || g.dropped_count != null || g.active_days != null" class="metrics">
                  <span v-if="g.new_count != null" class="metric metric-up">
                    <span class="m-val num">+{{ g.new_count }}</span>
                    <span class="m-label">新书</span>
                  </span>
                  <span v-if="g.dropped_count != null" class="metric metric-down">
                    <span class="m-val num">−{{ g.dropped_count }}</span>
                    <span class="m-label">掉榜</span>
                  </span>
                  <span v-if="g.active_days != null" class="metric metric-mute">
                    <span class="m-val num">{{ g.active_days }}d</span>
                    <span class="m-label">活跃</span>
                  </span>
                </div>
                <div v-if="(g.categories || []).length" class="cats">
                  <span
                    v-for="c in (g.categories || [])"
                    :key="c"
                    class="chip"
                    :class="{ 'chip-lead': c === g.lead_category }"
                  >{{ c }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="hotTypes.length" class="section">
            <h3 class="section-title">热门具体分类</h3>
            <div class="type-list">
              <div v-for="t in hotTypes" :key="t.name" class="type-row">
                <div class="t-label">{{ t.name }}</div>
                <div class="t-bar-wrap"><div class="t-bar" :style="{ width: t._pct + '%' }"></div></div>
                <div class="t-val num">+{{ fmt(t._val) }}</div>
              </div>
            </div>
          </div>

          <div v-if="hotThemes.length" class="section">
            <h3 class="section-title">高频题材标签</h3>
            <div class="themes">
              <span v-for="t in hotThemes" :key="t.name" class="theme-tag" :style="{ fontSize: t._size + 'px' }">
                <span class="t-name">{{ t.name }}</span><span class="t-count num">×{{ t.count }}</span>
              </span>
            </div>
          </div>

          <div v-if="categories.length" class="section">
            <h3 class="section-title">分类榜单 &amp; 趋势</h3>
            <div class="cat-selector">
              <button
                v-for="c in categories"
                :key="c.name"
                class="cat-btn"
                :class="{ active: c.name === curCat }"
                @click="selectCat(c.name)"
              >{{ c.name }}</button>
            </div>
            <div class="cat-summary" v-html="curCatSummaryHtml"></div>
            <div class="cat-detail">
              <div class="book-list">
                <div v-for="(b, i) in curCatBooks" :key="b.title + i" class="book-card">
                  <div class="bk-rank num">{{ i + 1 }}</div>
                  <img v-if="b.cover" loading="lazy" :src="b.cover" :alt="`${b.title} 封面`" @error="(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')" />
                  <div class="bk-info">
                    <div class="bk-title">{{ b.title }} <span v-if="isNewBook(b.title)" class="tag-new">NEW</span></div>
                    <div class="bk-meta">{{ b.author }} · <span class="bk-reads num">{{ b.reads }} 在读</span></div>
                    <div class="bk-intro">{{ b.intro }}</div>
                    <div class="bk-actions">
                      <button
                        type="button"
                        class="bk-action-btn"
                        :disabled="!b.url"
                        :title="b.url ? '在浏览器中打开原文' : '该书暂无原文链接'"
                        @click="openBookUrl(b.url)"
                      >
                        <ExternalLink :size="12" /> 访问原文
                      </button>
                      <button
                        type="button"
                        class="bk-action-btn"
                        :disabled="!b.intro"
                        title="复制简介到剪贴板"
                        @click="copyBookIntro(b.intro)"
                      >
                        <Copy :size="12" /> 复制简介
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="trend-side">
                <div v-if="(curCatTrend.top_risers || []).length" class="trend-box">
                  <h4>排名上升 <span class="badge-src num">{{ curCatTrend.top_risers.length }}</span></h4>
                  <div v-for="x in curCatTrend.top_risers" :key="x.title" class="trend-item">
                    <span class="ti-title">{{ x.title }}</span><span class="up num">{{ x.change }}</span>
                  </div>
                </div>
                <div v-if="(curCatTrend.top_fallers || []).length" class="trend-box">
                  <h4>排名下降</h4>
                  <div v-for="x in curCatTrend.top_fallers" :key="x.title" class="trend-item">
                    <span class="ti-title">{{ x.title }}</span><span class="down num">{{ x.change }}</span>
                  </div>
                </div>
                <div v-if="(curCatTrend.reads_growth || []).length" class="trend-box">
                  <h4>阅读增长</h4>
                  <div v-for="x in curCatTrend.reads_growth" :key="x.title" class="trend-item">
                    <span class="ti-title">{{ x.title }}</span><span class="growth num">{{ x.growth }}</span>
                  </div>
                </div>
                <div v-if="(curCatTrend.new_books || []).length" class="trend-box">
                  <h4>新上榜 <span class="badge-src num">{{ curCatTrend.new_books.length }}</span></h4>
                  <div v-for="t in curCatTrend.new_books" :key="t" class="trend-item">
                    <span class="ti-title">{{ t }}</span><span class="tag-new">NEW</span>
                  </div>
                </div>
                <div v-if="(curCatTrend.dropped_books || []).length" class="trend-box">
                  <h4>掉出榜单 <span class="badge-src num">{{ curCatTrend.dropped_books.length }}</span></h4>
                  <div v-for="(x, i) in curCatTrend.dropped_books" :key="i" class="trend-item">
                    <span class="ti-title">{{ typeof x === 'string' ? x : x.title }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- AI 生成新书选题：目标偏好输入 -->
    <n-modal
      v-model:show="seedModalVisible"
      preset="card"
      title="AI 生成新书选题"
      style="width: 520px"
      :mask-closable="false"
    >
      <p class="seed-modal-hint">
        将基于当前榜单的热门赛道、题材标签和标杆书目，生成 1~10 个可落地的新书选题（含书名、主角、金手指与前 3 章钩子）。可选填目标赛道偏好。
      </p>
      <div class="seed-count-row">
        <span class="seed-count-label">生成数量</span>
        <n-input-number
          v-model:value="seedCount"
          :min="1"
          :max="10"
          :step="1"
          size="small"
          class="seed-count-input"
        />
        <span class="seed-count-range">1 ~ 10</span>
      </div>

      <!-- 热门综合赛道多选：可上下滑动、可折叠收起 -->
      <div v-if="seedGenres.length" class="seed-genres-panel">
        <div class="seed-genres-head" @click="seedGenresCollapsed = !seedGenresCollapsed">
          <span class="seed-genres-title">勾选热门综合赛道</span>
          <span class="seed-genres-hint">勾选哪个赛道就围绕该赛道生成选题（可多选）</span>
          <span class="seed-genres-toggle">{{ seedGenresCollapsed ? '展开' : '收起' }}</span>
        </div>
        <div v-if="!seedGenresCollapsed" class="seed-genres-body">
          <div class="seed-genres-toolbar">
            <n-checkbox :checked="selectedGenres.length === seedGenres.length" @update:checked="toggleAllGenres" class="seed-check-all">
              全选
            </n-checkbox>
            <span class="seed-selected-count">已选 {{ selectedGenres.length }} / {{ seedGenres.length }}</span>
          </div>
          <div class="seed-genres-scroll">
            <label
              v-for="g in seedGenres"
              :key="g.name"
              class="seed-genre-item"
              :class="{ 'seed-genre-item-checked': isGenreSelected(g.name) }"
            >
              <n-checkbox :checked="isGenreSelected(g.name)" @update:checked="toggleGenre(g.name)" />
              <span class="seed-genre-name">{{ g.name }}</span>
              <span v-if="g.lead_category" class="seed-genre-lead">领涨 {{ g.lead_category }}</span>
              <span class="seed-genre-val num">+{{ fmt(g.read_growth_total ?? g.score) }}</span>
            </label>
          </div>
        </div>
      </div>

      <n-input
        v-model:value="targetGenre"
        type="textarea"
        :rows="3"
        placeholder="如：男频玄幻 / 女频古言 / 都市直播文…（可留空）"
      />
      <div class="seed-modal-footer">
        <n-button @click="seedModalVisible = false">取消</n-button>
        <n-button type="primary" @click="handleSeedGenerate">
          开始生成{{ seedRunningCount > 0 ? `（后台已运行 ${seedRunningCount} 个）` : '' }}
        </n-button>
      </div>
    </n-modal>

    <!-- 导出当前榜单数据 -->
    <n-modal
      v-model:show="exportModalVisible"
      preset="card"
      title="导出榜单数据"
      style="width: 560px"
      :mask-closable="false"
    >
      <p class="export-hint">
        选择要导出的榜单、时间范围与文件格式，文件名将自动以数据日期 + 榜单名命名。
      </p>

      <div class="export-group">
        <div class="export-label">选择榜单</div>
        <div class="export-options export-options-grid">
          <button
            v-for="b in EXPORT_BOARD_OPTIONS"
            :key="b.slug"
            class="export-option"
            :class="{ active: exportBoard === b.slug }"
            @click="exportBoard = b.slug"
          >{{ b.name }}</button>
        </div>
      </div>

      <div class="export-group">
        <div class="export-label">选择时间范围</div>
        <div class="export-options">
          <button
            v-for="p in EXPORT_PERIOD_OPTIONS"
            :key="p.key"
            class="export-option"
            :class="{ active: exportPeriod === p.key }"
            @click="exportPeriod = p.key"
          >{{ p.label }}</button>
        </div>
      </div>

      <div class="export-group">
        <div class="export-label">选择导出格式</div>
        <div class="export-options">
          <button
            v-for="(label, key) in EXPORT_FORMAT_LABEL"
            :key="key"
            class="export-option export-format"
            :class="{ active: exportFormat === key }"
            @click="exportFormat = key as FanqieExportFormat"
          >{{ label }}</button>
        </div>
      </div>

      <div class="seed-modal-footer">
        <n-button @click="exportModalVisible = false">取消</n-button>
        <n-button type="primary" :loading="exportLoading" :disabled="exportLoading" @click="handleExport">
          <template #icon><Download :size="14" /></template>
          开始导出
        </n-button>
      </div>
    </n-modal>
  </section>
</template>

<style scoped>
.fanqie-page {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 100%;
  overflow-y: auto;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
}
.fanqie-shell {
  width: min(100%, 1180px);
  margin: 0 auto;
  padding: calc(var(--arc-titlebar-height) + 24px) clamp(16px, 2.6vw, 28px) 64px;
}
.num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }

.topbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 20px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--arc-border);
}
.topbar-lead { min-width: 0; }
.back-btn { margin-bottom: 8px; }
.topbar h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 760;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 10px;
}
.topbar h1 .flame { display: inline-flex; color: var(--arc-primary); }
.topbar .sub { margin: 6px 0 0; color: var(--arc-text-hint); font-size: 13px; }
.meta { text-align: right; font-size: 12px; color: var(--arc-text-hint); flex-shrink: 0; }
.meta .date { color: var(--arc-text-secondary); font-weight: 600; font-size: 13px; }
.refresh-btn {
  margin-top: 8px;
  border: 1px solid var(--arc-border-strong);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-radius: var(--arc-radius-md);
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.18s, color 0.18s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.refresh-btn:hover:not(:disabled) { border-color: var(--arc-primary); color: var(--arc-primary); }
.refresh-btn:disabled { opacity: 0.5; cursor: default; }
.src-note { font-size: 11px; color: var(--arc-text-hint); margin-top: 6px; }

.board-tabs { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.board-tab {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 9px 20px;
  border-radius: var(--arc-radius-md);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s;
  display: flex;
  align-items: center;
  gap: 8px;
}
.board-tab:hover { border-color: var(--arc-border-strong); color: var(--arc-text-primary); }
.board-tab.active { background: var(--arc-primary); border-color: var(--arc-primary); color: #fff; box-shadow: var(--arc-shadow-sm); }
.board-tab.empty { opacity: 0.5; }
.board-tab .ch {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-hint);
  font-weight: 600;
}
.board-tab.active .ch { background: rgba(255,255,255,0.22); color: #fff; }

.period-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  margin-bottom: 22px;
}
.period-tab {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  padding: 7px 18px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s;
}
.period-tab:hover { color: var(--arc-text-primary); }
.period-tab.active { background: var(--arc-primary); color: #fff; box-shadow: var(--arc-shadow-sm); }
.summary-card {
  background: linear-gradient(135deg, color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface)) 0%, var(--arc-bg-surface) 70%);
  border: 1px solid color-mix(in srgb, var(--arc-primary) 25%, var(--arc-border));
  border-left: 3px solid var(--arc-primary);
  border-radius: var(--arc-radius-lg);
  padding: 16px 20px;
  margin-bottom: 24px;
  box-shadow: 0 2px 12px -4px color-mix(in srgb, var(--arc-primary) 15%, transparent);
}
.summary-card .label {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--arc-primary);
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.summary-card .text { font-size: 14.5px; color: var(--arc-text-primary); margin: 0; }
.badge-src {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--arc-border-strong);
  color: var(--arc-text-hint);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.section { margin-bottom: 30px; }
.section-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-primary);
  padding-left: 10px;
  border-left: 3px solid var(--arc-primary);
}
.section-title .hint { font-size: 12px; color: var(--arc-text-hint); font-weight: 400; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 14px; }
.genre-card {
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  padding: 16px 16px 14px;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.genre-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: transparent;
  transition: background 0.18s ease;
}
.genre-card:hover {
  border-color: var(--arc-border-strong);
  transform: translateY(-2px);
  box-shadow: var(--arc-shadow-md, 0 6px 18px -10px rgba(0,0,0,0.25));
}
.genre-card.top1 {
  background: linear-gradient(155deg, color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface)) 0%, var(--arc-bg-surface) 55%);
  border-color: color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  box-shadow: 0 4px 20px -6px color-mix(in srgb, var(--arc-primary) 30%, transparent);
}
.genre-card.top1::before { background: linear-gradient(90deg, var(--arc-primary), #ff9466 70%, transparent); }
.genre-card.rank-2::before { background: linear-gradient(90deg, color-mix(in srgb, var(--arc-primary) 55%, transparent), transparent); }
.genre-card.rank-3::before { background: linear-gradient(90deg, color-mix(in srgb, var(--arc-primary) 30%, transparent), transparent); }

.genre-card .rank-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  min-width: 30px;
  height: 22px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--arc-text-hint);
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  line-height: 1;
}
.genre-card.rank-1 .rank-badge { color: #92510a; background: linear-gradient(135deg, #fde68a, #fbbf24); border-color: #f59e0b; }
.genre-card.rank-2 .rank-badge { color: #475569; background: linear-gradient(135deg, #f1f5f9, #cbd5e1); border-color: #94a3b8; }
.genre-card.rank-3 .rank-badge { color: #7c2d12; background: linear-gradient(135deg, #fed7aa, #fb923c); border-color: #ea580c; }

.genre-card .genre-head { padding-right: 44px; }
.genre-card .name {
  font-size: 17px;
  font-weight: 760;
  letter-spacing: -0.01em;
  color: var(--arc-text-primary);
  margin-bottom: 6px;
  line-height: 1.25;
}
.genre-card .lead {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--arc-text-secondary);
}
.genre-card .lead-label {
  font-size: 10.5px;
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 700;
}
.genre-card .lead-val { font-weight: 600; color: var(--arc-text-primary); }

.genre-card .score-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
}
.genre-card .score-arrow {
  font-size: 11px;
  color: var(--arc-success, #15803d);
  transform: translateY(-1px);
}
.genre-card .score {
  font-size: 26px;
  font-weight: 800;
  color: var(--arc-success, #15803d);
  letter-spacing: -0.025em;
  line-height: 1;
}
.genre-card .score-unit { font-size: 11.5px; color: var(--arc-text-hint); font-weight: 500; }

.genre-card .metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.genre-card .metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
}
.genre-card .metric .m-val { font-weight: 700; letter-spacing: -0.01em; }
.genre-card .metric .m-label { color: var(--arc-text-hint); }
.genre-card .metric-up .m-val { color: var(--arc-success, #15803d); }
.genre-card .metric-down .m-val { color: var(--arc-danger, #dc2626); }
.genre-card .metric-mute .m-val { color: var(--arc-text-secondary); }

.genre-card .cats {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px dashed var(--arc-border);
}
.chip {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  color: var(--arc-text-secondary);
  transition: border-color 0.16s, color 0.16s;
}
.chip.chip-lead {
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 45%, var(--arc-border));
  color: var(--arc-primary);
  font-weight: 600;
}

.themes { display: flex; flex-wrap: wrap; gap: 9px; }
.theme-tag {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  transition: all 0.18s;
}
.theme-tag:hover { border-color: var(--arc-primary); background: var(--arc-primary-soft); }
.theme-tag .t-name { font-weight: 600; }
.theme-tag .t-count { font-size: 11px; color: var(--arc-text-hint); }

.type-list { display: flex; flex-direction: column; gap: 9px; }
.type-row { display: grid; grid-template-columns: 90px 1fr 80px; align-items: center; gap: 12px; }
.type-row .t-label { font-size: 13px; font-weight: 600; text-align: right; }
.type-row .t-bar-wrap { height: 22px; background: var(--arc-bg-weak); border-radius: 6px; overflow: hidden; }
.type-row .t-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--arc-primary), #ff9466);
  border-radius: 6px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.type-row .t-val { font-size: 12px; color: var(--arc-text-secondary); }

.cat-selector { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 18px; }
.cat-btn {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 5px 13px;
  border-radius: 999px;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.16s;
}
.cat-btn:hover { border-color: var(--arc-border-strong); color: var(--arc-text-primary); }
.cat-btn.active { background: var(--arc-primary-soft); border-color: var(--arc-primary); color: var(--arc-primary); font-weight: 600; }

.cat-detail { display: grid; grid-template-columns: 1fr 320px; gap: 20px; }
@media (max-width: 880px) { .cat-detail { grid-template-columns: 1fr; } }

.book-list { display: flex; flex-direction: column; gap: 10px; }
.book-card {
  display: flex;
  gap: 12px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 12px;
  transition: all 0.16s;
}
.book-card:hover { border-color: var(--arc-border-strong); }
.book-card .bk-rank { flex-shrink: 0; width: 26px; font-size: 17px; font-weight: 800; color: var(--arc-text-hint); text-align: center; }
.book-card:nth-child(-n+3) .bk-rank { color: var(--arc-primary); }
.book-card img { width: 60px; height: 80px; object-fit: cover; border-radius: 6px; flex-shrink: 0; background: var(--arc-bg-weak); box-shadow: 0 2px 8px -2px rgba(0,0,0,0.18); }
.book-card .bk-info { min-width: 0; flex: 1; }
.book-card .bk-title { font-size: 14px; font-weight: 700; margin-bottom: 2px; display: flex; align-items: center; gap: 7px; }
.book-card .bk-meta { font-size: 12px; color: var(--arc-text-hint); margin-bottom: 5px; }
.book-card .bk-reads { color: var(--arc-success, #15803d); font-weight: 600; }
.book-card .bk-intro {
  font-size: 12px;
  color: var(--arc-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.book-card .bk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.bk-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--arc-text-secondary);
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 0.16s, color 0.16s, background 0.16s;
}
.bk-action-btn:hover:not(:disabled) {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.bk-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.trend-side { display: flex; flex-direction: column; gap: 14px; }
.trend-box { background: var(--arc-bg-surface); border: 1px solid var(--arc-border); border-radius: var(--arc-radius-md); padding: 14px; border-left: 3px solid var(--arc-border); }
.trend-box:nth-child(1) { border-left-color: var(--arc-success, #15803d); }
.trend-box:nth-child(2) { border-left-color: var(--arc-danger, #dc2626); }
.trend-box:nth-child(3) { border-left-color: var(--arc-warning, #a16207); }
.trend-box:nth-child(4) { border-left-color: var(--arc-primary); }
.trend-box:nth-child(5) { border-left-color: var(--arc-border-strong); }
.trend-box h4 { margin: 0 0 10px; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
.trend-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--arc-border);
}
.trend-item:last-child { border-bottom: none; }
.trend-item .ti-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--arc-text-secondary); }
.trend-item .up { color: var(--arc-success, #15803d); font-weight: 700; flex-shrink: 0; }
.trend-item .down { color: var(--arc-danger, #dc2626); font-weight: 700; flex-shrink: 0; }
.trend-item .growth { color: var(--arc-warning, #a16207); font-weight: 700; flex-shrink: 0; }
.tag-new { font-size: 10px; padding: 0 6px; border-radius: 4px; background: var(--arc-success, #15803d); color: #fff; font-weight: 700; }

.cat-summary {
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--arc-text-secondary);
  margin-bottom: 18px;
}
.cat-summary :deep(strong) { color: var(--arc-text-primary); }

.content { transition: opacity 0.18s; }
.content.switching { opacity: 0.45; pointer-events: none; }

.state { text-align: center; padding: 80px 20px; color: var(--arc-text-hint); }
.state .spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--arc-border);
  border-top-color: var(--arc-primary);
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: fanqie-spin 0.8s linear infinite;
}
@keyframes fanqie-spin { to { transform: rotate(360deg); } }
.state .err-detail { font-size: 12px; margin-top: 10px; color: var(--arc-danger, #dc2626); }

.export-btn {
  margin-top: 8px;
  margin-right: 6px;
  border: 1px solid var(--arc-border-strong);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-radius: var(--arc-radius-md);
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.18s, color 0.18s, opacity 0.18s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.export-btn:hover:not(:disabled) { border-color: var(--arc-primary); color: var(--arc-primary); }
.export-btn:disabled { opacity: 0.5; cursor: default; }

.seed-btn {
  margin-top: 8px;
  margin-right: 6px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border-strong));
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  border-radius: var(--arc-radius-md);
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.18s, opacity 0.18s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.seed-btn:hover:not(:disabled) { border-color: var(--arc-primary); }
.seed-btn:disabled { opacity: 0.5; cursor: default; }

.seed-modal-hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-hint);
}
.seed-count-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.seed-count-label { font-size: 13px; color: var(--arc-text-secondary); font-weight: 600; }
.seed-count-input { width: 90px; }
.seed-count-range { font-size: 12px; color: var(--arc-text-hint); }
.seed-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.seed-options-modal { width: min(760px, 92vw); }
.export-hint {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-hint);
}
.export-group { margin-bottom: 16px; }
.export-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-secondary);
  margin-bottom: 8px;
}
.export-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.export-options-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.export-option {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 7px 12px;
  border-radius: var(--arc-radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s;
  text-align: center;
}
.export-option:hover { border-color: var(--arc-border-strong); color: var(--arc-text-primary); }
.export-option.active {
  background: var(--arc-primary-soft);
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  font-weight: 700;
}
.export-format { flex: 1; min-width: 120px; }
.seed-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 62vh;
  overflow-y: auto;
}
.seed-card {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 14px;
  background: var(--arc-bg-body);
}
.seed-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.seed-rank {
  font-weight: 700;
  color: var(--arc-primary);
  font-size: 14px;
}
.seed-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--arc-text-primary);
}
.seed-genre { margin-left: auto; }
.seed-row {
  font-size: 13px;
  line-height: 1.65;
  color: var(--arc-text-secondary);
  margin-top: 4px;
}
.seed-k {
  display: inline-block;
  min-width: 64px;
  font-weight: 600;
  color: var(--arc-text-primary);
}
.seed-hooks { display: flex; flex-direction: column; gap: 2px; }
.seed-hook { color: var(--arc-text-secondary); }
.seed-actions { margin-top: 10px; text-align: right; }
.seed-action-btn {
  border: 1px solid var(--arc-border-strong);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-radius: var(--arc-radius-sm);
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: color 0.18s, border-color 0.18s;
}
.seed-action-btn:hover { border-color: var(--arc-primary); color: var(--arc-primary); }
.seed-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.seed-check-all { font-size: 13px; }
.seed-selected-count { font-size: 12px; color: var(--arc-text-hint); }
.seed-batch-running {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  border: 1px dashed var(--arc-border-strong);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 13px;
}
.seed-batch-running .spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 2px solid var(--arc-border-strong);
  border-top-color: var(--arc-primary);
  border-radius: 50%;
  animation: arc-spin 0.8s linear infinite;
}
.seed-batch-error {
  padding: 14px;
  border: 1px solid color-mix(in srgb, #e5484d 45%, var(--arc-border));
  border-radius: var(--arc-radius-md);
  background: color-mix(in srgb, #e5484d 6%, var(--arc-bg-surface));
  color: var(--arc-text-secondary);
  font-size: 13px;
}
@keyframes arc-spin { to { transform: rotate(360deg); } }
.seed-card-checked {
  border-color: var(--arc-primary);
  box-shadow: 0 0 0 1px var(--arc-primary);
}
.seed-check { margin-right: 2px; }

/* 热门综合赛道多选 */
.seed-genres-panel {
  margin-bottom: 12px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  overflow: hidden;
}
.seed-genres-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  cursor: pointer;
  background: var(--arc-bg-weak);
  user-select: none;
}
.seed-genres-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
}
.seed-genres-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--arc-text-hint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seed-genres-toggle {
  font-size: 12px;
  color: var(--arc-primary);
  font-weight: 600;
  flex-shrink: 0;
}
.seed-genres-body {
  border-top: 1px solid var(--arc-border);
  padding: 8px 10px 10px;
}
.seed-genres-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.seed-genres-scroll {
  max-height: 168px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.seed-genre-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-sm);
  background: var(--arc-bg-body);
  cursor: pointer;
  transition: border-color 0.16s, background 0.16s;
}
.seed-genre-item:hover { border-color: var(--arc-border-strong); }
.seed-genre-item-checked {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.seed-genre-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
}
.seed-genre-lead {
  font-size: 11px;
  color: var(--arc-text-hint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.seed-genre-val {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  color: var(--arc-success, #15803d);
  flex-shrink: 0;
}

/* 生成作品：初始化方式弹窗 */
.init-modal-hint {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-hint);
}
.init-length-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.init-length-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-secondary);
  flex-shrink: 0;
}
.init-length-options {
  display: inline-flex;
  gap: 6px;
}
.init-length-btn {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  padding: 6px 18px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s;
}
.init-length-btn:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
}
.init-length-btn.active {
  background: var(--arc-primary-soft);
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  font-weight: 700;
}
.init-mode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.init-mode-card {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
  border-radius: var(--arc-radius-md);
  padding: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s, background 0.16s, box-shadow 0.16s;
}
.init-mode-card:hover { border-color: var(--arc-border-strong); }
.init-mode-card.active {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
  box-shadow: inset 2px 0 0 var(--arc-primary);
}
.init-mode-card strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--arc-text-primary);
}
.init-mode-card span {
  font-size: 12px;
  line-height: 1.5;
  color: var(--arc-text-secondary);
}
</style>

