/**
 * ExecModule · 代码 / 命令执行模块
 *
 * 让全局智能体具备「写代码、跑脚本、做自动化」的能力，类似 Codex / Claude Code。
 * 在受控沙箱内运行 shell / node / python 命令，受权限门控。
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { Tool, ToolHandlerResult, ToolContext } from '../../agent/tools/types'

const execAsync = promisify(exec)

/** 单条命令最大输出字符。 */
const MAX_OUTPUT_CHARS = 20_000
/** 命令超时（毫秒）。 */
const COMMAND_TIMEOUT_MS = 30_000

/**
 * 创建命令执行工具（run_command / run_script）。
 * 该模块仅在被显式启用（exec.shell）时注入。
 */
export function createExecTools(): Tool[] {
  const runCommand: Tool = {
    definition: {
      name: 'run_command',
      description:
        '在沙箱中运行一条 shell / 终端命令（如 ls、node、python、git）。可执行文件操作、脚本等自动化任务。受权限门控。',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令。' }
        },
        required: ['command']
      }
    },
    handler: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolHandlerResult> => {
      const command = String(args.command ?? '').trim()
      if (!command) return { content: '缺少命令参数 command。', isError: true }
      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024
        })
        const out = `${stdout || ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`
        const truncated = out.length > MAX_OUTPUT_CHARS
        return {
          content: `$ ${command}\n${out.slice(0, MAX_OUTPUT_CHARS)}${truncated ? '\n…（输出过长已截断）' : ''}`
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        return { content: `命令执行失败: ${errMsg}`, isError: true }
      }
    }
  }

  return [runCommand]
}
