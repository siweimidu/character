<script setup lang="ts">
import { ChevronLeft, Copy, ExternalLink, Flame, Lightbulb, RefreshCw } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { NButton, NInput, NModal, NTag, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const appStore = useAppStore()
const message = useMessage()

function backToProjectCenter(): void {
  appStore.backToProjects()
}

// ===== 七猫扫榜：自动抓取 =====
export interface QimaoBook {
  rank: string
  title: string
  author: string
  genre: string
  reads: string
  intro: string
  url: string
}

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

// ===== 榜单配置（对齐参考 skill：qimao-novel-scraper） =====
const SEX_OPTIONS = [
  { value: 'boy', label: '男频' },
  { value: 'girl', label: '女频' }
]
const TYPE_OPTIONS = [
  { value: 'new', label: '新书榜' },
  { value: 'hot', label: '热销榜' },
  { value: 'finish', label: '完结榜' }
]

const SEED_TASK_KEY = 'fanqie-seed'
const seedLoading = computed(() => appStore.isAiTaskRunning(SEED_TASK_KEY))
const seedModalVisible = ref(false)
const seedOptionsVisible = ref(false)
const targetGenre = ref('')
const seedCandidates = ref<FanqieSeedCandidate[]>([])

const books = ref<QimaoBook[]>([])
const loading = ref(false)
const loadingLabel = ref('')
const errorMsg = ref('')
const scrapedAt = ref('')
const srcBoard = ref('')
const curSex = ref('boy')
const curType = ref('new')

async function scrapeBoard(sex: string, type: string): Promise<void> {
  if (loading.value) return
  loading.value = true
  errorMsg.value = ''
  loadingLabel.value = `正在抓取七猫${SEX_OPTIONS.find((s) => s.value === sex)?.label ?? sex}${TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type}…`
  try {
    const res = await window.characterArc.fetchQimaoRank({ sex, type, period: 'date' })
    if (!res.success) {
      throw new Error(res.error || '抓取失败')
    }
    books.value = res.books.map((b) => ({
      rank: String(b.rank),
      title: b.title,
      author: b.author,
      genre: [b.genre, b.subGenre].filter(Boolean).join('/'),
      reads: b.heat || b.words || '',
      intro: b.intro,
      url: b.url
    }))
    srcBoard.value = `${res.channelLabel}${res.boardLabel}`
    scrapedAt.value = res.scrapedAt
    if (books.value.length === 0) {
      message.warning('当前榜单没有解析到数据，请换个榜单或稍后再试')
    } else {
      message.success(`已自动抓取 ${books.value.length} 本书（${srcBoard.value}）`)
    }
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '七猫榜单抓取失败'
  } finally {
    loading.value = false
    loadingLabel.value = ''
  }
}

function switchSex(sex: string): void {
  curSex.value = sex
  void scrapeBoard(sex, curType.value)
}
function switchType(type: string): void {
  curType.value = type
  void scrapeBoard(curSex.value, type)
}
async function refresh(): Promise<void> {
  await scrapeBoard(curSex.value, curType.value)
}

async function openBook(url: string): Promise<void> {
  if (!url) {
    message.warning('该书暂无原文链接')
    return
  }
  void window.characterArc.openExternalUrl(url)
}
async function copyIntro(intro: string): Promise<void> {
  if (!intro) {
    message.warning('该书暂无简介可复制')
    return
  }
  try {
    await navigator.clipboard.writeText(intro)
    message.success('简介已复制')
  } catch {
    message.error('复制失败')
  }
}

// ===== AI 生成新书选题 =====
function buildSeedContext(): Record<string, unknown> {
  const hotGenres: Record<string, string>[] = []
  const countByGenre: Record<string, number> = {}
  books.value.forEach((b) => {
    if (!b.genre) return
    countByGenre[b.genre] = (countByGenre[b.genre] || 0) + 1
  })
  Object.entries(countByGenre).forEach(([name, count]) => {
    hotGenres.push({ name, read_growth_total: String(count) })
  })
  return {
    platform: `七猫${srcBoard.value}`,
    targetGenre: targetGenre.value.trim(),
    summary: `七猫${srcBoard.value}自动扫榜数据`,
    hotGenres: JSON.stringify(hotGenres),
    hotThemes: '[]',
    categoryBooks: JSON.stringify(books.value.slice(0, 15).map((b) => ({
      title: b.title,
      author: b.author,
      reads: b.reads,
      intro: b.intro
    })))
  }
}

async function handleSeedGenerate(): Promise<void> {
  if (seedLoading.value) return
  if (books.value.length === 0) {
    message.warning('请先抓取七猫榜单')
    return
  }
  seedModalVisible.value = false
  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: SEED_TASK_KEY,
        kind: 'inspiration',
        label: 'AI 生成新书选题',
        description: '正在根据七猫扫榜数据设计新书选题方案',
        panel: 'qimao'
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
      return
    }
    seedCandidates.value = entries.map((e) => ({
      title: String(e.title ?? '未命名选题'),
      concept: String(e.concept ?? ''),
      genre: String(e.genre ?? ''),
      hook: String(e.hook ?? ''),
      protagonist: String(e.protagonist ?? ''),
      goldFinger: String(e.goldFinger ?? ''),
      first3Hooks: Array.isArray(e.first3Hooks) ? (e.first3Hooks as string[]).map(String) : [],
      outline: String(e.outline ?? '')
    }))
    seedOptionsVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成新书选题失败，请检查模型配置')
  }
}

