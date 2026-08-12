import {
  readdir,
  readFile,
  writeFile,
  stat,
  rm,
  rename,
  access,
  mkdir
} from 'node:fs/promises'
import { basename, join, relative, resolve, sep, extname, dirname } from 'node:path'
import type { Tool, ToolHandlerResult, ToolContext } from './types'

/**
 * 通用文件系统工具集（file_*）。
 *
 * 设计目标：让智能体具备像 Codex / Claude Code / OpenClaw 一样真正操作文件的能力，
 * 例如“帮我删除第一张封面图”“列出项目目录下有哪些文件”这类请求能落地执行，
 * 而不再只是回复“无法执行直接删除文件的操作”。
 *
 * 安全边界：
 *   - 所有读写路径都被强制限定在 `ctx.workspaceDir`（用户数据/工作区根）内，
 *     对工作区根之外的绝对路径一律拒绝。
 *   - 对会破坏应用自身的关键文件（workspace.db / workspace.json）与工作区根本身
 *     的删除/移动/写入一律拦截。
 *   - 删除前必须显式确认 `recursive` 语义，防止误删目录。
 */

/** 禁止被删除/移动/覆盖的应用关键文件（相对工作区根的 basename）。 */
const PROTECTED_FILES: ReadonlySet<string> = new Set([
  'workspace.db',
  'workspace.db-wal',
  'workspace.db-shm',
  'workspace.json'
])

/** 禁止被写入覆盖的应用关键文件（相对工作区根的 basename）。 */
const PROTECTED_WRITE_FILES: ReadonlySet<string> = new Set([
  'workspace.db',
  'workspace.db-wal',
  'workspace.db-shm',
  'workspace.json'
])

/** 单文件读取的最大字符数，避免吞掉过大文件占满上下文。 */
const MAX_READ_CHARS = 60_000
/** 目录列举一次返回的最大条目数。 */
const MAX_LIST_ENTRIES = 500
/** 单次写入最大字节数（约 4MB），防止模型构造超大 payload。 */
const MAX_WRITE_BYTES = 4 * 1024 * 1024

function ok(content: string): ToolHandlerResult {
  return { content }
}

function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

function requireWorkspaceDir(ctx: ToolContext): { dir: string } | { error: string } {
  const dir = ctx.workspaceDir?.trim()
  if (!dir) return { error: '工作区根目录未就绪（workspaceDir 缺失），无法执行文件操作。' }
  return { dir }
}

/**
 * 把用户传入的（相对或绝对）路径解析为工作区内的绝对路径。
 * - 相对路径基于 workspaceDir 解析。
 * - 绝对路径必须是 workspaceDir 内的路径，否则拒绝（防路径穿越）。
 */
function resolveInsideWorkspace(
  workspaceDir: string,
  inputPath: string
): { abs: string; rel: string } | { error: string } {
  const p = String(inputPath ?? '').trim()
  if (!p) {
    return { error: '缺少路径参数 path。' }
  }
  const abs = resolve(workspaceDir, p)
  const rel = relative(workspaceDir, abs)
  // 防止越界：相对路径以 .. 逃逸到工作区根之外，或绝对路径指向工作区外，一律拒绝。
  const isInside = rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith('..'))
  if (!isInside) {
    return { error: `路径 ${p} 超出工作区目录范围，已拒绝。工作区根：${workspaceDir}` }
  }
  return { abs, rel }
}

/** 判断工作区内相对路径是否命中保护文件（禁止删除/移动/覆盖）。 */
function isProtected(rel: string): boolean {
  const base = basename(rel)
  if (PROTECTED_FILES.has(base)) return true
  // 保护工作区根本身
  if (rel === '') return true
  return false
}

