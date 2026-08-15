/**
 * PluginModule · dsh-plugin 插件市场模块
 *
 * 从 GitHub `dsh-plugin` topic（https://github.com/topics/dsh-plugin）浏览并
 * 导入插件，把每一个插件注册为全局智能体的一个「可独立启停的能力模块」，
 * 体现 DeepSeek Harness「everything is a plugin」的架构思想。
 *
 * 安装状态持久化到用户数据目录下的 plugin-market.json，跨重启保留。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import type {
  DshPluginListing,
  InstalledPlugin,
  PluginImportRequest,
  PluginImportResult
} from '@shared/agent-modules'
import type { AgentModuleDefinition } from '@shared/agent-modules'
import type { Tool } from '../../agent/tools/types'
import { createPluginPresetTools } from './plugin-runtime'

/** GitHub dsh-plugin 话题搜索地址。 */
const DSHP_PLUGIN_TOPIC_URL = 'https://api.github.com/search/repositories'

/** 每页默认条数（GitHub 单页上限 100）。 */
const DEFAULT_PAGE_SIZE = 30

/** 单次可累计的插件列表缓存（内存），避免重复请求 / 保证 hasMore 正确。 */
const listCache = new Map<string, DshPluginListing[]>()

/** 已安装插件同步缓存（供同步的 createTools 使用，启动时/增删时刷新）。 */
let installedCache: InstalledPlugin[] | null = null

/** 读取已安装插件（带同步缓存）。 */
function readInstalledCached(): InstalledPlugin[] {
  return installedCache ?? []
}

/** 强制刷新同步缓存（增删/启动后调用）。 */
export function refreshInstalledCache(plugins: InstalledPlugin[]): void {
  installedCache = plugins
}

/** 同步读取已安装插件清单（用于同步的 createTools）。 */
export function listInstalledPluginsSync(): InstalledPlugin[] {
  return readInstalledCached()
}

/** 已导入插件清单文件（位于 userData 下）。 */
function pluginStorePath(): string {
  return join(app.getPath('userData'), 'data', 'plugin-market.json')
}

/** 读取已安装插件清单。 */
async function readInstalledPlugins(): Promise<InstalledPlugin[]> {
  try {
    const raw = await readFile(pluginStorePath(), 'utf8')
    const parsed = JSON.parse(raw) as { plugins?: InstalledPlugin[] }
    const list = Array.isArray(parsed?.plugins) ? parsed.plugins : []
    installedCache = list
    return list
  } catch {
    installedCache = installedCache ?? []
    return installedCache
  }
}

/** 写入已安装插件清单。 */
async function writeInstalledPlugins(plugins: InstalledPlugin[]): Promise<void> {
  const file = pluginStorePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ plugins }, null, 2), 'utf8')
  installedCache = plugins
}

/**
 * 确保内置 dsh 预设持久化到已安装清单（幂等），
 * 使它们在插件市场里也显示为「已导入」。返回合并后的清单。
 */
export async function ensureBuiltinPluginsPersisted(): Promise<InstalledPlugin[]> {
  const existing = await readInstalledPlugins()
  const repos = new Set(existing.map((p) => p.repo.toLowerCase()))
  const toAdd = BUILTIN_PLUGINS.filter((p) => !repos.has(p.repo.toLowerCase()))
  if (toAdd.length === 0) return existing
  const merged = [...existing, ...toAdd]
  await writeInstalledPlugins(merged)
  return merged
}

export interface DshPluginPage {
  /** 当前页累计返回的插件（全部已加载页合并）。 */
  items: DshPluginListing[]
  /** 是否还有下一页可继续加载。 */
  hasMore: boolean
  /** 当前已加载到的页码（下一页从 page+1 开始）。 */
  page: number
  /** 每页条数。 */
  perPage: number
  /** 本次请求失败（离线/超时）时置 true。 */
  offline?: boolean
}

/** 清除内存分页缓存（供卸载等场景强制刷新）。 */
export function clearPluginListCache(): void {
  listCache.clear()
}

/**
 * 从 GitHub 搜索 dsh-plugin 话题下的仓库（分页）。
 *
 * 支持：
 *  - 关键词过滤（query）
 *  - 分页（page / perPage）与增量加载（loadMore）
 *
 * 原实现只抓 GitHub 第一页（默认 30 条），导致插件市场只显示部分插件。
 * 这里改为支持持续翻页：只要 GitHub 返回条数等于 perPage 即视为还有更多，
 * UI 侧「往下滑 / 点 load more」就能不断刷新出后续插件。
 */
