/**
 * McpClient · MCP 协议客户端
 *
 * 支持两种传输方式：
 *   - stdio：本地 MCP 服务器（通过 child_process 启动并与其 stdin/stdout 通信）
 *   - http：远程 MCP 服务器（mcp.soul 等，通过 fetch + SSE 流式响应）
 *
 * 协议遵循 Model Context Protocol（MCP）规范的 JSON-RPC 2.0 消息格式。
 * 消息结构：
 *   initialize → tools/list → tools/call
 * 连接后先发送 initialize 握手，再列出可用工具，之后可按名称调用工具。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'

// ============================================================================
// 类型定义
// ============================================================================

/** MCP 服务器连接配置。 */
export type McpServerTransport = 'stdio' | 'http'

export interface McpServerConfig {
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
  /** 是否启用该连接 */
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

/** MCP 服务器上的工具定义（MCP 格式 → 应用格式转换）。 */
export interface McpRemoteTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  /** 所属服务器 id */
  serverId: string
  serverName: string
}

/** JSON-RPC 响应。 */
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** MCP 协议请求。 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

// ============================================================================
// 常量
// ============================================================================

/** 握手超时（毫秒）。 */
const HANDSHAKE_TIMEOUT_MS = 10_000
/** 工具调用超时（毫秒）。 */
const TOOL_CALL_TIMEOUT_MS = 60_000
/** 流式读取超时（毫秒）。 */
const STREAM_TIMEOUT_MS = 5_000
/** 最大输出字符数。 */
const MAX_OUTPUT_CHARS = 30_000

// ============================================================================
// MCP 客户端（stdio 本地服务器）
// ============================================================================

/**
 * 本地 MCP 客户端：通过 stdio 与子进程通信。
 * 使用 JSON-RPC 2.0 over stdin/stdout。
 */
