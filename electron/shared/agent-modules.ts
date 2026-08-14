/**
 * 全局智能体 · 模块化能力系统共享契约
 *
 * 架构灵感来自 DeepSeek Harness（deepseek-harness）"everything is a plugin"
 * 的设计思想：全局智能体的每一种能力（文件系统、代码执行、浏览器、MCP、
 * 语音识别、微信/应用自动化等）都做成一个可独立启停、可扩展、可替换的「模块」。
 *
 * 渲染进程只需感知模块的元信息与开关状态；真正的工具注入与执行由主进程的
 * AgentModuleRegistry 统一编排。新增能力 = 注册一个新模块，不改动智能体核心。
 */

// ============================================================================
// 模块类型
// ============================================================================

/** 模块大类，决定其能力边界与默认权限。 */
export type AgentModuleKind =
  | 'filesystem'   // 文件系统：读取/写入/删除/搜索磁盘目录
  | 'exec'         // 代码执行：运行 shell / node / python 脚本
  | 'browser'      // 浏览器控制：ego-lite / Playwright 等
  | 'mcp'          // MCP 市场接入：mcp.so / smithery 等
  | 'speech'       // 语音转文字：API / 本地模型 / WinRT 离线 ASR
  | 'automation'   // 桌面应用自动化：微信、邮件等
  | 'multimedia'   // 多媒体：视频剪辑 / 图像生成等
  | 'knowledge'    // 知识库 / 记忆 / 检索
  | 'delegate'     // 子智能体委派
  | 'network'      // 网络请求 / 爬虫
  | 'plugin'       // dsh-plugin 插件（everything is a plugin）

/** 模块启用范围：全局启用对所有会话生效；项目级仅对指定项目生效。 */
export type AgentModuleScope = 'global' | 'project'

/** 模块启停状态。 */
export type AgentModuleStatus = 'enabled' | 'disabled'

/** 模块安装来源。 */
export type AgentModuleSource = 'builtin' | 'marketplace' | 'manual'

/** 模块能力危险等级，用于权限提示。 */
export type AgentModuleRisk = 'low' | 'medium' | 'high' | 'critical'

// ============================================================================
// 模块定义
// ============================================================================

/**
 * 全局智能体能力模块定义。
 * 与 deepseek-harness 的 plugin 理念一致：每个模块是一个自包含的能力包，
 * 声明它注入哪些工具、需要哪些权限、属于哪个大类。
 */
export interface AgentModuleDefinition {
  /** 模块唯一 id，如 'filesystem.system' / 'mcp.market'。 */
  id: string
  /** 模块名称，如「系统文件访问」「MCP 市场」。 */
  name: string
  /** 简短描述，展示在模块管理器里。 */
  description: string
  /** 模块大类。 */
  kind: AgentModuleKind
  /** 安装来源。 */
  source: AgentModuleSource
  /** 启用范围。 */
  scope: AgentModuleScope
  /** 默认是否启用。 */
  enabledByDefault: boolean
  /** 危险等级，用于「启用高危模块」的二次确认。 */
  risk: AgentModuleRisk
  /** 该模块注入的工具名列表（供 UI 展示与权限审计）。 */
  toolNames: string[]
  /** 版本号。 */
  version: string
  /** 图标（渲染进程用 lucide 图标名）。 */
  icon: string
  /** 作者 / 提供方。 */
  author: string
  /** 扩展配置（各模块私有）。 */
  config?: Record<string, unknown>
}

/** 运行时模块实例：定义 + 当前状态 + 使用统计。 */
export interface AgentModuleRuntime extends AgentModuleDefinition {
  enabled: boolean
  /** 最近一次触发时间。 */
  lastUsedAt?: string
  /** 累计触发次数。 */
  usageCount: number
}

// ============================================================================
// IPC 通道
// ============================================================================

