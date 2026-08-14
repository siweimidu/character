<script setup lang="ts">
/**
 * 全局 AI 生成结果弹窗组件。
 *
 * 挂在 App 根布局，订阅全局 globalAiGenerate store。
 * 番茄风向标 / 拆书知识库的后台 AI 任务完成后，无论用户当前在哪个页面，
 * 都能在这里全局弹出"AI 生成结果"悬浮窗；点击"生成作品/生成选中作品"
 * 后继续全局弹出"选择初始化方式"悬浮窗。
 */
import { computed } from 'vue'
import { Copy } from 'lucide-vue-next'
import { NButton, NCheckbox, NModal, NScrollbar, NTag, useMessage } from 'naive-ui'
import { useGlobalAiGenerateStore, type GlobalAiCandidate } from '@/stores/globalAiGenerate'

const store = useGlobalAiGenerateStore()
const message = useMessage()

const isFanqie = computed(() => store.activeSource === 'fanqie')

/** 切换单个候选的勾选状态。 */
function toggleOne(index: number): void {
  const current = store.selectedIndexes
  store.selectedIndexes = current.includes(index)
    ? current.filter((i) => i !== index)
    : [...current, index]
}

/** 结果弹窗标题与副标题，随来源切换。 */
const resultTitle = computed(() =>
  isFanqie.value ? 'AI 生成的新书选题' : 'AI 生成的新作品方案'
)
const resultSubtitle = computed(() =>
  isFanqie.value ? '勾选要生成作品的新书选题，将自动创建为新项目' : '勾选要创建为项目的作品，将自动建为新项目'
)

function toggleAll(): void {
  const total = store.candidates.length
  store.selectedIndexes = store.selectedCount === total
    ? []
    : store.candidates.map((_, i) => i)
}

function formatCandidate(c: GlobalAiCandidate): string {
  const head = isFanqie.value
    ? `【书名】${c.title}\n【核心卖点】${c.concept}`
    : `【书名】${c.title}\n【来源】${c.sourceTitle || '多书融合'}\n【核心卖点】${c.concept}`
  return `${head}\n【题材】${c.genre}\n【钩子】${c.hook}\n【主角】${c.protagonist}\n【金手指】${c.goldFinger}\n【前3章钩子】\n${c.first3Hooks.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}\n【主线】${c.outline}`
}

async function copyCandidate(c: GlobalAiCandidate): Promise<void> {
  try {
    await navigator.clipboard.writeText(formatCandidate(c))
    message.success(isFanqie.value ? '选题方案已复制' : '作品方案已复制')
  } catch {
    message.error('复制失败')
  }
}

/** 点击"生成作品 / 生成选中作品"：把勾选的候选送入初始化方式弹窗。 */
function handleCreateWorks(): void {
  const picked = store.candidates.filter((_, i) => store.selectedIndexes.includes(i))
  if (picked.length === 0) {
    message.warning(isFanqie.value ? '请先勾选要生成的新书选题' : '请先勾选要创建的新作品')
    return
  }
  store.openInit(picked)
}

/** 点击"开始构建"：后台批量创建项目。 */
function handleBuild(): void {
  void store.confirmInitAndBuild()
}
</script>