function openSeedGenerator(): void {
  targetGenre.value = ''
  seedOptionsVisible.value = false
  seedModalVisible.value = true
}

function formatSeedCandidate(seed: FanqieSeedCandidate): string {
  return `【书名】${seed.title}\n【核心卖点】${seed.concept}\n【题材】${seed.genre}\n【钩子】${seed.hook}\n【主角】${seed.protagonist}\n【金手指】${seed.goldFinger}\n【前3章钩子】\n${seed.first3Hooks.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}\n【主线】${seed.outline}`
}

async function copySeed(seed: FanqieSeedCandidate): Promise<void> {
  try {
    await navigator.clipboard.writeText(formatSeedCandidate(seed))
    message.success('选题方案已复制')
  } catch {
    message.error('复制失败')
  }
}

onMounted(() => {
  void scrapeBoard(curSex.value, curType.value)
})
</script>

<template>
  <section class="qimao-page arc-scrollbar">
    <div class="qimao-shell">
      <div class="topbar">
        <div class="topbar-lead">
          <n-button quaternary size="small" class="back-btn" @click="backToProjectCenter">
            <template #icon><ChevronLeft :size="16" /></template>
            返回项目中心
          </n-button>
          <h1><span class="flame"><Flame :size="24" /></span> 七猫扫榜</h1>
          <p class="sub">七猫新书扫榜 → 挑标杆 → 生成新书选题</p>
          <p class="sub">自动抓取，参考 https://github.com/Yunshiro/yunn-skills 的 qimao-novel-scraper 工作流</p>
        </div>
        <div class="meta">
          <div v-if="scrapedAt" class="date num">抓取时间 {{ scrapedAt.replace('T', ' ').slice(0, 19) }}</div>
          <div v-if="srcBoard" class="src-board">{{ srcBoard }}</div>
          <button class="seed-btn" :disabled="loading || seedLoading" @click="openSeedGenerator">
            <Lightbulb :size="13" /> {{ seedLoading ? '生成中…' : 'AI 生成新书选题' }}
          </button>
          <button class="refresh-btn" :disabled="loading" @click="refresh">
            <RefreshCw :size="13" /> {{ loading ? '抓取中…' : '刷新' }}
          </button>
        </div>
      </div>

      <div class="board-picker">
        <div class="picker-group">
          <span class="picker-label">频道</span>
          <button
            v-for="s in SEX_OPTIONS"
            :key="s.value"
            class="board-tab"
            :class="{ active: curSex === s.value }"
            @click="switchSex(s.value)"
          >{{ s.label }}</button>
        </div>
        <div class="picker-group">
          <span class="picker-label">榜单</span>
          <button
            v-for="t in TYPE_OPTIONS"
            :key="t.value"
            class="board-tab"
            :class="{ active: curType === t.value }"
            @click="switchType(t.value)"
          >{{ t.label }}</button>
        </div>
      </div>

      <div class="notice">
        应用内置真实浏览器自动抓取七猫官网榜单（自动通过反爬校验），无需手动粘贴。进入页面即自动抓取当前榜单，也可在上方切换频道/榜单或点击「刷新」重新抓取。
      </div>

      <div v-if="loading" class="state">
        <div class="spinner" aria-hidden="true"></div>
        {{ loadingLabel || '正在抓取…' }}
      </div>

      <div v-else-if="errorMsg" class="state">
        <div>抓取失败</div>
        <div class="err-detail">{{ errorMsg }}</div>
        <button class="refresh-btn" style="margin-top:16px" @click="refresh">重试</button>
      </div>

      <template v-else>
        <div v-if="books.length === 0" class="state">
          <div>当前榜单暂无数据</div>
          <button class="refresh-btn" style="margin-top:16px" @click="refresh">重新抓取</button>
        </div>

        <div v-else class="book-section">
          <div class="section-title">已抓取书单（{{ books.length }} 本）</div>
          <div class="book-list">
            <div v-for="(b, i) in books" :key="i" class="book-card">
              <span class="bk-rank num">{{ b.rank }}</span>
              <div class="bk-info">
                <div class="bk-title">{{ b.title }}</div>
                <div class="bk-meta">{{ b.author }}<span v-if="b.genre" class="bk-genre"> · {{ b.genre }}</span><span v-if="b.reads" class="bk-reads num"> · {{ b.reads }}</span></div>
                <div v-if="b.intro" class="bk-intro">{{ b.intro }}</div>
                <div class="bk-actions">
                  <button type="button" class="bk-action-btn" :disabled="!b.url" :title="b.url ? '在浏览器中打开原文' : '该书暂无原文链接'" @click="openBook(b.url)">
                    <ExternalLink :size="12" /> 访问原文
                  </button>
                  <button type="button" class="bk-action-btn" :disabled="!b.intro" title="复制简介到剪贴板" @click="copyIntro(b.intro)">
                    <Copy :size="12" /> 复制简介
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
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
        将基于解析出的七猫书单，生成 2~3 个可落地的新书选题（含书名、主角、金手指与前 3 章钩子）。可选填目标赛道偏好。
      </p>
      <n-input
        v-model:value="targetGenre"
        type="textarea"
        :rows="3"
        placeholder="如：男频玄幻 / 女频古言 / 都市直播文…（可留空）"
      />
      <div class="seed-modal-footer">
        <n-button @click="seedModalVisible = false">取消</n-button>
        <n-button type="primary" :loading="seedLoading" :disabled="seedLoading" @click="handleSeedGenerate">
          开始生成
        </n-button>
      </div>
    </n-modal>

    <!-- AI 生成新书选题：候选展示 -->
    <n-modal
      v-model:show="seedOptionsVisible"
      preset="card"
      title="AI 生成的新书选题"
      class="seed-options-modal"
      :mask-closable="false"
    >
      <div class="seed-list">
        <div v-for="(seed, index) in seedCandidates" :key="index" class="seed-card">
          <div class="seed-card-head">
            <span class="seed-rank num">#{{ index + 1 }}</span>
            <span class="seed-title">{{ seed.title }}</span>
            <n-tag v-if="seed.genre" size="small" :bordered="false" class="seed-genre">{{ seed.genre }}</n-tag>
          </div>
          <div class="seed-row"><span class="seed-k">核心卖点</span>{{ seed.concept }}</div>
          <div class="seed-row"><span class="seed-k">钩子</span>{{ seed.hook }}</div>
          <div class="seed-row"><span class="seed-k">主角</span>{{ seed.protagonist }}</div>
          <div class="seed-row"><span class="seed-k">金手指</span>{{ seed.goldFinger }}</div>
          <div v-if="seed.first3Hooks.length" class="seed-row">
            <span class="seed-k">前3章钩子</span>
            <div class="seed-hooks">
              <div v-for="(h, i) in seed.first3Hooks" :key="i" class="seed-hook">{{ i + 1 }}. {{ h }}</div>
            </div>
          </div>
          <div class="seed-row"><span class="seed-k">主线</span>{{ seed.outline }}</div>
          <div class="seed-actions">
            <button type="button" class="seed-action-btn" @click="copySeed(seed)"><Copy :size="12" /> 复制方案</button>
          </div>
        </div>
      </div>
      <div class="seed-modal-footer">
        <n-button @click="seedOptionsVisible = false">关闭</n-button>
        <n-button type="primary" @click="openSeedGenerator">换一批</n-button>
      </div>
    </n-modal>
  </section>
