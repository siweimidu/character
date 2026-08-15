<script setup lang="ts">
/**
 * AgentPluginMarket · dsh-plugin 插件市场
 *
 * 从 GitHub `dsh-plugin` 话题（https://github.com/topics/dsh-plugin）浏览并
 * 导入插件。每一个插件都作为一个可独立启停的能力模块注入全局智能体，
 * 呼应 DeepSeek Harness「everything is a plugin」的设计理念。
 */
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { ExternalLink, Package, Puzzle, Search, Star, Trash2 } from 'lucide-vue-next'
import type { DshPluginListing, InstalledPlugin } from '@shared/agent-modules'

const message = useMessage()

const plugins = ref<DshPluginListing[]>([])
const installed = ref<InstalledPlugin[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const page = ref(1)
const importing = ref<Set<string>>(new Set())
const query = ref('')
const offline = ref(false)

const PER_PAGE = 30

const installedById = new Map<string, string>()

function refreshInstalled(): void {
  const map = new Map<string, string>()
  for (const p of installed.value) {
    map.set(p.repo.toLowerCase(), p.id)
  }
  installedById.clear()
  for (const [repo, id] of map) {
    installedById.set(repo, id)
  }
}

function isInstalled(repo: string): boolean {
  return installedById.has(repo.toLowerCase())
}

async function loadInstalled(): Promise<void> {
  try {
    installed.value = await window.characterArc.agentModules.pluginListInstalled()
    refreshInstalled()
  } catch {
    installed.value = []
  }
}

async function loadPlugins(search?: string): Promise<void> {
  loading.value = true
  offline.value = false
  try {
    const result = await window.characterArc.agentModules.pluginList(search ? { query: search } : undefined)
    plugins.value = result.items ?? []
    hasMore.value = Boolean(result.hasMore)
    page.value = 1
    if (plugins.value.length === 0 && !offline.value && !search) {
      // 空结果但未标记离线时也视为无插件
    }
  } catch {
    plugins.value = []
    offline.value = true
    hasMore.value = false
  } finally {
    loading.value = false
  }
}

/** 往下滑 / 点“加载更多”：拉取下一页并追加（无限滚动）。 */
async function loadMore(): Promise<void> {
  if (loadingMore.value || loading.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const result = await window.characterArc.agentModules.pluginList({
      query: query.value.trim() || undefined,
      page: next,
      perPage: PER_PAGE,
      loadMore: true
    })
    plugins.value = result.items ?? plugins.value
    hasMore.value = Boolean(result.hasMore)
    page.value = next
  } catch {
    // 加载失败保留已加载内容，hasMore 不变，用户可再试。
  } finally {
    loadingMore.value = false
  }
}

/** 列表容器滚动到底部时自动加载下一页。 */
function onListScroll(e: Event): void {
  const el = e.target as HTMLElement | null
  if (!el) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
    void loadMore()
  }
}

async function handleSearch(): Promise<void> {
  await loadPlugins(query.value.trim() || undefined)
}

async function importPlugin(p: DshPluginListing): Promise<void> {
  if (isInstalled(p.repo)) return
  if (importing.value.has(p.repo)) return
  importing.value.add(p.repo)
  try {
    const result = await window.characterArc.agentModules.pluginImport({
      repo: p.repo,
      name: p.name,
      description: p.description ?? ''
    })
    if (result.ok) {
      message.success(result.message)
      p.installed = true
      await loadInstalled()
    } else {
      message.warning(result.message)
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '导入失败')
  } finally {
    importing.value.delete(p.repo)
  }
}

async function uninstallPlugin(id: string): Promise<void> {
  const confirmed = window.confirm('确定卸载该插件？已启用的该模块会一并移除。')
  if (!confirmed) return
  try {
    const result = await window.characterArc.agentModules.pluginUninstall({ moduleId: id })
    message.success(result.message)
    await loadInstalled()
    await loadPlugins(query.value.trim() || undefined)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '卸载失败')
  }
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onMounted(() => {
  void loadInstalled()
  void loadPlugins()
})

defineExpose({ loadPlugins, loadInstalled })
</script>