export const AGENT_MODULE_IPC_CHANNELS = {
  MODULE_LIST: 'characterarc:agent-module:list',
  MODULE_SET_ENABLED: 'characterarc:agent-module:set-enabled',
  MODULE_GET_CONFIG: 'characterarc:agent-module:get-config',
  MODULE_SET_CONFIG: 'characterarc:agent-module:set-config',
  // 文件系统（全目录访问，受权限门控）
  FS_LIST: 'characterarc:agent-module:fs:list',
  FS_READ: 'characterarc:agent-module:fs:read',
  FS_WRITE: 'characterarc:agent-module:fs:write',
  FS_DELETE: 'characterarc:agent-module:fs:delete',
  FS_MKDIR: 'characterarc:agent-module:fs:mkdir',
  FS_INFO: 'characterarc:agent-module:fs:info',
  // MCP 市场
  MCP_LIST_MARKETS: 'characterarc:agent-module:mcp:list-markets',
  MCP_LIST_TOOLS: 'characterarc:agent-module:mcp:list-tools',
  MCP_IMPORT: 'characterarc:agent-module:mcp:import',
  // MCP 服务器管理
  MCP_SERVER_LIST: 'characterarc:agent-module:mcp:server:list',
  MCP_SERVER_ADD: 'characterarc:agent-module:mcp:server:add',
  MCP_SERVER_UPDATE: 'characterarc:agent-module:mcp:server:update',
  MCP_SERVER_DELETE: 'characterarc:agent-module:mcp:server:delete',
  MCP_SERVER_TEST: 'characterarc:agent-module:mcp:server:test',
  // dsh-plugin 插件市场
  PLUGIN_LIST: 'characterarc:agent-module:plugin:list',
  PLUGIN_IMPORT: 'characterarc:agent-module:plugin:import',
  PLUGIN_UNINSTALL: 'characterarc:agent-module:plugin:uninstall',
  PLUGIN_LIST_INSTALLED: 'characterarc:agent-module:plugin:list-installed'
} as const

export type AgentModuleIpcChannel =
  typeof AGENT_MODULE_IPC_CHANNELS[keyof typeof AGENT_MODULE_IPC_CHANNELS]

// ============================================================================
// IPC 请求 / 响应 payload
// ============================================================================

export interface AgentModuleListRequest {
  scope?: AgentModuleScope
  kind?: AgentModuleKind
}

export interface AgentModuleSetEnabledRequest {
  id: string
  enabled: boolean
}

export interface AgentModuleGetConfigRequest {
  id: string
}

export interface AgentModuleSetConfigRequest {
  id: string
  config: Record<string, unknown>
}

// --- 文件系统 ---

/** 文件系统访问条目。 */
export interface AgentFsEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
  modifiedAt?: string
}

export interface AgentFsListRequest {
  path: string
}

export interface AgentFsListResult {
  path: string
  parent?: string
  entries: AgentFsEntry[]
}

export interface AgentFsReadRequest {
  path: string
  /** 可选：只读前 N 个字符（默认 60000）。 */
  maxChars?: number
}

export interface AgentFsReadResult {
  path: string
  content: string
  truncated: boolean
  size: number
}

export interface AgentFsWriteRequest {
  path: string
  content: string
}

export interface AgentFsWriteResult {
  path: string
  bytes: number
}

export interface AgentFsDeleteRequest {
  path: string
  recursive: boolean
}

export interface AgentFsDeleteResult {
  path: string
  deleted: boolean
}

export interface AgentFsMkdirRequest {
  path: string
}

export interface AgentFsMkdirResult {
  path: string
  created: boolean
}

export interface AgentFsInfoRequest {
  path: string
}

export interface AgentFsInfoResult {
  path: string
  exists: boolean
  isDirectory: boolean
  isFile: boolean
  size: number
  modifiedAt?: string
}

// --- MCP ---

/** MCP 市场定义（mcp.so / smithery 等）。 */
export interface McpMarketDefinition {
  id: string
  name: string
  description: string
  endpoint: string
}