<template>
  <!-- AI 生成结果展示（全局） -->
  <n-modal
    v-model:show="store.resultVisible"
    :title="resultTitle"
    :preset="isFanqie ? 'card' : undefined"
    :class="isFanqie ? 'global-ai-seed-options-modal' : ''"
    :mask-closable="false"
  >
    <template v-if="!isFanqie">
      <n-card style="width: min(860px, 92vw)" :bordered="false" role="dialog" aria-modal="true">
        <template #header>
          <div class="global-ai-detail-header">
            <strong>{{ resultTitle }}</strong>
            <span>{{ resultSubtitle }}</span>
          </div>
        </template>

        <n-scrollbar style="max-height: 52vh">
          <div class="global-ai-knowledge-list">
            <div
              v-for="(candidate, index) in store.candidates"
              :key="index"
              class="global-ai-knowledge-card"
              :class="{ checked: store.selectedIndexes.includes(index) }"
              @click="toggleOne(index)"
            >
              <n-checkbox
                :checked="store.selectedIndexes.includes(index)"
                class="global-ai-knowledge-check"
                @update:checked="toggleOne(index)"
                @click.stop
              />
              <div class="global-ai-knowledge-body">
                <div class="global-ai-knowledge-head">
                  <strong>{{ candidate.title }}</strong>
                  <n-tag v-if="candidate.genre" size="tiny" :bordered="false" type="info">{{ candidate.genre || '未分类' }}</n-tag>
                  <n-tag v-if="candidate.sourceTitle" size="tiny" :bordered="false" type="warning">
                    源自《{{ candidate.sourceTitle }}》
                  </n-tag>
                </div>
                <p class="global-ai-line concept">{{ candidate.concept }}</p>
                <p class="global-ai-line"><b>钩子：</b>{{ candidate.hook }}</p>
                <p class="global-ai-line"><b>主角：</b>{{ candidate.protagonist }}</p>
                <p class="global-ai-line"><b>金手指：</b>{{ candidate.goldFinger }}</p>
                <div v-if="candidate.first3Hooks.length" class="global-ai-hooks">
                  <span v-for="(hook, hi) in candidate.first3Hooks" :key="hi" class="global-ai-hook">
                    第{{ hi + 1 }}章：{{ hook }}
                  </span>
                </div>
                <p class="global-ai-line"><b>主线：</b>{{ candidate.outline }}</p>
                <div class="global-ai-actions">
                  <n-button text size="tiny" @click.stop="copyCandidate(candidate)">复制方案</n-button>
                </div>
              </div>
            </div>
          </div>
        </n-scrollbar>

        <template #footer>
          <div class="global-ai-footer">
            <n-button @click="store.closeResult()">关闭</n-button>
            <n-button type="primary" :disabled="!store.hasSelected" @click="handleCreateWorks">
              生成选中作品（{{ store.selectedCount }}）
            </n-button>
          </div>
        </template>
      </n-card>
    </template>

    <template v-else>
      <!-- 番茄选题结果：候选展示 -->
      <div class="global-ai-seed-toolbar">
        <n-checkbox
          :checked="store.selectedCount === store.candidates.length && store.candidates.length > 0"
          @update:checked="toggleAll"
          class="global-ai-check-all"
        >
          全选
        </n-checkbox>
        <span class="global-ai-seed-count">
          已选 {{ store.selectedCount }} / {{ store.candidates.length }}{{ store.runningCount > 0 ? `（${store.runningCount} 个后台生成中）` : '' }}
        </span>
      </div>
      <div class="global-ai-seed-list">
        <div v-if="store.runningCount > 0" class="global-ai-batch-running">
          <span class="spinner" aria-hidden="true"></span> 正在后台生成新书选题…
        </div>
        <div
          v-for="(seed, index) in store.candidates"
          :key="index"
          class="global-ai-seed-card"
          :class="{ checked: store.selectedIndexes.includes(index) }"
          @click="toggleOne(index)"
        >
          <div class="global-ai-seed-card-head">
            <n-checkbox
              :checked="store.selectedIndexes.includes(index)"
              class="global-ai-seed-check"
              @update:checked="toggleOne(index)"
              @click.stop
            />
            <span class="global-ai-seed-rank num">#{{ index + 1 }}</span>
            <span class="global-ai-seed-title">{{ seed.title }}</span>
            <n-tag v-if="seed.genre" size="small" :bordered="false" class="global-ai-seed-genre">{{ seed.genre }}</n-tag>
          </div>
          <div class="global-ai-seed-row"><span class="global-ai-seed-k">核心卖点</span>{{ seed.concept }}</div>
          <div class="global-ai-seed-row"><span class="global-ai-seed-k">钩子</span>{{ seed.hook }}</div>
          <div class="global-ai-seed-row"><span class="global-ai-seed-k">主角</span>{{ seed.protagonist }}</div>
          <div class="global-ai-seed-row"><span class="global-ai-seed-k">金手指</span>{{ seed.goldFinger }}</div>
          <div v-if="seed.first3Hooks.length" class="global-ai-seed-row">
            <span class="global-ai-seed-k">前3章钩子</span>
            <div class="global-ai-seed-hooks">
              <div v-for="(h, i) in seed.first3Hooks" :key="i" class="global-ai-seed-hook">{{ i + 1 }}. {{ h }}</div>
            </div>
          </div>
          <div class="global-ai-seed-row"><span class="global-ai-seed-k">主线</span>{{ seed.outline }}</div>
          <div class="global-ai-seed-actions">
            <button type="button" class="global-ai-seed-action-btn" @click.stop="copyCandidate(seed)"><Copy :size="12" /> 复制方案</button>
          </div>
        </div>
      </div>
      <div class="global-ai-seed-modal-footer">
        <n-button @click="store.closeResult()">关闭</n-button>
        <n-button @click="store.requestOpenFanqieGenerator()">换一批</n-button>
        <n-button type="primary" @click="handleCreateWorks">生成作品</n-button>
      </div>
    </template>
  </n-modal>

  <!-- 选择初始化方式（全局） -->
  <n-modal
    v-model:show="store.initVisible"
    preset="card"
    title="选择初始化方式"
    style="width: 540px"
    :mask-closable="false"
  >
    <p class="global-ai-init-hint">
      将为勾选的 {{ store.pendingSeeds.length }} 个{{ isFanqie ? '新书选题' : '新作品' }}创建项目。选择篇幅与初始化方式后，点击“开始构建”，系统会在后台自动为所有勾选的{{ isFanqie ? '选题' : '作品' }}创建项目，无需跳转“新建作品”向导。后台构建任务可并行多次进行{{ store.buildRunningCount > 0 ? `（当前后台已有 ${store.buildRunningCount} 个构建进行中）` : '' }}。
    </p>
    <!-- 篇幅选择：长篇 / 短篇 -->
    <div class="global-ai-init-length-row">
      <span class="global-ai-init-length-label">作品篇幅</span>
      <div class="global-ai-init-length-options">
        <button
          type="button"
          class="global-ai-init-length-btn"
          :class="{ active: store.initLength === 'long' }"
          @click="store.initLength = 'long'"
        >
          长篇
        </button>
        <button
          type="button"
          class="global-ai-init-length-btn"
          :class="{ active: store.initLength === 'short' }"
          @click="store.initLength = 'short'"
        >
          短篇
        </button>
      </div>
    </div>
    <!-- 初始化方式：深度生成 / 快速生成 / 空白项目 -->
    <div class="global-ai-init-mode-list">
      <button
        type="button"
        class="global-ai-init-mode-card"
        :class="{ active: store.initMethod === 'deep' }"
        @click="store.initMethod = 'deep'"
      >
        <strong>深度生成</strong>
        <span>螺旋式推导：从角色核心矛盾出发，生成完整角色、章节大纲和世界设定。通常耗时 1 到 3 分钟。</span>
      </button>
      <button
        type="button"
        class="global-ai-init-mode-card"
        :class="{ active: store.initMethod === 'quick' }"
        @click="store.initMethod = 'quick'"
      >
        <strong>快速生成</strong>
        <span>一次性生成世界观和大纲骨架，不含角色设计。速度快，约 10 秒。</span>
      </button>
      <button
        type="button"
        class="global-ai-init-mode-card"
        :class="{ active: store.initMethod === 'off' }"
        @click="store.initMethod = 'off'"
      >
        <strong>空白项目</strong>
        <span>只创建项目骨架与首章草稿，从零开始搭建。</span>
      </button>
    </div>
    <div class="global-ai-init-footer">
      <n-button @click="store.closeInit()" :disabled="store.buildLoading">取消</n-button>
      <n-button type="primary" :loading="store.buildLoading" :disabled="store.buildLoading" @click="handleBuild">
        {{ store.initMethod === 'off' ? '开始创建项目' : store.initMethod === 'deep' ? '开始深度构建' : '开始快速构建' }}{{ store.buildRunningCount > 0 ? `（${store.buildRunningCount} 个构建中）` : '' }}
      </n-button>
    </div>
  </n-modal>
