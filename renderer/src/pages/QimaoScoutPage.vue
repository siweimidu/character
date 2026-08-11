<script setup lang="ts">
import { ChevronLeft, Copy, Flame, Lightbulb } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { NButton, NInput, NModal, NTag, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const appStore = useAppStore()
const message = useMessage()

function backToProjectCenter(): void {
  appStore.backToProjects()
}

// ===== 七猫扫榜：手动粘贴书单 =====
export interface QimaoBook {
  rank: string
  title: string
  author: string
  genre: string
  reads: string
  intro: string
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

const rawText = ref('')
const parsedBooks = ref<QimaoBook[]>([])
const SEED_TASK_KEY = 'fanqie-seed'
const seedLoading = computed(() => appStore.isAiTaskRunning(SEED_TASK_KEY))
const seedModalVisible = ref(false)
const seedOptionsVisible = ref(false)
const targetGenre = ref('')
const seedCandidates = ref<FanqieSeedCandidate[]>([])

/** 把用户粘贴的文本解析成书单条目。支持"排名 书名 作者 题材 在读 简介"或"书名|作者|题材|简介"等松散格式 */
function parseBooks(): void {
  const lines = rawText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const books: QimaoBook[] = []
  for (const line of lines) {
    // 尝试用 | 或制表符分隔
    const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : null
    let parts: string[] = []
    if (sep) {
      parts = line.split(sep).map((s) => s.trim())
    } else {
      // 尝试从行首提取"数字+"排名
      const rankMatch = line.match(/^(\d+)[.、\s]+/)
      const rest = rankMatch ? line.slice(rankMatch[0].length) : line
      parts = [rankMatch?.[1] ?? '', rest]
    }
    const [rank, title = '', author = '', genre = '', reads = '', intro = ''] = parts
    if (!title) continue
    books.push({
      rank: rank || String(books.length + 1),
      title,
      author,
      genre,
      reads,
      intro: typeof intro === 'string' ? intro.slice(0, 200) : ''
    })
  }
  parsedBooks.value = books
  message.success(`已解析 ${books.length} 本书`)
}

function buildSeedContext(): Record<string, unknown> {
  const hotGenres: Record<string, string>[] = []
  const countByGenre: Record<string, number> = {}
  parsedBooks.value.forEach((b) => {
    if (!b.genre) return
    countByGenre[b.genre] = (countByGenre[b.genre] || 0) + 1
  })
  Object.entries(countByGenre).forEach(([name, count]) => {
    hotGenres.push({ name, read_growth_total: String(count) })
  })
  return {
    platform: '七猫',
    targetGenre: targetGenre.value.trim(),
    summary: '七猫新书榜手动扫榜数据',
    hotGenres: JSON.stringify(hotGenres),
    hotThemes: '[]',
    categoryBooks: JSON.stringify(parsedBooks.value.slice(0, 15).map((b) => ({
      title: b.title,
      author: b.author,
      reads: b.reads,
      intro: b.intro
    })))
  }
}

async function handleSeedGenerate(): Promise<void> {
  if (seedLoading.value) return
  if (parsedBooks.value.length === 0) {
    message.warning('请先粘贴七猫新书榜书单')
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
          <p class="sub">参考：https://github.com/Yunshiro/yunn-skills 的 qimao-novel-scraper 工作流</p>
        </div>
      </div>

      <div class="notice">
        七猫官网带反爬校验，应用内无法直接抓取。请手动粘贴七猫新书榜书单（可从浏览器复制榜单），应用会自动解析并交给 AI 生成新书选题。推荐一行一本：<code>排名 书名 作者 题材 在读 简介</code>，或用 <code>|</code> / <code>Tab</code> 分隔。
      </div>

      <div class="paste-section">
        <div class="section-title">粘贴七猫新书榜书单</div>
        <n-input
          v-model:value="rawText"
          type="textarea"
          :rows="12"
          placeholder="例如：&#10;1 开局就被老婆绿了 张三 都市 12.3万 被绿后觉醒神豪系统&#10;2 我的系统能无限强化 李四 玄幻 9.8万 绑定系统后横扫诸天&#10;3 女帝的贴身高手 王五 都市 8.1万 重生女帝回归都市"
        />
        <div class="paste-actions">
          <n-button type="primary" secondary @click="parseBooks">解析书单</n-button>
          <n-button type="primary" :loading="seedLoading" :disabled="seedLoading || parsedBooks.length === 0" @click="openSeedGenerator">
            <template #icon><Lightbulb :size="14" /></template>
            AI 生成新书选题
          </n-button>
        </div>
      </div>

      <div v-if="parsedBooks.length" class="book-section">
        <div class="section-title">已解析书单（{{ parsedBooks.length }} 本）</div>
        <div class="book-list">
          <div v-for="(b, i) in parsedBooks" :key="i" class="book-card">
            <span class="bk-rank num">{{ b.rank }}</span>
            <div class="bk-info">
              <div class="bk-title">{{ b.title }}</div>
              <div class="bk-meta">{{ b.author }}<span v-if="b.genre" class="bk-genre"> · {{ b.genre }}</span><span v-if="b.reads" class="bk-reads num"> · {{ b.reads }} 在读</span></div>
              <div v-if="b.intro" class="bk-intro">{{ b.intro }}</div>
            </div>
          </div>
        </div>
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
  padding-bottom: 20px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--arc-border);
}
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
.paste-section { margin-bottom: 20px; }
.paste-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

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