export async function listDshPlugins(options?: {
  query?: string
  page?: number
  perPage?: number
  loadMore?: boolean
}): Promise<DshPluginPage> {
  const query = (options?.query ?? '').trim()
  const perPage = Math.min(100, Math.max(1, options?.perPage ?? DEFAULT_PAGE_SIZE))
  const page = Math.max(1, options?.page ?? 1)

  const installed = await readInstalledPlugins()
  const installedRepos = new Set(installed.map((p) => p.repo.toLowerCase()))
  const cacheKey = `q:${query || '*'}`

  // 增量加载（loadMore=true）：只拉取新的一页，并追加到该查询的累计缓存。
  if (options?.loadMore) {
    const pageItems = await fetchDshPage(query, page, perPage, installedRepos)
    const prior = listCache.get(cacheKey) ?? []
    const seen = new Set(prior.map((p) => p.repo.toLowerCase()))
    const appended = pageItems.items.filter((p) => !seen.has(p.repo.toLowerCase()))
    const merged = [...prior, ...appended]
    listCache.set(cacheKey, merged)
    return {
      items: merged,
      hasMore: pageItems.hasMore,
      page,
      perPage,
      offline: pageItems.offline
    }
  }

  // 从第一页开始的全量刷新：直接重新拉第一页并重置缓存。
  const pageItems = await fetchDshPage(query, 1, perPage, installedRepos)
  if (pageItems.offline) {
    // 离线时保留旧缓存，让用户仍能浏览已加载的条目。
    return {
      items: listCache.get(cacheKey) ?? [],
      hasMore: false,
      page: 1,
      perPage,
      offline: true
    }
  }
  listCache.set(cacheKey, pageItems.items)
  return { ...pageItems, page: 1, perPage }
}

/** 抓取 GitHub 单页 dsh-plugin 搜索结果。 */
async function fetchDshPage(
  query: string,
  page: number,
  perPage: number,
  installedRepos: Set<string>
): Promise<{
  items: DshPluginListing[]
  hasMore: boolean
  offline: boolean
}> {
  const url =
    `${DSHP_PLUGIN_TOPIC_URL}?q=topic:dsh-plugin` +
    (query ? `+${encodeURIComponent(query)}` : '') +
    `&per_page=${perPage}&page=${page}`

  let items: Array<Record<string, unknown>> = []
  let hasMore = false
  let offline = false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (res.ok) {
      const body = (await res.json()) as {
        items?: Array<Record<string, unknown>>
        total_count?: number
      }
      items = Array.isArray(body.items) ? body.items : []
      hasMore = items.length >= perPage
      if (typeof body.total_count === 'number') {
        hasMore = hasMore && items.length > 0
      }
    } else {
      // GitHub 限流（403/429）时按离线处理，避免 UI 卡死。
      offline = true
    }
  } catch {
    // 离线或超时：返回空清单，标记离线
    offline = true
  }

  return {
    items: items.map((it) => {
      const repo = String(it.full_name ?? '')
      const name = String(it.name ?? repo.split('/').pop() ?? repo)
      return {
        repo,
        name,
        description: typeof it.description === 'string' ? it.description : undefined,
        url: String(it.html_url ?? `https://github.com/${repo}`),
        installed: repo !== '' && installedRepos.has(repo.toLowerCase()),
        stars: typeof it.stargazers_count === 'number' ? it.stargazers_count : undefined,
        language: typeof it.language === 'string' ? it.language : undefined,
        updatedAt: typeof it.updated_at === 'string' ? it.updated_at : undefined
      }
    }),
    hasMore,
    offline
  }
}

/**
 * 导入一个 dsh-plugin 插件为全局智能体能力模块。
 * 仅做元信息注册（插件真实工具由插件仓库提供），并记录到持久化清单。
 */