/** MCP 服务器 / 工具清单。 */
export interface McpToolListing {
  id: string
  marketId: string
  name: string
  description: string
  /** 需要安装的 npm 包或命令。 */
  installHint?: string
  configSchema?: Record<string, unknown>
}

export interface McpImportRequest {
  marketId: string
  toolId: string
}

export interface McpImportResult {
  ok: boolean
  moduleId?: string
  message: string
}

// --- MCP 服务器连接管理 ---

/** MCP 服务器传输类型。 */
export type McpServerTransport = 'stdio' | 'http'

/** MCP 服务器配置。 */
export interface McpServerDefinition {
  id: string
  name: string
  description?: string
  transport: McpServerTransport
  /** stdio 模式：可执行命令（如 npx、node） */
  command?: string
  /** stdio 模式：启动参数 */
  args?: string[]
  /** stdio 模式：工作目录 */
  cwd?: string
  /** stdio 模式：环境变量 */
  env?: Record<string, string>
  /** http 模式：服务器 URL（如 https://mcp.soul:3000/mcp） */
  url?: string
  /** http 模式：API Key（可选） */
  apiKey?: string
  /** 是否启用 */
  enabled: boolean
  /** 创建时间 */
  createdAt?: string
  /** 最近连接时间 */
  lastConnectedAt?: string
  /** 连接状态 */
  status?: 'connected' | 'disconnected' | 'error'
  /** 错误信息 */
  lastError?: string
}

export interface McpServerAddRequest {
  name: string
  description?: string
  transport: McpServerTransport
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  apiKey?: string
}

export interface McpServerTestResult {
  ok: boolean
  message: string
  tools?: Array<{
    name: string
    description?: string
    serverId: string
    serverName: string
  }>
}

// --- dsh-plugin 插件市场 ---

/** dsh-plugin GitHub 仓库条目（来源于 github.com/topics/dsh-plugin）。 */
export interface DshPluginListing {
  /** 仓库完整名，如 owner/name。 */
  repo: string
  name: string
  description?: string
  /** GitHub 仓库地址。 */
  url: string
  /** 是否已导入。 */
  installed: boolean
  /** stars 数（仅 UI 展示）。 */
  stars?: number
  language?: string
  /** 最近更新时间。 */
  updatedAt?: string
}

/** 已导入的插件模块。 */
export interface InstalledPlugin {
  id: string
  repo: string
  name: string
  description: string
  version: string
  author: string
  installedAt: string
}

export interface PluginListRequest {
  query?: string
}

export interface PluginImportRequest {
  repo: string
  name: string
  description: string
}

export interface PluginImportResult {
  ok: boolean
  moduleId?: string
  message: string
}

// ============================================================================
// 默认内置模块定义
// ============================================================================

