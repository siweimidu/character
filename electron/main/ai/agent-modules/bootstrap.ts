/**
 * AgentModuleBootstrap · 全局智能体模块系统装配
 *
 * 把内置能力模块注册进 AgentModuleRegistry，并把注册表与状态存储暴露给
 * IPC 层与智能体工具装配使用。这是「全局智能体的一切都模块化」的入口。
 */

import { AgentModuleRegistry } from './registry'
import { LazySqliteModuleStore } from './sqlite-store'
import { createSystemFileTools } from './tools/system-filesystem'
import { createExecTools } from './tools/exec'
import { createMcpTools } from './tools/mcp'
import { SqliteNovelAccessor } from './mcp-novel-server'
import type { DatabaseSync } from 'node:sqlite'

/** 全局唯一模块注册表实例。 */
let registry: AgentModuleRegistry | null = null
/** 惰性 SQLite 存储（启动早期内存承接，DB 就绪后落库）。 */
let moduleStore: LazySqliteModuleStore | null = null

/**
 * 初始化模块注册中心（幂等）。
 * 在应用启动时调用一次。
 *
 * 启停开关默认先落在内存，等 SQLite 就绪后调用 attachAgentModuleStore()
 * 合并持久化状态并实时落库，实现「能力模块开关跨重启持久」。
 */
export function initAgentModuleRegistry(): AgentModuleRegistry {
  if (registry) return registry

  moduleStore = new LazySqliteModuleStore()
  registry = new AgentModuleRegistry(moduleStore)

  // 注册内置能力模块 → 工具工厂
  registry.register({
    definition: {
      id: 'filesystem.system',
      name: '系统全目录访问',
      description: '允许访问计算机任意目录（含软件之外），实现「操作任意文件」能力。',
      kind: 'filesystem',
      source: 'builtin',
      scope: 'global',
      enabledByDefault: true,
      risk: 'critical',
      toolNames: ['sysfs_list', 'sysfs_read', 'sysfs_write', 'sysfs_delete', 'sysfs_mkdir', 'sysfs_info'],
      icon: 'FolderTree',
      version: '1.0.0',
      author: 'CharacterArc'
    },
    createTools: () => createSystemFileTools()
  })

  registry.register({
    definition: {
      id: 'exec.shell',
      name: '代码 / 命令执行',
      description: '在沙箱内运行 shell / node / python 脚本，实现「写代码、跑脚本、自动化」。',
      kind: 'exec',
      source: 'builtin',
      scope: 'global',
      enabledByDefault: false,
      risk: 'critical',
      toolNames: ['run_command'],
      icon: 'Terminal',
      version: '1.0.0',
      author: 'CharacterArc'
    },
    createTools: () => createExecTools()
  })

  registry.register({
    definition: {
      id: 'mcp.market',
      name: 'MCP 市场',
      description: '接入远程 mcp.soul 或本地 MCP 服务器，读写小说项目文件。',
      kind: 'mcp',
      source: 'builtin',
      scope: 'global',
      enabledByDefault: false,
      risk: 'high',
      toolNames: ['novel_read_chapter', 'novel_write_chapter', 'novel_read_character', 'novel_write_character', 'novel_read_foreshadow', 'novel_write_foreshadow', 'novel_read_world', 'novel_write_world', 'novel_read_outline', 'novel_write_outline', 'mcp_list_markets', 'mcp_list_tools', 'mcp_call_tool'],
      icon: 'Plug',
      version: '1.0.0',
      author: 'CharacterArc'
    },
    createTools: () => createMcpTools({ accessor: new SqliteNovelAccessor() })
  })

  registry.register({
    definition: {
      id: 'plugin.market',
      name: '插件市场（dsh-plugin）',
      description: '从 GitHub dsh-plugin 话题导入插件，everything is a plugin。',
      kind: 'plugin',
      source: 'builtin',
      scope: 'global',
      enabledByDefault: true,
      risk: 'low',
      toolNames: ['plugin_list', 'plugin_import'],
      icon: 'Puzzle',
      version: '1.0.0',
      author: 'CharacterArc'
    },
    createTools: () => []
  })

  return registry
}

/** 获取模块注册中心（未初始化时惰性初始化）。 */
export function getAgentModuleRegistry(): AgentModuleRegistry {
  if (!registry) initAgentModuleRegistry()
  return registry!
}

/**
 * 将能力模块启停状态挂接到 SQLite 持久化存储。
 * 在 workspace SQLite 就绪后调用一次，之后模块开关实时落库、跨重启保留。
 */
export function attachAgentModuleStore(db: DatabaseSync): void {
  initAgentModuleRegistry()
  moduleStore?.attach(db)
}

/** 供测试重置。 */
export function resetAgentModuleRegistryForTest(): void {
  registry = null
  moduleStore = null
}
