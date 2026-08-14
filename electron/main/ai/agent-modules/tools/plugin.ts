/**
 * PluginModule · dsh-plugin 插件市场模块
 *
 * 从 GitHub `dsh-plugin` topic（https://github.com/topics/dsh-plugin）浏览并
 * 导入插件，把每一个插件注册为全局智能体的一个「可独立启停的能力模块」，
 * 体现 DeepSeek Harness「everything is a plugin」的架构思想。
 *
 * 安装状态持久化到用户数据目录下的 plugin-market.json，跨重启保留。
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import type {
  DshPluginListing,
  InstalledPlugin,
  PluginImportRequest,
  PluginImportResult
} from '@shared/agent-modules'
import type { AgentModuleDefinition } from '@shared/agent-modules'

/** GitHub dsh-plugin 话题搜索地址。 */
const DSHP_PLUGIN_TOPIC_URL = 'https://api.github.com/search/repositories?q=topic:dsh-plugin'

/** 已导入插件清单文件（位于 userData 下）。 */
function pluginStorePath(): string {
  return join(app.getPath('userData'), 'data', 'plugin-market.json')
}

/** 读取已安装插件清单。 */
async function readInstalledPlugins(): Promise<InstalledPlugin[]> {
  try {
    const raw = await readFile(pluginStorePath(), 'utf8')
    const parsed = JSON.parse(raw) as { plugins?: InstalledPlugin[] }
    return Array.isArray(parsed?.plugins) ? parsed.plugins : []
  } catch {
    return []
  }
}

/** 写入已安装插件清单。 */
async function writeInstalledPlugins(plugins: InstalledPlugin[]): Promise<void> {
  const file = pluginStorePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ plugins }, null, 2), 'utf8')
}

/**
 * 从 GitHub 搜索 dsh-plugin 话题下的仓库。
 * 支持可选关键词过滤；网络失败时返回空数组（UI 提示离线）。
 */
export async function listDshPlugins(query?: string): Promise<DshPluginListing[]> {
  const installed = await readInstalledPlugins()
  const installedRepos = new Set(installed.map((p) => p.repo.toLowerCase()))
  const url = DSHP_PLUGIN_TOPIC_URL + (query ? `+${encodeURIComponent(query.trim())}` : '')

  let items: Array<Record<string, unknown>> = []
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (res.ok) {
      const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
      items = Array.isArray(body.items) ? body.items : []
    }
  } catch {
    // 离线或超时：返回空清单
  }

  return items.map((it) => {
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
  })
}

/**
 * 导入一个 dsh-plugin 插件为全局智能体能力模块。
 * 仅做元信息注册（插件真实工具由插件仓库提供），并记录到持久化清单。
 */
export async function importDshPlugin(
  req: PluginImportRequest,
  register: (def: AgentModuleDefinition) => void
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
  register({
    id: moduleId,
    name,
    description,
    kind: 'plugin',
    source: 'marketplace',
    scope: 'global',
    enabledByDefault: false,
    risk: 'medium',
    toolNames: [],
    version: '1.0.0',
    icon: 'Puzzle',
    author: repo.split('/')[0] ?? 'dsh-plugin'
  })

  const installed: InstalledPlugin = {
    id: moduleId,
    repo,
    name,
    description,
    version: '1.0.0',
    author: repo.split('/')[0] ?? 'dsh-plugin',
    installedAt: new Date().toISOString()
  }
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

export { pluginStorePath }