<template>
  <div class="agent-plugin-market">
    <div class="apm-header">
      <div class="apm-title">
        <Puzzle :size="15" />
        插件市场
      </div>
      <span class="apm-sub">everything is a plugin</span>
    </div>

    <div class="apm-search">
      <Search :size="14" class="apm-search-icon" />
      <input
        v-model="query"
        type="search"
        placeholder="搜索 GitHub dsh-plugin 插件…"
        @keydown.enter="handleSearch"
      />
      <button type="button" class="apm-search-btn" @click="handleSearch">搜索</button>
    </div>

    <div class="apm-topic">
      数据来源：
      <a
        href="https://github.com/topics/dsh-plugin"
        target="_blank"
        rel="noopener"
      >github.com/topics/dsh-plugin <ExternalLink :size="11" /></a>
    </div>

    <div v-if="loading" class="apm-empty">加载插件清单中…</div>
    <div v-else-if="offline" class="apm-empty apm-offline">
      无法访问 GitHub（可能离线或网络受限），请检查网络后重试。
    </div>
    <div v-else-if="plugins.length === 0" class="apm-empty">暂无匹配的 dsh-plugin 插件</div>

    <div v-else class="apm-list arc-scrollbar" @scroll="onListScroll">
      <div
        v-for="p in plugins"
        :key="p.repo"
        class="apm-item"
        :class="{ installed: isInstalled(p.repo) }"
      >
        <div class="apm-item-icon">
          <Package :size="16" />
        </div>
        <div class="apm-item-body">
          <div class="apm-item-head">
            <a :href="p.url" target="_blank" rel="noopener" class="apm-item-name">
              {{ p.name }}
            </a>
            <span v-if="p.language" class="apm-item-lang">{{ p.language }}</span>
            <span v-if="p.stars" class="apm-item-stars"><Star :size="11" /> {{ p.stars }}</span>
          </div>
          <div class="apm-item-desc">{{ p.description || '（无描述）' }}</div>
          <div class="apm-item-meta">
            <span class="apm-item-repo">{{ p.repo }}</span>
            <span v-if="p.updatedAt">更新于 {{ formatDate(p.updatedAt) }}</span>
          </div>
        </div>
        <div class="apm-item-actions">
          <template v-if="isInstalled(p.repo)">
            <span class="apm-installed-tag">已导入</span>
            <button
              type="button"
              class="apm-uninstall"
              title="卸载"
              @click="uninstallPlugin(installedById.get(p.repo.toLowerCase()) ?? '')"
            >
              <Trash2 :size="14" />
            </button>
          </template>
          <button
            v-else
            type="button"
            class="apm-import"
            :disabled="importing.has(p.repo)"
            @click="importPlugin(p)"
          >
            {{ importing.has(p.repo) ? '导入中…' : '导入' }}
          </button>
        </div>
      </div>

      <div v-if="loadingMore || hasMore" class="apm-loadmore">
        <button
          v-if="hasMore"
          type="button"
          class="apm-loadmore-btn"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ loadingMore ? '加载中…' : '加载更多（往下滑继续刷新）' }}
        </button>
        <span v-else-if="loadingMore" class="apm-loadmore-tip">加载中…</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-plugin-market {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.apm-header {
  padding: 12px 14px 8px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.apm-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
  white-space: nowrap;
  flex-shrink: 0;
}
.apm-sub {
  font-size: 11px;
  color: var(--arc-text-hint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.apm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 12px 6px;
  padding: 6px 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  min-width: 0;
}
.apm-search-icon {
  color: var(--arc-text-hint);
  flex-shrink: 0;
}
.apm-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--arc-text-primary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.apm-search-btn {
  border: 1px solid color-mix(in srgb, var(--arc-primary) 40%, transparent);
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
}
.apm-topic {
  padding: 0 14px 8px;
  font-size: 10.5px;
  color: var(--arc-text-hint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.apm-topic a {
  color: var(--arc-primary);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.apm-empty {
  padding: 20px 14px;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 12px;
}
.apm-offline {
  color: var(--ga-danger, #b91c1c);
}
.apm-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.apm-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  transition: all 0.15s ease;
  min-width: 0;
}
.apm-item:hover {
  border-color: var(--arc-border-strong);
}
.apm-item.installed {
  opacity: 0.75;
}
.apm-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-primary);
  flex-shrink: 0;
}
.apm-item-body {
  flex: 1;
  min-width: 0;
}
.apm-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.apm-item-name {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--arc-text-primary);
  text-decoration: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.apm-item-name:hover {
  color: var(--arc-primary);
}
.apm-item-lang {
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-weight: 600;
}
.apm-item-stars {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  color: var(--arc-warning, #d97706);
}
.apm-item-desc {
  margin-top: 3px;
  font-size: 11px;
  color: var(--arc-text-secondary);
  line-height: 1.45;
  min-width: 0;
  overflow-wrap: break-word;
}
.apm-item-meta {
  margin-top: 4px;
  font-size: 10px;
  color: var(--arc-text-hint);
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  min-width: 0;
}
.apm-item-repo {
  font-family: var(--ga-mono, ui-monospace, monospace);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.apm-loadmore {
  display: flex;
  justify-content: center;
  padding: 6px 0 2px;
  min-height: 28px;
}
.apm-loadmore-btn {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 11px;
  padding: 4px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.apm-loadmore-btn:hover:not(:disabled) {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
}
.apm-loadmore-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.apm-loadmore-tip {
  font-size: 11px;
  color: var(--arc-text-hint);
}
.apm-item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex: 0 0 auto;
}
.apm-import {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 40%, transparent);
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.apm-import:hover {
  background: color-mix(in srgb, var(--arc-primary) 18%, transparent);
}
.apm-installed-tag {
  font-size: 10.5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--arc-success, #047857) 12%, transparent);
  color: var(--arc-success, #047857);
  font-weight: 600;
}
.apm-uninstall {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: transparent;
  color: var(--ga-danger, #b91c1c);
  cursor: pointer;
}
.apm-uninstall:hover {
  background: rgba(185, 28, 28, 0.1);
}
</style>