/** 内置模块清单（渲染进程可据此展示默认项；主进程为权威源）。 */
export const BUILTIN_AGENT_MODULES: Omit<AgentModuleDefinition, 'icon' | 'version'>[] = [
  {
    id: 'filesystem.workspace',
    name: '项目工作区文件',
    description: '在项目工作区根目录内读写、删除、移动、搜索文件（安全限定）。',
    kind: 'filesystem',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: true,
    risk: 'medium',
    toolNames: ['file_list', 'file_read', 'file_write', 'file_edit', 'file_delete', 'file_move', 'file_info', 'file_search'],
    author: 'CharacterArc'
  },
  {
    id: 'filesystem.system',
    name: '系统全目录访问',
    description: '允许访问计算机任意目录（含软件之外），实现「操作任意文件」能力。受权限门控。',
    kind: 'filesystem',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: false,
    risk: 'critical',
    toolNames: ['sysfs_list', 'sysfs_read', 'sysfs_write', 'sysfs_delete', 'sysfs_mkdir', 'sysfs_info'],
    author: 'CharacterArc'
  },
  {
    id: 'exec.shell',
    name: '代码 / 命令执行',
    description: '在沙箱内运行 shell / node / python 脚本，实现「写代码、跑脚本、自动化」。',
    kind: 'exec',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: false,
    risk: 'critical',
    toolNames: ['run_command', 'run_script'],
    author: 'CharacterArc'
  },
  {
    id: 'mcp.market',
    name: 'MCP 市场',
    description: '接入远程 mcp.soul 或本地 MCP 服务器，读写小说项目文件。',
    kind: 'mcp',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: false,
    risk: 'high',
    toolNames: ['novel_read_chapter', 'novel_write_chapter', 'novel_read_character', 'novel_write_character', 'novel_read_foreshadow', 'novel_write_foreshadow', 'novel_read_world', 'novel_write_world', 'novel_read_outline', 'novel_write_outline', 'mcp_list_markets', 'mcp_list_tools', 'mcp_call_tool'],
    author: 'CharacterArc'
  },
  {
    id: 'speech.asr',
    name: '语音转文字',
    description: '对接语音转文字 API、本地模型或 Windows 原生 WinRT 离线 ASR。',
    kind: 'speech',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: false,
    risk: 'low',
    toolNames: ['speech_transcribe'],
    author: 'CharacterArc'
  },
  {
    id: 'browser.ego',
    name: 'Ego 浏览器控制',
    description: '通过 ego-lite skill 操纵 ego 浏览器，实现「操作网页、填表、抓取」。',
    kind: 'browser',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: false,
    risk: 'medium',
    toolNames: ['ego_browser_*'],
    author: 'CharacterArc'
  },
  {
    id: 'automation.desktop',
    name: '桌面应用自动化',
    description: '打开并操作电脑上的应用（如微信回复消息），受权限门控。',
    kind: 'automation',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: false,
    risk: 'high',
    toolNames: ['desktop_app_open', 'desktop_app_send'],
    author: 'CharacterArc'
  },
  {
    id: 'multimedia.video',
    name: '视频剪辑',
    description: '调用 ffmpeg 等工具剪辑、拼接、转码视频。',
    kind: 'multimedia',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: false,
    risk: 'medium',
    toolNames: ['video_clip', 'video_merge', 'video_convert'],
    author: 'CharacterArc'
  },
  {
    id: 'knowledge.memory',
    name: '知识库与创作记忆',
    description: '跨会话创作记忆、知识文档、项目检索。',
    kind: 'knowledge',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: true,
    risk: 'low',
    toolNames: ['memory_*', 'knowledge_*'],
    author: 'CharacterArc'
  },
  {
    id: 'delegate.subagent',
    name: '子智能体委派',
    description: '把任务委派给子智能体，并行处理复杂工作流。',
    kind: 'delegate',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: true,
    risk: 'low',
    toolNames: ['delegate_*'],
    author: 'CharacterArc'
  },
  {
    id: 'network.http',
    name: '网络请求',
    description: '发起 HTTP 请求、抓取网页内容。',
    kind: 'network',
    source: 'builtin',
    scope: 'global',
    enabledByDefault: false,
    risk: 'medium',
    toolNames: ['http_request', 'http_fetch'],
    author: 'CharacterArc'
  }
]

// ============================================================================
// 对话流节点（自动折叠）
// ============================================================================

/** 对话流节点类型。用于会话中「节点自动折叠」的渲染。 */
export type FlowNodeKind =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'reasoning'
  | 'subagent'
  | 'staged'
  | 'milestone'

/** 对话流节点。前端据此渲染可折叠的节点树。 */
export interface FlowNode {
  id: string
  kind: FlowNodeKind
  title: string
  summary: string
  /** 子节点，用于折叠/展开。 */
  children?: FlowNode[]
  collapsed: boolean
  /** 状态：进行中/完成/失败。 */
  status?: 'running' | 'done' | 'error'
  meta?: Record<string, unknown>
}