</template>

<style scoped>
.qimao-page {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 100%;
  overflow-y: auto;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
}
.qimao-shell {
  width: min(100%, 900px);
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
  margin-bottom: 20px;
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
.meta .src-board { color: var(--arc-primary); font-weight: 700; font-size: 12px; margin-top: 2px; }

.board-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin-bottom: 16px;
}
.picker-group { display: flex; align-items: center; gap: 6px; }
.picker-label { font-size: 12px; font-weight: 600; color: var(--arc-text-hint); margin-right: 2px; }
.board-tab {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 7px 16px;
  border-radius: var(--arc-radius-md);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.18s;
}
.board-tab:hover { border-color: var(--arc-border-strong); color: var(--arc-text-primary); }
.board-tab.active { background: var(--arc-primary); border-color: var(--arc-primary); color: #fff; }

.notice {
  font-size: 13px;
  line-height: 1.7;
  color: var(--arc-text-secondary);
  background: var(--arc-primary-soft);
  border: 1px solid color-mix(in srgb, var(--arc-primary) 24%, var(--arc-border));
  border-radius: var(--arc-radius-md);
  padding: 12px 14px;
  margin-bottom: 20px;
}
.notice code {
  background: var(--arc-bg-surface);
  padding: 1px 5px;
  border-radius: var(--arc-radius-sm);
  font-size: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--arc-text-primary);
  margin-bottom: 10px;
}

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