export async function importDshPlugin(
  req: PluginImportRequest,
  register: (
    def: AgentModuleDefinition,
    createTools?: () => unknown[]
  ) => void
): Promise<PluginImportResult> {
  const repo = (req?.repo ?? '').trim()
  const name = (req?.name ?? '').trim() || repo.split('/').pop() || '插件'
  const description = (req?.description ?? '').trim() || `来自 GitHub dsh-plugin 的插件：${repo}`
  if (!repo) return { ok: false, message: '缺少仓库地址。' }

  const plugins = await readInstalledPlugins()
  const normalized = repo.toLowerCase()
  if (plugins.some((p) => p.repo.toLowerCase() === normalized)) {
    return { ok: false, message: `插件 ${repo} 已导入。` }
  }

  const moduleId = `plugin.${normalized.replace(/[^a-z0-9_.-]/g, '-')}`

  const installed: InstalledPlugin = {
    id: moduleId,
    repo,
    name,
    description,
    version: '1.0.0',
    author: repo.split('/')[0] ?? 'dsh-plugin',
    installedAt: new Date().toISOString()
  }
  register(buildPluginModuleDefinition(installed), () => createPluginTools(installed))
  plugins.push(installed)
  await writeInstalledPlugins(plugins)

  return { ok: true, moduleId, message: `已导入插件「${name}」（${repo}）。可在「能力模块」中启用它。` }
}

/** 卸载一个已导入插件（移除注册与持久化记录）。 */
export async function uninstallDshPlugin(
  moduleId: string,
  unregister: (id: string) => void
): Promise<PluginImportResult> {
  const plugins = await readInstalledPlugins()
  const target = plugins.find((p) => p.id === moduleId)
  if (!target) return { ok: false, message: '插件不存在或已卸载。' }

  const rest = plugins.filter((p) => p.id !== moduleId)
  await writeInstalledPlugins(rest)
  unregister(moduleId)

  return { ok: true, moduleId, message: `已卸载插件「${target.name}」。` }
}

/** 列出已导入插件。 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  return readInstalledPlugins()
}

/**
 * 由已安装插件构建可执行工具工厂（真实能力注入）。
 * 让「装了插件就自动能用」：每个已安装插件都会贡献一个
 * `plugin_<id>_run` 工具（任务路由 / persona 注入），不再是空模块。
 */
export function createPluginTools(installed: InstalledPlugin): Tool[] {
  return createPluginPresetTools([
    {
      id: installed.id,
      repo: installed.repo,
      name: installed.name,
      description: installed.description,
      builtin: isBuiltinPluginRepo(installed.repo)
    }
  ])
}

/** 默认内置插件清单（用户指定自动安装的两个 dsh 预设）。 */
export const BUILTIN_PLUGINS: InstalledPlugin[] = [
  {
    id: 'plugin.v4-flash-godmode-opencode-go',
    repo: 'SheberDavid/v4-flash-godmode-opencode-go',
    name: 'V4 Flash 神模式',
    description: '让 Flash / 普通模型从「鬼模式」切到「神模式」：任务感知路由 + 深度思考锚（w7 persona），构建/修复自动分流。',
    version: '1.0.0',
    author: 'SheberDavid',
    installedAt: new Date().toISOString()
  },
  {
    id: 'plugin.dsh-routing-suite',
    repo: 'yjh051108/dsh-routing-suite',
    name: 'dsh 路由套件',
    description: '任务感知推理模式路由（spec/react/weak），按首条消息分类注入 persona 与首轮核心工具面，实测 P1–P23。',
    version: '1.0.0',
    author: 'yjh051108',
    installedAt: new Date().toISOString()
  }
]

/** 默认内置插件是否出现在「已导入」清单。 */
export function isBuiltinPluginRepo(repo: string): boolean {
  const r = repo.toLowerCase()
  return BUILTIN_PLUGINS.some((p) => p.repo.toLowerCase() === r)
}

/**
 * 由已安装插件记录构建能力模块定义。
 *
 * 用于应用重启后从持久化清单重建插件能力模块（插件注册本身只存在于内存
 * registry，重启后若不重建，会出现「插件市场显示已导入、能力模块里却没有」
 * 的问题）。字段与 importDshPlugin 注册时保持一致。
 */
export function buildPluginModuleDefinition(installed: InstalledPlugin): AgentModuleDefinition {
  const builtin = isBuiltinPluginRepo(installed.repo)
  return {
    id: installed.id,
    name: installed.name,
    description: installed.description,
    kind: 'plugin',
    source: builtin ? 'builtin' : 'marketplace',
    scope: 'global',
    // 内置 dsh 预设默认启用（装上即自动使用）。
    enabledByDefault: builtin,
    risk: 'medium',
    toolNames: [`plugin_${installed.id.replace(/^plugin[-_.]/i, '').replace(/[^a-z0-9_-]/gi, '-')}_run`],
    version: installed.version ?? '1.0.0',
    icon: 'Puzzle',
    author: installed.author ?? installed.repo.split('/')[0] ?? 'dsh-plugin'
  }
}

export { pluginStorePath }