export class StdioMcpClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private requestId = 0
  private pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>()
  private buffer = ''
  private handshakeDone = false
  private serverName: string

  constructor(serverName: string) {
    super()
    this.serverName = serverName
  }

  /**
   * 启动本地 MCP 服务器进程并完成握手。
   * @param command 可执行命令（npx、node 等）
   * @param args 启动参数
   * @param cwd 工作目录
   * @param env 环境变量
   */
  async connect(
    command: string,
    args: string[] = [],
    cwd?: string,
    env?: Record<string, string>
  ): Promise<void> {
    if (this.proc) {
      throw new Error('MCP 服务器已连接。')
    }

    try {
      this.proc = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (e) {
      throw new Error(`无法启动 MCP 服务器进程 ${command}: ${e instanceof Error ? e.message : String(e)}`)
    }

    this.proc.stdout.setEncoding('utf8')
    this.proc.stderr.setEncoding('utf8')

    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      this.processBuffer()
    })

    this.proc.stderr.on('data', (chunk: string) => {
      const text = chunk.toString().trim()
      if (text) {
        this.emit('stderr', text)
      }
    })

    this.proc.on('error', (err) => {
      this.emit('error', err)
    })

    this.proc.on('exit', (code) => {
      this.emit('exit', code)
      this.proc = null
      // 拒绝所有 pending 请求
      for (const { reject } of this.pending.values()) {
        reject(new Error('MCP 服务器进程已退出。'))
      }
      this.pending.clear()
    })

    // 发送 initialize 握手
    await this.initialize()
  }

  /** 发送初始化请求。 */
  private async initialize(): Promise<void> {
    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'character-arc',
          version: '1.0.0'
        }
      }
    }

    const response = await this.request(initRequest, HANDSHAKE_TIMEOUT_MS)
    if (response.error) {
      throw new Error(`MCP 初始化失败: ${response.error.message}`)
    }

    // 发送 initialized 通知（不需要响应）
    this.notify('notifications/initialized', {})

    // 发送 tools/list 确认工具可用
    await this.request(
      {
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'tools/list',
        params: {}
      },
      HANDSHAKE_TIMEOUT_MS
    ).catch(() => {})

    this.handshakeDone = true
    this.emit('connected')
  }

  /** 列出可用工具。 */
  async listTools(): Promise<McpRemoteTool[]> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/list',
      params: {}
    }

    const response = await this.request(request, TOOL_CALL_TIMEOUT_MS)
    if (response.error) {
      throw new Error(`列出 MCP 工具失败: ${response.error.message}`)
    }

    const result = response.result as { tools?: Array<Record<string, unknown>> }
    const rawTools = Array.isArray(result?.tools) ? result.tools : []
    return rawTools.map((tool) => ({
      name: String(tool.name ?? ''),
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: typeof tool.inputSchema === 'object' && tool.inputSchema !== null
        ? tool.inputSchema as Record<string, unknown>
        : undefined,
      serverId: '',
      serverName: this.serverName
    }))
  }

  /** 调用工具。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.handshakeDone) {
      throw new Error('MCP 服务器尚未完成握手。')
    }

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/call',
      params: {
        name,
        arguments: args ?? {}
      }
    }

    const response = await this.request(request, TOOL_CALL_TIMEOUT_MS)
    if (response.error) {
      throw new Error(`MCP 工具调用失败: ${response.error.message}`)
    }

    const result = response.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
    if (result?.isError) {
      const text = extractContentText(result.content)
      throw new Error(text || 'MCP 工具调用返回错误。')
    }

    const text = extractContentText(result?.content)
    return text || '（工具返回空结果）'
  }

  /** 关闭连接。 */
  async close(): Promise<void> {
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
    this.handshakeDone = false
    this.emit('disconnected')
  }

  get isConnected(): boolean {
    return this.proc !== null && this.handshakeDone
  }

  private nextId(): number {
    return ++this.requestId
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.proc) return
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params })
    this.proc.stdin.write(msg + '\n')
  }

  private request(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        reject(new Error('MCP 服务器未连接。'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(req.id)
        reject(new Error(`MCP 请求超时（${timeoutMs}ms）。`))
      }, timeoutMs)
      this.pending.set(req.id, {
        resolve: (resp) => {
          clearTimeout(timer)
          resolve(resp)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      const msg = JSON.stringify(req)
      this.proc.stdin.write(msg + '\n')
    })
  }

  private processBuffer(): void {
    // 按行解析（MCP 使用换行分隔 JSON 消息）
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line) as JsonRpcResponse
        if (msg.id !== undefined && this.pending.has(Number(msg.id))) {
          const handler = this.pending.get(Number(msg.id))
          this.pending.delete(Number(msg.id))
          if (handler) {
            handler.resolve(msg)
          }
        }
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}

// ============================================================================
// MCP 客户端（HTTP/SSE 远程服务器）
// ============================================================================

/**
 * 远程 MCP 客户端：通过 HTTP + SSE 与远程服务器通信。
 * mcp.soul 等远程 MCP 服务使用 HTTP 端点，支持 JSON-RPC over POST。
 */
export class HttpMcpClient extends EventEmitter {
  private baseUrl: string
  private apiKey?: string
  private requestId = 0
  private handshakeDone = false
  private serverName: string
  private eventSource: Readable | null = null

  constructor(serverName: string, url: string, apiKey?: string) {
    super()
    this.serverName = serverName
    this.baseUrl = url.replace(/\/+$/, '')
    this.apiKey = apiKey
  }

  /** 连接到远程服务器。 */
  async connect(): Promise<void> {
    if (this.handshakeDone) {
      return
    }

    try {
      await this.initialize()
      this.handshakeDone = true
      this.emit('connected')
    } catch (e) {
      this.handshakeDone = false
      throw e
    }
  }

