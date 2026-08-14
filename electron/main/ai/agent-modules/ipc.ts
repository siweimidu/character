/**
 * AgentModules · 全局智能体模块系统 IPC
 *
 * 注册 `characterarc:agent-module:*` 命名空间下的通道：
 *   - 模块列表 / 启停 / 配置
 *   - 系统全目录文件访问（fs:*）
 *   - MCP 市场
 */

import { ipcMain } from 'electron'
import { readdir, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  AGENT_MODULE_IPC_CHANNELS as CH,
  BUILTIN_AGENT_MODULES,
  type AgentFsListRequest,
  type AgentFsReadRequest,
  type AgentFsWriteRequest,
  type AgentFsDeleteRequest,
  type AgentFsMkdirRequest,
  type AgentFsInfoRequest,
  type AgentModuleGetConfigRequest,
  type AgentModuleListRequest,
  type AgentModuleSetConfigRequest,
  type AgentModuleSetEnabledRequest,
  type McpImportRequest,
  type McpToolListing,
  type PluginImportRequest,
  type PluginListRequest
} from '@shared/agent-modules'
import { getAgentModuleRegistry } from './bootstrap'
import { KNOWN_MCP_MARKETS } from './tools/mcp'
import {
  listDshPlugins,
  importDshPlugin,
  uninstallDshPlugin,
  listInstalledPlugins
} from './tools/plugin'

/** 单次目录列举上限。 */
const MAX_LIST_ENTRIES = 500
/** 单文件读取上限（字符）。 */
const MAX_READ_CHARS = 60_000
/** 单次写入上限（字节）。 */
const MAX_WRITE_BYTES = 4 * 1024 * 1024

