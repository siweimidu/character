/**
 * AgentModuleRegistry · 全局智能体模块注册中心
 *
 * 借鉴 DeepSeek Harness「everything is a plugin」的架构思想：
 * 所有能力（文件系统、代码执行、浏览器、MCP、语音、桌面自动化等）都注册为
 * 可独立启停的模块。核心智能体循环不感知具体能力，只通过模块注册表按需注入
 * 已启用的模块所贡献的工具。
 *
 * 这样新增一种能力 = 注册一个新模块，无需改动智能体核心；也满足用户
 * 「全局智能体的一切都要模块化」的核心诉求。
 */

import type {
  AgentModuleDefinition,
  AgentModuleKind,
  AgentModuleRuntime,
  AgentModuleScope
} from '@shared/agent-modules'
import { BUILTIN_AGENT_MODULES } from '@shared/agent-modules'

/** 模块工具工厂：给定运行上下文，产出该模块注入的工具。 */
export interface ModuleToolFactoryContext {
  /** 当前项目 ID。 */
  projectId?: string
  /** 会话 ID。 */
  sessionId: string
  /** 轮次 ID。 */
  turnId: string
  /** 模块配置。 */
  config: Record<string, unknown>
}

/** 模块工具工厂：把模块配置展开为具体工具集。 */
export type ModuleToolFactory = (ctx: ModuleToolFactoryContext) => unknown[]

/** 模块注册项：定义 + 工具工厂 + 持久化状态。 */
export interface AgentModuleRegistration {
  definition: AgentModuleDefinition
  /** 注入工具的工厂。缺省时该模块不注入工具（纯能力声明 / UI 开关）。 */
  createTools?: ModuleToolFactory
}

/** 模块启停状态存储接口（主进程持久化）。 */
export interface AgentModuleStore {
  getEnabled: (id: string) => boolean | undefined
  setEnabled: (id: string, enabled: boolean) => void
  getConfig: (id: string) => Record<string, unknown> | undefined
  setConfig: (id: string, config: Record<string, unknown>) => void
  touch: (id: string) => void
  lastUsedAt?: (id: string) => string | undefined
  usageCount?: (id: string) => number
}

/** 内存版状态存储（未接入 SQLite 前的默认实现，应用重启后回落到 enabledByDefault）。 */
export class InMemoryModuleStore implements AgentModuleStore {
  private enabled = new Map<string, boolean>()
  private configs = new Map<string, Record<string, unknown>>()
  private lastUsed = new Map<string, number>()
  private usage = new Map<string, number>()

  getEnabled(id: string): boolean | undefined {
    return this.enabled.get(id)
  }
  setEnabled(id: string, enabled: boolean): void {
    this.enabled.set(id, enabled)
  }
  getConfig(id: string): Record<string, unknown> | undefined {
    return this.configs.get(id)
  }
  setConfig(id: string, config: Record<string, unknown>): void {
    this.configs.set(id, config)
  }
  touch(id: string): void {
    this.lastUsed.set(id, Date.now())
    this.usage.set(id, (this.usage.get(id) ?? 0) + 1)
  }
  lastUsedAt(id: string): string | undefined {
    const t = this.lastUsed.get(id)
    return t ? new Date(t).toISOString() : undefined
  }
  usageCount(id: string): number {
    return this.usage.get(id) ?? 0
  }
}

/**
 * 全局智能体模块注册中心。
 */
export class AgentModuleRegistry {
  private registrations = new Map<string, AgentModuleRegistration>()
  private store: AgentModuleStore

  constructor(store: AgentModuleStore = new InMemoryModuleStore()) {
    this.store = store
    // 注册全部内置模块（默认无工具工厂，由各能力模块自行覆盖）
    for (const def of BUILTIN_AGENT_MODULES) {
      this.register({
        definition: {
          ...def,
          icon: defaultIconForKind(def.kind),
          version: '1.0.0'
        }
      })
    }
  }

  /** 注册一个模块（可覆盖内置定义）。 */
  register(reg: AgentModuleRegistration): void {
    if (!reg.definition.id) return
    this.registrations.set(reg.definition.id, reg)
  }

  /** 注销一个模块。 */
  unregister(id: string): void {
    this.registrations.delete(id)
  }

  /** 获取模块定义（忽略启停状态）。 */
  getDefinition(id: string): AgentModuleDefinition | undefined {
    return this.registrations.get(id)?.definition
  }

  /** 获取模块运行时状态（含启用开关、使用统计）。 */
  getRuntime(id: string): AgentModuleRuntime | undefined {
    const reg = this.registrations.get(id)
    if (!reg) return undefined
    const stored = this.store.getEnabled(id)
    return {
      ...reg.definition,
      enabled: stored ?? reg.definition.enabledByDefault,
      lastUsedAt: this.store.lastUsedAt?.(id),
      usageCount: this.store.usageCount?.(id) ?? 0
    }
  }

  /** 列出全部模块（可按范围 / 大类过滤）。 */
  list(opts?: { scope?: AgentModuleScope; kind?: AgentModuleKind }): AgentModuleRuntime[] {
    const all: AgentModuleRuntime[] = []
    for (const id of this.registrations.keys()) {
      const rt = this.getRuntime(id)
      if (!rt) continue
      if (opts?.scope && rt.scope !== opts.scope) continue
      if (opts?.kind && rt.kind !== opts.kind) continue
      all.push(rt)
    }
    // 保持内置模块顺序
    const order = new Map(BUILTIN_AGENT_MODULES.map((m, i) => [m.id, i]))
    return all.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
  }

  /** 设置模块启用状态。 */
  setEnabled(id: string, enabled: boolean): boolean {
    if (!this.registrations.has(id)) return false
    this.store.setEnabled(id, enabled)
    return true
  }

  /** 判断模块是否启用。 */
  isEnabled(id: string): boolean {
    const rt = this.getRuntime(id)
    return rt ? rt.enabled : false
  }

  /** 获取模块配置。 */
  getConfig(id: string): Record<string, unknown> {
    return this.store.getConfig(id) ?? {}
  }

  /** 设置模块配置。 */
  setConfig(id: string, config: Record<string, unknown>): void {
    this.store.setConfig(id, config)
  }

  /** 记录一次使用。 */
  touch(id: string): void {
    this.store.touch(id)
  }

  /** 组装某会话当前启用的全部工具。 */
  assembleTools(ctx: ModuleToolFactoryContext): unknown[] {
    const tools: unknown[] = []
    for (const id of this.registrations.keys()) {
      if (!this.isEnabled(id)) continue
      const reg = this.registrations.get(id)
      if (!reg?.createTools) continue
      const produced = reg.createTools({ ...ctx, config: this.getConfig(id) })
      if (produced && produced.length > 0) {
        tools.push(...produced)
        this.store.touch(id)
      }
    }
    return tools
  }
}

/** 默认图标名（lucide）。 */
function defaultIconForKind(kind: AgentModuleKind): string {
  switch (kind) {
    case 'filesystem':
      return 'FolderTree'
    case 'exec':
      return 'Terminal'
    case 'browser':
      return 'Globe'
    case 'mcp':
      return 'Plug'
    case 'speech':
      return 'Mic'
    case 'automation':
      return 'AppWindow'
    case 'multimedia':
      return 'Film'
    case 'knowledge':
      return 'BookOpen'
    case 'delegate':
      return 'Users'
    case 'network':
      return 'Network'
    case 'plugin':
      return 'Puzzle'
    default:
      return 'Box'
  }
}
