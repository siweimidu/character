/**
 * Agent Modules · 全局智能体模块系统
 *
 * 模块化能力系统：文件系统、代码执行、MCP、浏览器、语音、桌面自动化等
 * 全部以「模块」形式注册，可独立启停。借鉴 DeepSeek Harness「everything is
 * a plugin」的架构思想。
 */

export { AgentModuleRegistry, InMemoryModuleStore } from './registry'
export type {
  AgentModuleRegistration,
  AgentModuleStore,
  ModuleToolFactory,
  ModuleToolFactoryContext
} from './registry'
export {
  initAgentModuleRegistry,
  getAgentModuleRegistry,
  resetAgentModuleRegistryForTest
} from './bootstrap'
export { registerAgentModuleIpcHandlers } from './ipc'
export { createSystemFileTools } from './tools/system-filesystem'
export { createExecTools } from './tools/exec'
export { createMcpTools, KNOWN_MCP_MARKETS } from './tools/mcp'