function fail(message: string): never {
  throw new Error(message)
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 注册全部 agent-module IPC 处理器。
 */
export function registerAgentModuleIpcHandlers(): void {
  // ==================== 模块列表 / 启停 / 配置 ====================
  ipcMain.handle(CH.MODULE_LIST, (_evt, payload: AgentModuleListRequest) => {
    const registry = getAgentModuleRegistry()
    return registry.list({ scope: payload?.scope, kind: payload?.kind })
  })

  ipcMain.handle(CH.MODULE_SET_ENABLED, (_evt, payload: AgentModuleSetEnabledRequest) => {
    const registry = getAgentModuleRegistry()
    if (!payload?.id) fail('缺少模块 id。')
    const okFlag = registry.setEnabled(payload.id, Boolean(payload.enabled))
    if (!okFlag) fail(`模块 ${payload.id} 不存在。`)
    return { ok: true, id: payload.id, enabled: Boolean(payload.enabled) }
  })

  ipcMain.handle(CH.MODULE_GET_CONFIG, (_evt, payload: AgentModuleGetConfigRequest) => {
    const registry = getAgentModuleRegistry()
    if (!payload?.id) fail('缺少模块 id。')
    return { id: payload.id, config: registry.getConfig(payload.id) }
  })

  ipcMain.handle(CH.MODULE_SET_CONFIG, (_evt, payload: AgentModuleSetConfigRequest) => {
    const registry = getAgentModuleRegistry()
    if (!payload?.id) fail('缺少模块 id。')
    registry.setConfig(payload.id, payload.config ?? {})
    return { ok: true, id: payload.id }
  })

  // ==================== 系统全目录文件访问 ====================
  ipcMain.handle(CH.FS_LIST, async (_evt, payload: AgentFsListRequest) => {
    if (!payload?.path) fail('缺少路径参数 path。')
    const abs = resolve(payload.path)
    const entries = await readdir(abs, { withFileTypes: true })
    const out = []
    for (const entry of entries.slice(0, MAX_LIST_ENTRIES)) {
      let size = 0
      let modifiedAt: string | undefined
      try {
        const st = await stat(join(abs, entry.name))
        size = st.size
        modifiedAt = st.mtime.toISOString()
      } catch {
        // ignore
      }
      out.push({
        name: entry.name,
        path: join(abs, entry.name),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        size,
        modifiedAt
      })
    }
    const parent = abs.split(/[\\/]/).slice(0, -1).join('/') || undefined
    return { path: abs, parent, entries: out }
  })

  ipcMain.handle(CH.FS_READ, async (_evt, payload: AgentFsReadRequest) => {
    if (!payload?.path) fail('缺少路径参数 path。')
    const abs = resolve(payload.path)
    const st = await stat(abs)
    if (st.isDirectory()) fail(`${abs} 是目录，请用 list 查看。`)
    const buf = await readFile(abs)
    const content = buf.toString('utf8')
    const maxChars = payload.maxChars ?? MAX_READ_CHARS
    return {
      path: abs,
      content: content.slice(0, maxChars),
      truncated: content.length > maxChars,
      size: st.size
    }
  })

  ipcMain.handle(CH.FS_WRITE, async (_evt, payload: AgentFsWriteRequest) => {
    if (!payload?.path) fail('缺少路径参数 path。')
    if (Buffer.byteLength(payload.content ?? '', 'utf8') > MAX_WRITE_BYTES) {
      fail('内容过大（超过 4MB）。')
    }
    const abs = resolve(payload.path)
    await writeFile(abs, payload.content ?? '', 'utf8')
    return { path: abs, bytes: Buffer.byteLength(payload.content ?? '', 'utf8') }
  })

  ipcMain.handle(CH.FS_DELETE, async (_evt, payload: AgentFsDeleteRequest) => {
    if (!payload?.path) fail('缺少路径参数 path。')
    const abs = resolve(payload.path)
    const st = await stat(abs)
    if (st.isDirectory() && !payload.recursive) {
      fail(`${abs} 是目录，删除目录需传入 recursive=true。`)
    }
    await rm(abs, { recursive: Boolean(payload.recursive), force: true })
    return { path: abs, deleted: true }
  })

  ipcMain.handle(CH.FS_MKDIR, async (_evt, payload: AgentFsMkdirRequest) => {
    if (!payload?.path) fail('缺少路径参数 path。')
    const abs = resolve(payload.path)
    await mkdir(abs, { recursive: true })
    return { path: abs, created: true }
  })

  ipcMain.handle(CH.FS_INFO, async (_evt, payload: AgentFsInfoRequest) => {
    if (!payload?.path) fail('缺少路径参数 path。')
    const abs = resolve(payload.path)
    try {
      const st = await stat(abs)
      return {
        path: abs,
        exists: true,
        isDirectory: st.isDirectory(),
        isFile: st.isFile(),
        size: st.size,
        modifiedAt: st.mtime.toISOString()
      }
    } catch {
      return { path: abs, exists: false, isDirectory: false, isFile: false, size: 0 }
    }
  })

  // ==================== MCP 市场 ====================
  ipcMain.handle(CH.MCP_LIST_MARKETS, () => {
    return KNOWN_MCP_MARKETS
  })

  ipcMain.handle(CH.MCP_LIST_TOOLS, async (_evt, payload: { marketId?: string }) => {
    // 骨架：返回各市场的工具占位清单。实际可从市场 API 拉取。
    const marketId = payload?.marketId
    const markets = KNOWN_MCP_MARKETS.filter((m) => !marketId || m.id === marketId)
    const listings: McpToolListing[] = []
    for (const market of markets) {
      listings.push({
        id: `${market.id}.server`,
        marketId: market.id,
        name: `${market.name} 服务器接入`,
        description: `从 ${market.name} 导入一个 MCP 服务器，扩展智能体工具集。`,
        installHint: `在「MCP 市场」模块配置 ${market.id} 的服务器连接。`
      })
    }
    return listings
  })

  ipcMain.handle(CH.MCP_IMPORT, async (_evt, payload: McpImportRequest) => {
    if (!payload?.marketId || !payload?.toolId) fail('缺少 marketId 或 toolId。')
    const registry = getAgentModuleRegistry()
    // 骨架：导入后把 mcp.market 模块启用，并记录配置。
    registry.setEnabled('mcp.market', true)
    const config = registry.getConfig('mcp.market')
    config[`imported:${payload.marketId}:${payload.toolId}`] = {
      importedAt: new Date().toISOString()
    }
    registry.setConfig('mcp.market', config)
    return {
      ok: true,
      moduleId: 'mcp.market',
      message: `已从 ${payload.marketId} 导入 ${payload.toolId}，MCP 市场模块已启用。`
    }
  })

  // ==================== dsh-plugin 插件市场 ====================
  ipcMain.handle(CH.PLUGIN_LIST, async (_evt, payload: PluginListRequest) => {
    return listDshPlugins(payload?.query)
  })

  ipcMain.handle(CH.PLUGIN_IMPORT, async (_evt, payload: PluginImportRequest) => {
    const registry = getAgentModuleRegistry()
    return importDshPlugin(payload, (def) => registry.register({ definition: def }))
  })

  ipcMain.handle(CH.PLUGIN_UNINSTALL, async (_evt, payload: { moduleId?: string }) => {
    if (!payload?.moduleId) fail('缺少 moduleId。')
    const registry = getAgentModuleRegistry()
    return uninstallDshPlugin(payload.moduleId, (id) => registry.unregister(id))
  })

  ipcMain.handle(CH.PLUGIN_LIST_INSTALLED, async () => {
    return listInstalledPlugins()
  })
}

/** 供 UI 展示的内置模块默认图标映射。 */
export { BUILTIN_AGENT_MODULES }

export { formatSize, MAX_LIST_ENTRIES, MAX_READ_CHARS }