  /** 发送初始化握手请求。 */
  private async initialize(): Promise<void> {
    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'character-arc',
          version: '1.0.0'
        }
      }
    }

    const response = await this.httpRequest(initRequest, HANDSHAKE_TIMEOUT_MS)
    if (response.error) {
      throw new Error(`MCP 远程连接失败: ${response.error.message}`)
    }

    // 发送 initialized 通知
    await this.httpRequest(
      {
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'notifications/initialized',
        params: {}
      },
      HANDSHAKE_TIMEOUT_MS
    ).catch(() => {})

    // 验证工具列表
    await this.listTools().catch(() => {})
  }

  /** 列出可用工具。 */
  async listTools(): Promise<McpRemoteTool[]> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/list',
      params: {}
    }

    const response = await this.httpRequest(request, TOOL_CALL_TIMEOUT_MS)
    if (response.error) {
      throw new Error(`列出远程 MCP 工具失败: ${response.error.message}`)
    }

    const result = response.result as { tools?: Array<Record<string, unknown>> }
    const rawTools = Array.isArray(result?.tools) ? result.tools : []
    return rawTools.map((tool) => ({
      name: String(tool.name ?? ''),
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: typeof tool.inputSchema === 'object' && tool.inputSchema !== null
        ? tool.inputSchema as Record<string, unknown>
        : undefined,
      serverId: '',
      serverName: this.serverName
    }))
  }

  /** 调用工具。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.handshakeDone) {
      throw new Error('远程 MCP 服务器尚未完成握手。')
    }

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/call',
      params: {
        name,
        arguments: args ?? {}
      }
    }

    const response = await this.httpRequest(request, TOOL_CALL_TIMEOUT_MS)
    if (response.error) {
      throw new Error(`远程 MCP 工具调用失败: ${response.error.message}`)
    }

    const result = response.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
    if (result?.isError) {
      const text = extractContentText(result.content)
      throw new Error(text || '远程 MCP 工具调用返回错误。')
    }

    const text = extractContentText(result?.content)
    return text || '（工具返回空结果）'
  }

  /** 关闭连接。 */
  async close(): Promise<void> {
    this.handshakeDone = false
    this.eventSource = null
    this.emit('disconnected')
  }

  get isConnected(): boolean {
    return this.handshakeDone
  }

  private nextId(): number {
    return ++this.requestId
  }

  private async httpRequest(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
        signal: controller.signal
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200) || res.statusText}`)
      }

      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        // SSE 流式响应：读取 event 中的 data 字段
        const raw = await res.text()
        const lines = raw.split('\n')
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim()
            try {
              const parsed = JSON.parse(jsonStr) as JsonRpcResponse
              if (parsed.id !== undefined && parsed.id === req.id) {
                return parsed
              }
            } catch {
              // 忽略无法解析的 SSE 数据
            }
          }
        }
        throw new Error('SSE 响应中未找到匹配的响应。')
      }

      // JSON 响应
      const data = (await res.json()) as JsonRpcResponse
      return data
    } finally {
      clearTimeout(timer)
    }
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/** 从 MCP 响应 content 数组中提取文本。 */
function extractContentText(content?: Array<{ type: string; text?: string }>): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((item) => item && typeof item.text === 'string')
    .map((item) => item.text!)
    .join('\n')
    .slice(0, MAX_OUTPUT_CHARS)
}

// ============================================================================
// 统一工厂：根据配置创建客户端实例
// ============================================================================

export type McpClientLike = {
  connect: () => Promise<void>
  listTools: () => Promise<McpRemoteTool[]>
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>
  close: () => Promise<void>
  isConnected: boolean
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
  emit: (event: string, ...args: unknown[]) => boolean
}

/** 根据服务器配置创建对应传输类型的客户端。 */
export function createMcpClient(config: McpServerConfig): McpClientLike {
  if (config.transport === 'stdio') {
    const client = new StdioMcpClient(config.name)
    return {
      connect: () => client.connect(config.command ?? 'npx', config.args ?? [], config.cwd, config.env),
      listTools: () => client.listTools(),
      callTool: (name, args) => client.callTool(name, args),
      close: () => client.close(),
      get isConnected() { return client.isConnected },
      on: (event, listener) => client.on(event, listener as (...args: unknown[]) => void),
      emit: (event, ...args) => client.emit(event, ...args)
    }
  }

  if (config.transport === 'http') {
    const client = new HttpMcpClient(config.name, config.url ?? '', config.apiKey)
    return {
      connect: () => client.connect(),
      listTools: () => client.listTools(),
      callTool: (name, args) => client.callTool(name, args),
      close: () => client.close(),
      get isConnected() { return client.isConnected },
      on: (event, listener) => client.on(event, listener as (...args: unknown[]) => void),
      emit: (event, ...args) => client.emit(event, ...args)
    }
  }

  throw new Error(`不支持的 MCP 传输类型: ${config.transport}`)
}