function isProtectedWrite(rel: string): boolean {
  return PROTECTED_WRITE_FILES.has(basename(rel))
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatEntryType(entry: { isDirectory: () => boolean; isFile: () => boolean }): string {
  if (entry.isDirectory()) return 'dir'
  if (entry.isFile()) return 'file'
  return 'other'
}

/**
 * 创建文件系统工具集。
 * @param opts.workspaceDir - 可选的工作区根；缺省时从 ToolContext.workspaceDir 取。
 *                            renderer 侧对话场景由 execution-plan 注入。
 */
export function createFileTools(opts?: { workspaceDir?: string }): Tool[] {
  /** 取得实际工作区根：优先 opts 显式指定，否则回落到 ctx。 */
  function getRoot(ctx: ToolContext): { dir: string } | { error: string } {
    if (opts?.workspaceDir?.trim()) return { dir: opts.workspaceDir.trim() }
    return requireWorkspaceDir(ctx)
  }

  /** 解析路径并返回工作区内的 {abs, rel}，失败返回错误对象。 */
  function resolveOrError(
    root: string,
    inputPath: string
  ): { abs: string; rel: string } | { error: string } {
    const r = resolveInsideWorkspace(root, inputPath)
    if ('error' in r) return { error: r.error }
    return r
  }

  /** 列出目录内容 */
  const fileList: Tool = {
    definition: {
      name: 'file_list',
      description:
        '列出工作区内某个目录下的条目（文件/子目录）。默认列出工作区根。返回每个条目的名称、类型与大小。当用户要求“列出文件 / 目录里有什么 / 有哪些封面图 / 我的作品文件在哪”等时使用。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标目录路径，相对工作区根。缺省为工作区根。' },
          max: { type: 'number', description: '最多返回多少条，默认 200，上限 500。' }
        }
      }
    },
    async handler(input, ctx) {
      const rootRes = getRoot(ctx)
      if ('error' in rootRes) return err(rootRes.error)
      const root = rootRes.dir

      const p = String(input.path ?? '').trim()
      const target = p ? join(root, p) : root
      const resolved = resolveInsideWorkspace(root, target)
      if ('error' in resolved) return err(resolved.error)

      let max = Number(input.max ?? 200)
      if (!Number.isFinite(max) || max <= 0) max = 200
      max = Math.min(max, MAX_LIST_ENTRIES)

      let st
      try {
        st = await stat(resolved.abs)
      } catch (e) {
        return err(`无法访问目录 ${resolved.rel || '(工作区根)'}：${e instanceof Error ? e.message : String(e)}`)
      }
      if (!st.isDirectory()) {
        return err(`${resolved.rel || '(工作区根)'} 不是目录，无法列出。`)
      }

      let entries
      try {
        entries = await readdir(resolved.abs, { withFileTypes: true })
      } catch (e) {
        return err(`读取目录失败：${e instanceof Error ? e.message : String(e)}`)
      }

      const lines: string[] = []
      for (const entry of entries.slice(0, max)) {
        const entryPath = join(resolved.abs, entry.name)
        let size = ''
        try {
          const es = await stat(entryPath)
          if (entry.isFile()) size = `, ${formatBytes(es.size)}`
          else if (entry.isDirectory()) size = ', (dir)'
        } catch {
          // ignore
        }
        lines.push(`- ${entry.name} [${formatEntryType(entry)}]${size}`)
      }

      const total = entries.length
      const truncated = total > max ? `\n…（共 ${total} 条，仅显示前 ${max} 条）` : ''
      return ok(`目录：${resolved.rel || '(工作区根)'}（共 ${total} 项）\n${lines.join('\n')}${truncated}`)
    }
  }

  /** 读取文本文件 */
  const fileRead: Tool = {
    definition: {
      name: 'file_read',
      description:
        '读取工作区内一个文本文件的全部内容（超过 60000 字符会被截断）。当用户要求“读取某个文件 / 看看文件内容 / 打开某张卡片的文件”等时使用。二进制文件（图片/压缩包）请改用 file_info 查看元信息。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标文件路径，相对工作区根。' }
        },
        required: ['path']
      }
    },
    async handler(input, ctx) {
      const rootRes = getRoot(ctx)
      if ('error' in rootRes) return err(rootRes.error)
      const root = rootRes.dir
      const r = resolveOrError(root, String(input.path ?? ''))
      if ('error' in r) return err(r.error)

      let st
      try {
        st = await stat(r.abs)
      } catch (e) {
        return err(`无法访问文件 ${r.rel}：${e instanceof Error ? e.message : String(e)}`)
      }
      if (st.isDirectory()) return err(`${r.rel} 是目录，请用 file_list 查看目录内容。`)

      try {
        const buf = await readFile(r.abs)
        const text = buf.toString('utf-8')
        const truncated = text.length > MAX_READ_CHARS
        const shown = truncated ? text.slice(0, MAX_READ_CHARS) : text
        const notice = truncated
          ? `\n\n…（文件共 ${text.length} 字符，已截断显示前 ${MAX_READ_CHARS} 字符）`
          : ''
        return ok(`文件：${r.rel}（${formatBytes(buf.length)}）\n${shown}${notice}`)
      } catch (e) {
        return err(`读取文件 ${r.rel} 失败（可能不是文本或已损坏）：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /** 写入 / 创建文件 */
  const fileWrite: Tool = {
    definition: {
      name: 'file_write',
      description:
        '在工作区内写入或覆盖一个文本文件（会自动创建父目录）。用于“创建/保存/写入文件”类请求。注意：不会覆盖工作区关键数据文件（workspace.db / workspace.json）。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标文件路径，相对工作区根。' },
          content: { type: 'string', description: '要写入的完整文本内容。' },
          append: { type: 'boolean', description: '若为 true 则在文件末尾追加而非覆盖。缺省 false。' }
        },
        required: ['path', 'content']
      }
    },
    async handler(input, ctx) {
      const rootRes = getRoot(ctx)
      if ('error' in rootRes) return err(rootRes.error)
      const root = rootRes.dir
      const r = resolveOrError(root, String(input.path ?? ''))
      if ('error' in r) return err(r.error)
      if (r.rel === '') return err('不能写入工作区根目录本身。')

      const content = String(input.content ?? '')
      if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE_BYTES) {
        return err(`写入内容过大（超过 ${MAX_WRITE_BYTES} 字节上限）。`)
      }
      if (isProtectedWrite(r.rel)) {
        return err(`文件 ${r.rel} 是应用关键数据，禁止写入覆盖。`)
      }
      if (extname(r.abs).toLowerCase() === '.db') {
        return err(`出于安全考虑，禁止直接写入数据库文件 ${r.rel}。请改用对应的项目数据工具。`)
      }

      const append = input.append === true
      try {
        if (!append) {
          // 确保父目录存在
          await mkdir(dirname(r.abs), { recursive: true })
        }
        await writeFile(r.abs, content, append ? { flag: 'a' } : undefined)
        return ok(`已${append ? '追加到' : '写入'}文件：${r.rel}（${formatBytes(Buffer.byteLength(content, 'utf-8'))}）`)
      } catch (e) {
        return err(`写入文件 ${r.rel} 失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /** 精确替换文件中的文本片段 */
  const fileEdit: Tool = {
    definition: {
      name: 'file_edit',
      description:
        '在工作区内精确替换一个文本文件中的某段旧文本为新文本（单次替换第一处匹配）。比 file_write 更适合“把 A 改成 B”的小改动。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标文件路径，相对工作区根。' },
          old_text: { type: 'string', description: '要被替换的旧文本，需与文件内容精确匹配。' },
          new_text: { type: 'string', description: '替换后的新文本。' }
        },
        required: ['path', 'old_text', 'new_text']
      }
    },
    async handler(input, ctx) {
      const rootRes = getRoot(ctx)
      if ('error' in rootRes) return err(rootRes.error)
      const root = rootRes.dir
      const r = resolveOrError(root, String(input.path ?? ''))
      if ('error' in r) return err(r.error)
      if (isProtectedWrite(r.rel)) return err(`文件 ${r.rel} 是应用关键数据，禁止修改。`)

      const oldText = String(input.old_text ?? '')
      const newText = String(input.new_text ?? '')
      if (!oldText) return err('缺少 old_text 参数。')

      try {
        const original = await readFile(r.abs, 'utf-8')
        const idx = original.indexOf(oldText)
        if (idx === -1) {
          return err(`在文件 ${r.rel} 中未找到要替换的文本片段，请核对 old_text 与文件实际内容是否一致。`)
        }
        const updated = original.slice(0, idx) + newText + original.slice(idx + oldText.length)
        await writeFile(r.abs, updated)
        return ok(`已修改文件：${r.rel}（替换 1 处，共 ${updated.length} 字符）。`)
      } catch (e) {
        return err(`编辑文件 ${r.rel} 失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /** 删除文件 */
  const fileDelete: Tool = {
    definition: {
      name: 'file_delete',
      description:
        '删除工作区内的一个文件（或空目录）。当用户要求“删除/移除/删掉第一张图片、某个文件”时使用。安全保护：不会删除工作区根目录及 workspace.db / workspace.json 等关键数据文件；删除非空目录需设置 recursive=true。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要删除的文件或目录路径，相对工作区根。' },
          recursive: { type: 'boolean', description: '删除目录时若目录非空需设为 true（默认 false）。' }
        },
        required: ['path']
      }
    },
    async handler(input, ctx) {
      const rootRes = getRoot(ctx)
      if ('error' in rootRes) return err(rootRes.error)
      const root = rootRes.dir
      const r = resolveOrError(root, String(input.path ?? ''))
      if ('error' in r) return err(r.error)

      if (r.rel === '') return err('不能删除工作区根目录本身。')
      if (isProtected(r.rel)) return err(`文件 ${r.rel} 是应用关键数据，禁止删除。`)

      let st
      try {
        st = await stat(r.abs)
      } catch (e) {
        return err(`无法访问 ${r.rel}：${e instanceof Error ? e.message : String(e)}。可能文件不存在或路径有误。`)
      }

      if (st.isDirectory() && input.recursive !== true) {
        return err(`${r.rel} 是目录。若确认要删除该目录及其全部内容，请设置 recursive=true。`)
      }

      try {
        await rm(r.abs, { recursive: st.isDirectory(), force: true })
        return ok(`已删除：${r.rel}${st.isDirectory() ? '（整个目录）' : ''}`)
      } catch (e) {
        return err(`删除 ${r.rel} 失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /** 移动 / 重命名 */
  const fileMove: Tool = {
    definition: {
      name: 'file_move',
      description:
        '在工作区内移动或重命名一个文件/目录。当用户要求“把某文件移动到某处 / 改名”时使用。目标路径也必须位于工作区内。',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '源路径，相对工作区根。' },
          destination: { type: 'string', description: '目标路径（含新文件名），相对工作区根。' }
        },
        required: ['source', 'destination']
      }
    },
    async handler(input, ctx) {
      const rootRes = getRoot(ctx)
      if ('error' in rootRes) return err(rootRes.error)
      const root = rootRes.dir
      const src = resolveOrError(root, String(input.source ?? ''))
      if ('error' in src) return err(src.error)
      const dst = resolveOrError(root, String(input.destination ?? ''))
      if ('error' in dst) return err(dst.error)

      if (src.rel === '' || dst.rel === '') return err('不能移动工作区根目录。')
      if (isProtected(src.rel)) return err(`源文件 ${src.rel} 是应用关键数据，禁止移动。`)
      if (isProtected(dst.rel)) return err(`目标 ${dst.rel} 是应用关键数据，禁止移动。`)

      try {
        await mkdir(dirname(dst.abs), { recursive: true })
        await rename(src.abs, dst.abs)
        return ok(`已移动/重命名：${src.rel} → ${dst.rel}`)
      } catch (e) {
        return err(`移动失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /** 查看文件/目录元信息 */
  const fileInfo: Tool = {
    definition: {
      name: 'file_info',
      description:
        '查看工作区内文件或目录的元信息（类型、大小、修改时间）。对图片等二进制文件，用它确认文件存在与大小，无法查看内容。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标路径，相对工作区根。' }
        },
        required: ['path']
      }
    },
    async handler(input, ctx) {
      const rootRes = getRoot(ctx)
      if ('error' in rootRes) return err(rootRes.error)
      const root = rootRes.dir
      const r = resolveOrError(root, String(input.path ?? ''))
      if ('error' in r) return err(r.error)

      try {
        const st = await stat(r.abs)
        const kind = st.isDirectory() ? '目录' : st.isFile() ? '文件' : '其他'
        return ok(
          [
            `路径：${r.rel}`,
            `类型：${kind}`,
            `大小：${formatBytes(st.size)}`,
            `修改时间：${st.mtime.toISOString()}`,
            `是否可读：${(await canRead(r.abs)) ? '是' : '否'}`
          ].join('\n')
        )
      } catch (e) {
        return err(`无法访问 ${r.rel}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /** 按名字/扩展名在工作区内搜索文件 */
  const fileSearch: Tool = {
    definition: {
      name: 'file_search',
      description:
        '在工作区内按文件名关键字或扩展名递归搜索文件（不进入 node_modules / .git 等目录）。当用户要“找到某个文件 / 有哪些图片 / 查一下封面”时使用。',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '文件名包含的关键字（不区分大小写），缺省匹配全部。' },
          ext: { type: 'string', description: '按扩展名过滤，例如 png / jpg / txt / md，无需带点。' },
          max: { type: 'number', description: '最多返回多少条，默认 100，上限 500。' }
        }
      }
    },
    async handler(input, ctx) {
      const rootRes = getRoot(ctx)
      if ('error' in rootRes) return err(rootRes.error)
      const root = rootRes.dir
      const keyword = String(input.keyword ?? '').trim().toLowerCase()
      const ext = String(input.ext ?? '').trim().toLowerCase().replace(/^\./, '')
      let max = Number(input.max ?? 100)
      if (!Number.isFinite(max) || max <= 0) max = 100
      max = Math.min(max, 500)

      const results: Array<{ rel: string; size: number }> = []
      const visited = new Set<string>()
      const skipDirs = new Set(['node_modules', '.git', '.vite', 'dist', 'out', 'cache'])

      async function walk(dirAbs: string, depth: number): Promise<void> {
        if (depth > 8 || results.length >= max) return
        let entries
        try {
          entries = await readdir(dirAbs, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (results.length >= max) return
          const full = join(dirAbs, entry.name)
          if (entry.isDirectory()) {
            if (skipDirs.has(entry.name)) continue
            await walk(full, depth + 1)
            continue
          }
          if (!entry.isFile()) continue
          const rel = relative(root, full)
          const name = entry.name
          const extMatch = !ext || extname(name).toLowerCase().replace(/^\./, '') === ext
          const kwMatch = !keyword || name.toLowerCase().includes(keyword)
          if (extMatch && kwMatch) {
            const key = rel
            if (visited.has(key)) continue
            visited.add(key)
            let size = 0
            try {
              const s = await stat(full)
              size = s.size
            } catch {
              // ignore
            }
            results.push({ rel, size })
          }
        }
      }

      await walk(root, 0)

      if (results.length === 0) {
        return ok('未在工作区内找到匹配的文件。')
      }
      const truncated = results.length >= max ? `\n…（结果已超过 ${max} 条，仅显示前 ${max} 条）` : ''
      return ok(`找到 ${results.length} 个文件：\n${results
        .map((r) => `- ${r.rel}（${formatBytes(r.size)}）`)
        .join('\n')}${truncated}`)
    }
  }

  return [fileList, fileRead, fileWrite, fileEdit, fileDelete, fileMove, fileInfo, fileSearch]
}

async function canRead(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