.book-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.book-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
}
.bk-rank {
  font-weight: 700;
  color: var(--arc-primary);
  min-width: 24px;
}
.bk-info { flex: 1; min-width: 0; }
.bk-title { font-size: 14px; font-weight: 650; color: var(--arc-text-primary); }
.bk-meta { font-size: 12px; color: var(--arc-text-hint); margin-top: 2px; }
.bk-genre { color: var(--arc-text-secondary); }
.bk-reads { color: var(--arc-primary); }
.bk-intro {
  font-size: 13px;
  color: var(--arc-text-secondary);
  margin-top: 4px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bk-actions {
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
.bk-action-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.state { text-align: center; padding: 80px 20px; color: var(--arc-text-hint); }
.state .spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--arc-border);
  border-top-color: var(--arc-primary);
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: qimao-spin 0.8s linear infinite;
}
@keyframes qimao-spin { to { transform: rotate(360deg); } }
.state .err-detail { font-size: 12px; margin-top: 10px; color: var(--arc-danger, #dc2626); }

.seed-modal-hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-hint);
}
.seed-modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.seed-options-modal { width: min(760px, 92vw); }
.seed-list { display: flex; flex-direction: column; gap: 14px; max-height: 62vh; overflow-y: auto; }
.seed-card {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 14px;
  background: var(--arc-bg-body);
}
.seed-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.seed-rank { font-weight: 700; color: var(--arc-primary); font-size: 14px; }
.seed-title { font-size: 16px; font-weight: 700; color: var(--arc-text-primary); }
.seed-genre { margin-left: auto; }
.seed-row { font-size: 13px; line-height: 1.65; color: var(--arc-text-secondary); margin-top: 4px; }
.seed-k { display: inline-block; min-width: 64px; font-weight: 600; color: var(--arc-text-primary); }
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
</style>
