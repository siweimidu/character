/**
 * SystemFilesystemModule · 系统全目录访问模块
 *
 * 实现「操作软件以外的目录」的能力：让全局智能体像 Codex / Claude Code /
 * OpenClaw 一样，能够访问计算机上的任意目录（读取、写入、删除、创建、搜索）。
 *
 * 安全设计：
 *   - 该模块默认关闭，需用户显式启用（risk = critical）。
 *   - 与工作区受限的 file_* 工具不同，sysfs_* 工具可访问任意绝对路径。
 *   - 删除始终需要显式 recursive 语义，防止误删。
 *   - 保护操作系统与应用关键目录（如系统盘根、应用自身 userData）。
 */

import { readdir, readFile, writeFile, stat, rm, mkdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Tool, ToolHandlerResult, ToolContext } from '../../agent/tools/types'

/** 禁止删除/覆盖的系统关键目录 basename。 */
const PROTECTED_SYSTEM_DIRS: ReadonlySet<string> = new Set([
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'System32',
  'usr',
  'bin',
  'sbin',
  'etc',
  'lib',
  'Library',
  '.git'
])

const MAX_READ_CHARS = 60_000
const MAX_LIST_ENTRIES = 500
const MAX_WRITE_BYTES = 4 * 1024 * 1024

function ok(content: string): ToolHandlerResult {
  return { content }
}

function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function isProtectedPath(abs: string): boolean {
  const base = basename(abs)
  if (PROTECTED_SYSTEM_DIRS.has(base)) return true
  // 保护文件系统根
  if (abs === resolve('/')) return true
  return false
}

/**
 * 创建系统全目录文件系统工具集（sysfs_*）。
 * 该模块仅在被显式启用（registry.isEnabled('filesystem.system')）时注入。
 */
export function createSystemFileTools(): Tool[] {
  const list: Tool = {
    definition: {
      name: 'sysfs_list',
      description:
        '列出任意绝对路径目录下的内容。可访问软件工作区之外的任意目录（如 D:\\、/home、下载目录等）。返回目录/文件、大小与修改时间。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要列出的绝对目录路径。' }
        },
        required: ['path']
      }
    },
    handler: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolHandlerResult> => {
      const p = String(args.path ?? '').trim()
      if (!p) return err('缺少路径参数 path。')
      const abs = resolve(p)
      try {
        const entries = await readdir(abs, { withFileTypes: true })
        const out: string[] = []
        for (const entry of entries.slice(0, MAX_LIST_ENTRIES)) {
          let size = 0
          let modified = ''
          try {
            const st = await stat(join(abs, entry.name))
            size = st.size
            modified = st.mtime.toISOString().slice(0, 19)
          } catch {
            // ignore stat errors
          }
          const type = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other'
          out.push(`${type}\t${formatBytes(size)}\t${modified}\t${entry.name}`)
        }
        const truncated = entries.length > MAX_LIST_ENTRIES
        return ok(
          `目录 ${abs}（共 ${entries.length} 项${truncated ? `，仅显示前 ${MAX_LIST_ENTRIES} 项` : ''}）:\n${out.join('\n')}`
        )
      } catch (e) {
        return err(`无法列出目录 ${abs}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const read: Tool = {
    definition: {
      name: 'sysfs_read',
      description:
        '读取任意绝对路径的文件内容（最多前 6 万字）。可读取软件工作区之外的任意文件。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要读取的绝对文件路径。' }
        },
        required: ['path']
      }
    },
    handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
      const p = String(args.path ?? '').trim()
      if (!p) return err('缺少路径参数 path。')
      const abs = resolve(p)
      try {
        const st = await stat(abs)
        if (st.isDirectory()) return err(`${abs} 是目录，请用 sysfs_list 查看。`)
        const buf = await readFile(abs)
        const text = buf.toString('utf8')
        const truncated = text.length > MAX_READ_CHARS
        return ok(`文件 ${abs}（${formatBytes(st.size)}）:\n${text.slice(0, MAX_READ_CHARS)}${truncated ? '\n…（已截断）' : ''}`)
      } catch (e) {
        return err(`无法读取文件 ${abs}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const write: Tool = {
    definition: {
      name: 'sysfs_write',
      description:
        '写入内容到任意绝对路径文件（覆盖）。可写入软件工作区之外的任意文件。受权限门控。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要写入的绝对文件路径。' },
          content: { type: 'string', description: '要写入的文件内容。' }
        },
        required: ['path', 'content']
      }
    },
    handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
      const p = String(args.path ?? '').trim()
      if (!p) return err('缺少路径参数 path。')
      const content = String(args.content ?? '')
      const abs = resolve(p)
      if (isProtectedPath(abs)) return err(`路径 ${abs} 属于受保护系统区域，已拒绝写入。`)
      if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
        return err('内容过大（超过 4MB），请拆分写入。')
      }
      try {
        await writeFile(abs, content, 'utf8')
        return ok(`已写入 ${abs}（${formatBytes(Buffer.byteLength(content, 'utf8'))}）。`)
      } catch (e) {
        return err(`无法写入文件 ${abs}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const del: Tool = {
    definition: {
      name: 'sysfs_delete',
      description:
        '删除任意绝对路径的文件或目录。删除目录必须显式传入 recursive=true。受权限门控。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要删除的绝对路径。' },
          recursive: { type: 'boolean', description: '删除目录时需设为 true。' }
        },
        required: ['path']
      }
    },
    handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
      const p = String(args.path ?? '').trim()
      if (!p) return err('缺少路径参数 path。')
      const abs = resolve(p)
      const recursive = Boolean(args.recursive)
      if (isProtectedPath(abs)) return err(`路径 ${abs} 属于受保护系统区域，已拒绝删除。`)
      try {
        const st = await stat(abs)
        if (st.isDirectory() && !recursive) {
          return err(`${abs} 是目录，删除目录需显式传入 recursive=true。`)
        }
        await rm(abs, { recursive, force: true })
        return ok(`已删除 ${abs}。`)
      } catch (e) {
        return err(`无法删除 ${abs}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const mkdirTool: Tool = {
    definition: {
      name: 'sysfs_mkdir',
      description: '在任意绝对路径创建目录（含父目录）。受权限门控。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要创建的绝对目录路径。' }
        },
        required: ['path']
      }
    },
    handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
      const p = String(args.path ?? '').trim()
      if (!p) return err('缺少路径参数 path。')
      const abs = resolve(p)
      try {
        await mkdir(abs, { recursive: true })
        return ok(`已创建目录 ${abs}。`)
      } catch (e) {
        return err(`无法创建目录 ${abs}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const info: Tool = {
    definition: {
      name: 'sysfs_info',
      description: '获取任意绝对路径的文件/目录信息（是否存在、类型、大小、修改时间）。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要查询的绝对路径。' }
        },
        required: ['path']
      }
    },
    handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
      const p = String(args.path ?? '').trim()
      if (!p) return err('缺少路径参数 path。')
      const abs = resolve(p)
      try {
        const st = await stat(abs)
        const type = st.isDirectory() ? '目录' : st.isFile() ? '文件' : '其他'
        return ok(
          `路径 ${abs}\n类型: ${type}\n大小: ${formatBytes(st.size)}\n修改时间: ${st.mtime.toISOString()}`
        )
      } catch {
        return ok(`路径 ${abs} 不存在。`)
      }
    }
  }

  return [list, read, write, del, mkdirTool, info]
}