</template>

<style scoped>
.global-ai-detail-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.global-ai-detail-header strong { font-size: 15px; }
.global-ai-detail-header span { font-size: 12px; color: var(--arc-text-hint); }
.global-ai-knowledge-list { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }
.global-ai-knowledge-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-weak);
  cursor: pointer;
  transition: border-color 0.16s, box-shadow 0.16s;
}
.global-ai-knowledge-card.checked { border-color: var(--arc-primary); box-shadow: 0 0 0 1px var(--arc-primary); }
.global-ai-knowledge-check { margin-top: 2px; }
.global-ai-knowledge-body { flex: 1; min-width: 0; }
.global-ai-knowledge-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.global-ai-knowledge-head strong { color: var(--arc-text-primary); font-size: 15px; }
.global-ai-line { margin: 2px 0 0; color: var(--arc-text-secondary); font-size: 13px; line-height: 1.6; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.global-ai-line.concept { color: var(--arc-primary); font-weight: 600; }
.global-ai-hooks { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
.global-ai-hook { color: var(--arc-text-secondary); font-size: 12px; }
.global-ai-actions { display: flex; justify-content: flex-end; margin-top: 4px; }
.global-ai-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }

/* 番茄选题结果 */
.global-ai-seed-options-modal { width: min(760px, 92vw); }
.global-ai-seed-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.global-ai-check-all { font-size: 13px; }
.global-ai-seed-count { font-size: 12px; color: var(--arc-text-hint); }
.global-ai-seed-list { display: flex; flex-direction: column; gap: 14px; max-height: 62vh; overflow-y: auto; }
.global-ai-seed-card {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 14px;
  background: var(--arc-bg-body);
  cursor: pointer;
  transition: border-color 0.16s, box-shadow 0.16s;
}
.global-ai-seed-card.checked { border-color: var(--arc-primary); box-shadow: 0 0 0 1px var(--arc-primary); }
.global-ai-seed-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.global-ai-seed-rank { font-weight: 700; color: var(--arc-primary); font-size: 14px; }
.global-ai-seed-title { font-size: 16px; font-weight: 700; color: var(--arc-text-primary); }
.global-ai-seed-genre { margin-left: auto; }
.global-ai-seed-row { font-size: 13px; line-height: 1.65; color: var(--arc-text-secondary); margin-top: 4px; }
.global-ai-seed-k { display: inline-block; min-width: 64px; font-weight: 600; color: var(--arc-text-primary); }
.global-ai-seed-hooks { display: flex; flex-direction: column; gap: 2px; }
.global-ai-seed-hook { color: var(--arc-text-secondary); }
.global-ai-seed-actions { margin-top: 10px; text-align: right; }
.global-ai-seed-action-btn {
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
.global-ai-seed-action-btn:hover { border-color: var(--arc-primary); color: var(--arc-primary); }
.global-ai-batch-running {
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
.global-ai-batch-running .spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 2px solid var(--arc-border-strong);
  border-top-color: var(--arc-primary);
  border-radius: 50%;
  animation: arc-spin 0.8s linear infinite;
}
@keyframes arc-spin { to { transform: rotate(360deg); } }
.global-ai-seed-modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

/* 初始化方式 */
.global-ai-init-hint { margin: 0 0 14px; font-size: 13px; line-height: 1.6; color: var(--arc-text-hint); }
.global-ai-init-length-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.global-ai-init-length-label { font-size: 13px; font-weight: 600; color: var(--arc-text-secondary); flex-shrink: 0; }
.global-ai-init-length-options { display: inline-flex; gap: 6px; }
.global-ai-init-length-btn {
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
.global-ai-init-length-btn:hover { border-color: var(--arc-border-strong); color: var(--arc-text-primary); }
.global-ai-init-length-btn.active { background: var(--arc-primary-soft); border-color: var(--arc-primary); color: var(--arc-primary); font-weight: 700; }
.global-ai-init-mode-list { display: flex; flex-direction: column; gap: 8px; }
.global-ai-init-mode-card {
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
.global-ai-init-mode-card:hover { border-color: var(--arc-border-strong); }
.global-ai-init-mode-card.active { border-color: var(--arc-primary); background: var(--arc-primary-soft); box-shadow: inset 2px 0 0 var(--arc-primary); }
.global-ai-init-mode-card strong { font-size: 14px; font-weight: 700; color: var(--arc-text-primary); }
.global-ai-init-mode-card span { font-size: 12px; line-height: 1.5; color: var(--arc-text-secondary); }
.global-ai-init-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
