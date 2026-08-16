/**
 * McpServers · MCP 服务器连接管理
 *
 * 管理用户配置的 MCP 服务器连接（远程 mcp.soul 或本地自定义 MCP 服务），
 * 负责：添加/编辑/删除配置、测试连接、工具发现、工具调用转发。
 *
 * 持久化配置到用户数据目录 mcp-servers.json，跨重启保留。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { getWorkspaceDirPath } from '../../workspace-store'
import type { McpServerConfig, McpRemoteTool, McpClientLike } from './mcp-client'
import { createMcpClient } from './mcp-client'

// ============================================================================
// 持久化
// ============================================================================

/** MCP 服务器配置存储路径。 */
function mcpServersStorePath(): string {
  return join(getWorkspaceDirPath(), 'mcp-servers.json')
}

/** 读取所有 MCP 服务器配置。 */
export async function readMcpServers(): Promise<McpServerConfig[]> {
  try {
    const raw = await readFile(mcpServersStorePath(), 'utf8')
    const parsed = JSON.parse(raw) as { servers?: McpServerConfig[] }
    return Array.isArray(parsed?.servers) ? parsed.servers : []
  } catch {
    return []
  }
}

/** 写入 MCP 服务器配置。 */
async function writeMcpServers(servers: McpServerConfig[]): Promise<void> {
  const file = mcpServersStorePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ servers }, null, 2), 'utf8')
}

// ============================================================================
// 服务器管理
// ============================================================================

/** 连接池：已连接的服务器客户端实例。 */
const connectionPool = new Map<string, McpClientLike>()

/** 生成唯一服务器 id。 */
function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 添加 MCP 服务器配置。 */
export async function addMcpServer(input: {
  name: string
  description?: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  apiKey?: string
}): Promise<McpServerConfig> {
  if (!input?.name?.trim()) {
    throw new Error('缺少服务器名称。')
  }
  if (input.transport === 'stdio' && !input.command?.trim()) {
    throw new Error('本地 MCP 服务器需要填写启动命令（如 npx）。')
  }
  if (input.transport === 'http' && !input.url?.trim()) {
    throw new Error('远程 MCP 服务器需要填写 URL 地址。')
  }

  const servers = await readMcpServers()
  const server: McpServerConfig = {
    id: genId('mcp'),
    name: input.name.trim(),
    description: input.description?.trim(),
    transport: input.transport,
    command: input.command?.trim(),
    args: input.args ?? [],
    cwd: input.cwd,
    env: input.env,
    url: input.url?.trim(),
    apiKey: input.apiKey,
    enabled: false,
    status: 'disconnected',
    createdAt: new Date().toISOString()
  }
  servers.push(server)
  await writeMcpServers(servers)
  return server
}

/** 更新 MCP 服务器配置。 */
export async function updateMcpServer(
  id: string,
  patch: Partial<McpServerConfig>
): Promise<McpServerConfig> {
  const servers = await readMcpServers()
  const idx = servers.findIndex((s) => s.id === id)
  if (idx < 0) throw new Error(`MCP 服务器 ${id} 不存在。`)

  servers[idx] = { ...servers[idx], ...patch, id }
  await writeMcpServers(servers)

  // 配置变更后断开旧连接
  const old = connectionPool.get(id)
  if (old) {
    await old.close().catch(() => {})
    connectionPool.delete(id)
  }

  return servers[idx]
}

/** 删除 MCP 服务器配置。 */
export async function deleteMcpServer(id: string): Promise<void> {
  const servers = await readMcpServers()
  const rest = servers.filter((s) => s.id !== id)
  await writeMcpServers(rest)

  const client = connectionPool.get(id)
  if (client) {
    await client.close().catch(() => {})
    connectionPool.delete(id)
  }
}

/** 列出所有 MCP 服务器配置。 */
export async function listMcpServers(): Promise<McpServerConfig[]> {
  const servers = await readMcpServers()
  // 刷新连接状态
  for (const s of servers) {
    const client = connectionPool.get(s.id)
    s.status = client?.isConnected ? 'connected' : (s.status ?? 'disconnected')
  }
  return servers
}

/**
 * 测试 MCP 服务器连接。
 * 尝试建立连接并列出工具，成功返回工具列表。
 */
