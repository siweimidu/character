/**
 * AgentModules · 全局智能体模块系统 IPC
 *
 * 注册 `characterarc:agent-module:*` 命名空间下的通道：
 *   - 模块列表 / 启停 / 配置
 *   - 系统全目录文件访问（fs:*）
 *   - MCP 市场
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
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
  type McpServerAddRequest,
  type McpServerDefinition,
  type PluginImportRequest,
  type PluginListRequest
} from '@shared/agent-modules'
import { getAgentModuleRegistry, ensurePluginsRebuilt } from './bootstrap'
import { KNOWN_MCP_MARKETS } from './tools/mcp'
import {
  listDshPlugins,
  importDshPlugin,
  uninstallDshPlugin,
  listInstalledPlugins
} from './tools/plugin'
import {
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  listMcpServers,
  testMcpServerConnection
} from './mcp-servers'

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
  ipcMain.handle(CH.MODULE_LIST, async (_evt, payload: AgentModuleListRequest) => {
    const registry = getAgentModuleRegistry()
    // 等待插件能力模块重建完成，保证「插件市场已导入」的插件在能力模块中一致可见。
    await ensurePluginsRebuilt()
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

  // ==================== 文件区（工作目录）选择 ====================
  ipcMain.handle(CH.FS_PICK_FOLDER, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择文件区（工作目录）',
      buttonLabel: '选择此文件夹',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true, path: '' }
    }
    return { success: true, canceled: false, path: result.filePaths[0] }
  })

  // ==================== MCP 市场 ====================
  ipcMain.handle(CH.MCP_LIST_MARKETS, () => {
    return KNOWN_MCP_MARKETS
  })

  ipcMain.handle(CH.MCP_LIST_TOOLS, async (_evt, payload: { marketId?: string }) => {
    // 从已连接的 MCP 服务器发现真实工具
    const { discoverMcpTools } = await import('./mcp-servers')
    const discovered = await discoverMcpTools()
    const listings: McpToolListing[] = discovered.map((t) => ({
      id: `${t.serverId}.${t.name}`,
      marketId: t.serverName,
      name: `${t.serverName}/${t.name}`,
      description: t.description ?? '',
      installHint: `已连接服务器「${t.serverName}」，可直接调用。`
    }))

    // 如果没有外部 MCP 服务器，返回内置小说项目 MCP 工具提示
    if (listings.length === 0 && (!payload?.marketId || payload.marketId === 'mcp.so' || payload.marketId === 'smithery')) {
      listings.push({
        id: 'builtin.novel-project',
        marketId: 'builtin',
        name: '小说项目 MCP 工具集',
        description: '内置 MCP 工具：读写章节、人物卡、伏笔、世界观、大纲。',
        installHint: '已在 MCP 市场模块启用时自动可用。'
      })
    }

    return listings
  })

  ipcMain.handle(CH.MCP_IMPORT, async (_evt, payload: McpImportRequest) => {
    if (!payload?.marketId || !payload?.toolId) fail('缺少 marketId 或 toolId。')
    const registry = getAgentModuleRegistry()
    // 导入工具时，确保 MCP 市场模块已启用
    registry.setEnabled('mcp.market', true)

    // 如果是导入已连接服务器的工具，直接启用该服务器
    // toolId 格式: `${serverId}.${toolName}`，serverId 可能包含点号
    // 先尝试按 marketId（服务器名称）匹配
    const servers = await listMcpServers()
    const server = servers.find(
      (s) => s.id === payload.toolId.split('.')[0] ||
             s.name.toLowerCase() === String(payload.marketId ?? '').toLowerCase()
    )
    if (server && !server.enabled) {
      await updateMcpServer(server.id, { enabled: true })
    }

    const config = registry.getConfig('mcp.market')
    config[`imported:${payload.marketId}:${payload.toolId}`] = {
      importedAt: new Date().toISOString()
    }
    registry.setConfig('mcp.market', config)
    return {
      ok: true,
      moduleId: 'mcp.market',
      message: `已导入 ${payload.marketId}/${payload.toolId}，MCP 市场模块已启用。`
    }
  })

  // ==================== MCP 服务器管理 ====================
  ipcMain.handle(CH.MCP_SERVER_LIST, async () => {
    return listMcpServers()
  })

  ipcMain.handle(CH.MCP_SERVER_ADD, async (_evt, payload: McpServerAddRequest) => {
    if (!payload?.name) fail('缺少服务器名称。')
    if (!payload?.transport) fail('缺少传输类型。')
    return addMcpServer({
      name: payload.name,
      description: payload.description,
      transport: payload.transport,
      command: payload.command,
      args: payload.args,
      cwd: payload.cwd,
      env: payload.env,
      url: payload.url,
      apiKey: payload.apiKey
    })
  })

  ipcMain.handle(CH.MCP_SERVER_UPDATE, async (_evt, payload: { id: string; patch: Partial<McpServerDefinition> }) => {
    if (!payload?.id) fail('缺少服务器 id。')
    return updateMcpServer(payload.id, payload.patch ?? {})
  })

  ipcMain.handle(CH.MCP_SERVER_DELETE, async (_evt, payload: { id: string }) => {
    if (!payload?.id) fail('缺少服务器 id。')
    await deleteMcpServer(payload.id)
    return { ok: true }
  })

  ipcMain.handle(CH.MCP_SERVER_TEST, async (_evt, payload: { id: string }) => {
    if (!payload?.id) fail('缺少服务器 id。')
    return testMcpServerConnection(payload.id)
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
