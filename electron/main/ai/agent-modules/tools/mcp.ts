/**
 * McpModule · MCP 市场接入模块
 *
 * 支持：
 *   1. 远程 MCP 服务器（mcp.soul 等）通过 HTTP 接入
 *   2. 本地自定义 MCP 服务器通过 stdio 接入
 *   3. 内置小说项目 MCP 工具集（读写章节/人物/伏笔/世界观/大纲）
 *
 * 规则：
 *   - 凡读取/修改项目资源必须调用 MCP 工具，严禁凭空编造文件内容。
 *   - 区分远程与本地 MCP，自动使用当前激活的连接；服务断开主动提醒用户。
 */

import type { Tool, ToolHandlerResult, ToolContext } from '../../agent/tools/types'
import { discoverMcpTools, callMcpTool, listMcpServers } from '../mcp-servers'
import { createNovelMcpTools } from '../mcp-novel-server'
import type { NovelProjectAccessor } from '../mcp-novel-server'

/** 已知 MCP 市场。 */
export const KNOWN_MCP_MARKETS = [
  {
    id: 'mcp.so',
    name: 'MCP.so',
    description: '全球最大的 MCP 服务器目录市场',
    endpoint: 'https://mcp.so'
  },
  {
    id: 'smithery',
    name: 'Smithery',
    description: '按需运行的 MCP 服务器平台',
    endpoint: 'https://smithery.ai'
  },
  {
    id: 'glama',
    name: 'Glama',
    description: 'MCP 服务器市场',
    endpoint: 'https://glama.ai'
  },
  {
    id: 'pulsemcp',
    name: 'PulseMCP',
    description: 'MCP 服务器发现平台',
    endpoint: 'https://www.pulsemcp.com'
  }
]

/**
 * 创建 MCP 工具集。
 * 包含：
 *   - 内置小说项目 MCP 工具（novel_* 系列，直接访问项目数据）
 *   - 外部 MCP 服务器工具发现与调用（mcp_list_tools / mcp_call_tool）
 */
export function createMcpTools(opts?: {
  /** 项目数据访问器。缺省时使用内存实现（仅供开发/测试）。 */
  accessor?: NovelProjectAccessor
}): Tool[] {
  // 内置小说项目 MCP 工具集
  const novelTools = createNovelMcpTools(opts?.accessor)

  /** 列出已配置的外部 MCP 服务器及工具。 */
  const listMarkets: Tool = {
    definition: {
      name: 'mcp_list_markets',
      description:
        '列出可用的 MCP 市场（mcp.so、smithery、glama 等）及当前已配置的 MCP 服务器连接。',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    handler: async (): Promise<ToolHandlerResult> => {
      const markets = KNOWN_MCP_MARKETS.map((m) => `- ${m.id}: ${m.name} — ${m.description} (${m.endpoint})`)
      const servers = await listMcpServers()
      const serverLines = servers.map((s) =>
        `- ${s.name} [${s.transport === 'http' ? '远程' : '本地'}]${s.enabled ? '（已启用）' : '（未启用）'}${s.status === 'connected' ? ' ✅ 已连接' : s.status === 'error' ? ` ⚠️ ${s.lastError ?? '连接错误'}` : ' — 未连接'}`
      )
      return {
        content: `可用 MCP 市场:\n${markets.join('\n')}\n\n已配置 MCP 服务器:\n${serverLines.join('\n') || '（无）'}\n\n在「MCP 市场」面板中添加服务器连接后，即可调用外部 MCP 工具。`
      }
    }
  }

  /** 列出当前已连接 MCP 服务器的工具。 */
  const listTools: Tool = {
    definition: {
      name: 'mcp_list_tools',
      description:
        '列出当前已启用的 MCP 服务器上的可用工具（从 mcp.soul 或本地 MCP 服务发现）。',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    handler: async (): Promise<ToolHandlerResult> => {
      try {
        const tools = await discoverMcpTools()
        if (tools.length === 0) {
          return {
            content: '当前没有可用的外部 MCP 工具。请先在「MCP 市场」面板中添加并启用 MCP 服务器连接。'
          }
        }
        const lines = tools.map((t) =>
          `- ${t.serverName}/${t.name}${t.description ? ` — ${t.description.slice(0, 80)}` : ''}`
        )
        return { content: `已发现 ${tools.length} 个 MCP 工具：\n${lines.join('\n')}` }
      } catch (e) {
        return { content: `发现 MCP 工具失败: ${e instanceof Error ? e.message : String(e)}`, isError: true }
      }
    }
  }

  /** 调用指定 MCP 服务器的工具。 */
  const callTool: Tool = {
    definition: {
      name: 'mcp_call_tool',
      description:
        '调用已连接 MCP 服务器上的工具。需提供服务器名和工具名。若调用失败会说明故障原因。',
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'MCP 服务器名（如 mcp.soul 或自定义服务器名）。' },
          tool: { type: 'string', description: '要调用的工具名。' },
          args: { type: 'object', description: '工具参数。', additionalProperties: true }
        },
        required: ['server', 'tool']
      }
    },
    handler: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolHandlerResult> => {
      const serverName = String(args.server ?? '').trim()
      const toolName = String(args.tool ?? '').trim()
      if (!serverName || !toolName) return { content: '缺少参数 server 或 tool。', isError: true }

      try {
        const servers = await listMcpServers()
        const server = servers.find(
          (s) => s.name.toLowerCase() === serverName.toLowerCase() || s.id === serverName
        )
        if (!server) {
          return {
            content: `未找到 MCP 服务器「${serverName}」。当前已配置：${servers.map((s) => s.name).join('、') || '（无）'}。请在「MCP 市场」面板中添加服务器。`,
            isError: true
          }
        }
        if (!server.enabled) {
          return {
            content: `MCP 服务器「${server.name}」未启用。请在「MCP 市场」面板中启用该服务器。`,
            isError: true
          }
        }

        const toolArgs = (args.args as Record<string, unknown>) ?? {}
        const result = await callMcpTool(server.id, toolName, toolArgs)
        return { content: result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: `MCP 调用失败: ${msg}\n\n请检查：\n1. MCP 服务器「${serverName}」是否已启用\n2. 服务是否正在运行\n3. 连接配置是否正确`,
          isError: true
        }
      }
    }
  }

  return [...novelTools, listMarkets, listTools, callTool]
}