export async function testMcpServerConnection(id: string): Promise<{
  ok: boolean
  message: string
  tools?: McpRemoteTool[]
}> {
  const servers = await readMcpServers()
  const server = servers.find((s) => s.id === id)
  if (!server) return { ok: false, message: `MCP 服务器 ${id} 不存在。` }

  const client = createMcpClient(server)
  try {
    await client.connect()
    const tools = await client.listTools()
    server.status = 'connected'
    server.lastConnectedAt = new Date().toISOString()
    server.lastError = undefined
    await writeMcpServers(servers)

    // 缓存连接
    const old = connectionPool.get(id)
    if (old) await old.close().catch(() => {})
    connectionPool.set(id, client)

    return {
      ok: true,
      message: `连接成功，发现 ${tools.length} 个工具。`,
      tools
    }
  } catch (e) {
    server.status = 'error'
    server.lastError = e instanceof Error ? e.message : String(e)
    await writeMcpServers(servers)
    await client.close().catch(() => {})
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

// ============================================================================
// 工具发现与调用
// ============================================================================

/** 从已配置的 MCP 服务器中发现工具。 */
export async function discoverMcpTools(): Promise<McpRemoteTool[]> {
  const servers = await readMcpServers()
  const enabledServers = servers.filter((s) => s.enabled)
  const allTools: McpRemoteTool[] = []

  for (const server of enabledServers) {
    try {
      let client = connectionPool.get(server.id)
      if (!client || !client.isConnected) {
        client = createMcpClient(server)
        await client.connect()
        connectionPool.set(server.id, client)
        server.status = 'connected'
        server.lastConnectedAt = new Date().toISOString()
        server.lastError = undefined
      }
      const tools = await client.listTools()
      allTools.push(
        ...tools.map((t) => ({
          ...t,
          serverId: server.id,
          serverName: server.name
        }))
      )
    } catch (e) {
      server.status = 'error'
      server.lastError = e instanceof Error ? e.message : String(e)
    }
  }

  await writeMcpServers(servers)
  return allTools
}

/** 调用已连接 MCP 服务器的工具。 */
export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const servers = await readMcpServers()
  const server = servers.find((s) => s.id === serverId)
  if (!server) {
    throw new Error(`MCP 服务器 ${serverId} 不存在或已被删除。`)
  }
  if (!server.enabled) {
    throw new Error(`MCP 服务器「${server.name}」未启用，请先在 MCP 市场中启用该连接。`)
  }

  let client = connectionPool.get(serverId)
  if (!client || !client.isConnected) {
    client = createMcpClient(server)
    try {
      await client.connect()
      connectionPool.set(serverId, client)
      server.status = 'connected'
      server.lastConnectedAt = new Date().toISOString()
      server.lastError = undefined
      await writeMcpServers(servers)
    } catch (e) {
      server.status = 'error'
      server.lastError = e instanceof Error ? e.message : String(e)
      await writeMcpServers(servers)
      throw new Error(
        `MCP 服务器「${server.name}」连接失败。请检查连接配置或服务是否运行。${
          e instanceof Error ? `（${e.message}）` : ''
        }`
      )
    }
  }

  try {
    const result = await client.callTool(toolName, args)
    server.lastConnectedAt = new Date().toISOString()
    await writeMcpServers(servers)
    return result
  } catch (e) {
    server.status = 'error'
    server.lastError = e instanceof Error ? e.message : String(e)
    await writeMcpServers(servers)
    // 连接可能已断开，清除连接池中的缓存
    connectionPool.delete(serverId)
    throw new Error(
      `调用 MCP 工具「${server.name}/${toolName}」失败: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
  }
}

/** 获取当前已连接的所有 MCP 服务器。 */
export function getConnectedMcpServers(): string[] {
  const connected: string[] = []
  for (const [id, client] of connectionPool.entries()) {
    if (client.isConnected) connected.push(id)
  }
  return connected
}

/** 关闭所有 MCP 连接（应用退出时调用）。 */
export async function closeAllMcpConnections(): Promise<void> {
  for (const [id, client] of connectionPool.entries()) {
    await client.close().catch(() => {})
    connectionPool.delete(id)
  }
}

/** 默认 mcp.soul 远程服务器配置。 */
export const DEFAULT_MCP_SOUL_SERVER: McpServerConfig = {
  id: 'mcp-soul-default',
  name: 'mcp.soul',
  description: 'CharacterArc 官方远程 MCP 服务，用于读写小说项目文件。',
  transport: 'http',
  url: 'https://mcp.soul:3000/mcp',
  enabled: true,
  status: 'disconnected',
  createdAt: new Date().toISOString()
}
