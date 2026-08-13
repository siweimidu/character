/**
 * McpModule · MCP 市场接入模块
 *
 * 支持从 mcp.so、smithery 等 MCP 市场导入服务器/工具。
 * 该模块提供市场元信息与导入接口的骨架（实际连接由用户安装的 MCP 服务器提供）。
 */

import type { Tool, ToolHandlerResult, ToolContext } from '../../agent/tools/types'

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
 * 创建 MCP 市场相关工具。
 * 骨架：先支持枚举市场 / 说明导入方式；具体连接在用户配置后由 MCP 客户端接入。
 */
export function createMcpTools(): Tool[] {
  const listMarkets: Tool = {
    definition: {
      name: 'mcp_list_markets',
      description:
        '列出可用的 MCP 市场（mcp.so、smithery、glama 等），用于查找可导入的工具。',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    handler: async (): Promise<ToolHandlerResult> => {
      const lines = KNOWN_MCP_MARKETS.map((m) => `- ${m.id}: ${m.name} — ${m.description} (${m.endpoint})`)
      return {
        content: `可用 MCP 市场:\n${lines.join('\n')}\n\n提示: 导入 MCP 工具需要用户先在「MCP 市场」模块中配置服务器。`
      }
    }
  }

  const callTool: Tool = {
    definition: {
      name: 'mcp_call_tool',
      description: '调用已导入的 MCP 服务器工具。服务器名需为已配置的 MCP 服务器。',
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'MCP 服务器名。' },
          tool: { type: 'string', description: '要调用的工具名。' }
        },
        required: ['server', 'tool']
      }
    },
    handler: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolHandlerResult> => {
      const server = String(args.server ?? '').trim()
      const tool = String(args.tool ?? '').trim()
      if (!server || !tool) return { content: '缺少参数 server 或 tool。', isError: true }
      // 骨架实现：实际调用由 MCP 客户端完成。此处返回占位，提示用户配置。
      return {
        content: `MCP 工具调用 ${server}/${tool} 需要先完成 MCP 服务器配置。请在「MCP 市场」模块中添加服务器后重试。`,
        isError: false
      }
    }
  }

  return [listMarkets, callTool]
}
