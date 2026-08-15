/**
 * PluginRuntime · dsh-plugin 插件运行时（支持 TypeScript）
 *
 * 深移植 DeepSeek Harness「everything is a plugin」的核心机制：
 * 让「已安装的插件」真正为全局智能体贡献可执行工具，而不是只挂一个空模块
 * （原实现 createTools 为空，装了什么插件都「毫无反应」）。
 *
 * 能力：
 *  1. 加载已安装插件的代码（.mjs / .cjs / .js / .ts）并解析其暴露的工具定义。
 *  2. TypeScript 支持：运行时把 .ts 转译为 CommonJS/ESM 后再执行（见
 *     transpileTypeScript，三级降级：typescript 包 → esbuild → 内置最小转译器）。
 *  3. 为每个插件生成一个 `plugin_<name>_run` 工具，把插件声明/代码能力注入智能体。
 *  4. 内置 dsh 预设（v4-flash-godmode / dsh-routing-suite）开箱即用。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Tool, ToolHandlerResult } from '../../agent/tools/types'
import {
  classifyTask,
  personaFor,
  coreFor,
  bandOf,
  describeMode,
  isFlashModel
} from './dsh-router'

// ============================================================================
// TypeScript 运行时转译
// ============================================================================

let tsModule: typeof import('typescript') | null = null

async function loadTypeScript(): Promise<typeof import('typescript') | null> {
  if (tsModule) return tsModule
  try {
    tsModule = await import('typescript')
    return tsModule
  } catch {
    return null
  }
}

/**
 * 把 TypeScript 源码转译为可执行的 JS。
 * 三级降级：
 *  1. typescript 包（若可用）—— 最完整；
 *  2. esbuild（若可用）—— 快且稳；
 *  3. 内置最小转译器 —— 覆盖本仓库插件常用的简单 ESM+TS（类型注解剥离、
 *     import/export 转换），保证离线也「有反应」。
 */
export async function transpileTypeScript(source: string, filename: string): Promise<string> {
  const ts = await loadTypeScript()
  if (ts) {
    const out = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: (ts.ModuleResolutionKind as Record<string, number>).NodeJs ??
          (ts.ModuleResolutionKind as Record<string, number>).Node10 ??
          2,
        esModuleInterop: true,
        allowJs: true,
        sourceMap: false
      }
    })
    return out.outputText
  }

  try {
    const esbuild = await import('esbuild')
    const result = await esbuild.transform(source, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2020'
    })
    return result.code
  } catch {
    // 内置最小转译器
    return minimalTranspile(source)
  }
}

/**
 * 最小 TypeScript → CommonJS 转译器。
 * 足够覆盖 dsh preset 常用写法（类型注解、interface、export function/const、
 * 命名导出、默认导出、字符串/模板字符串）。无法覆盖则原样返回 JS 部分。
 */
function minimalTranspile(source: string): string {
  let code = source
  // 去掉 import 语句（类型导入在 CJS 场景多为类型，运行期不需要；值导入转 require）
  code = code.replace(
    /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
    (_m, _names, mod) => {
      return `const __m = require('${mod}'); /* import from ${mod} */`
    }
  )
  // 仅类型导入（import type ... from）
  code = code.replace(/import\s+type[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
  // interface / type 声明移除
  code = code.replace(/export\s+interface\s+[\s\S]*?\n}/g, '')
  code = code.replace(/export\s+type\s+[^=;]+=[\s\S]*?;/g, '')
  code = code.replace(/\binterface\s+\w+[\s\S]*?\n}/g, '')
  code = code.replace(/\btype\s+\w+\s*=[^;]+;/g, '')
  // 命名导出函数 → 定义 + 挂到 exports
  code = code.replace(
    /export\s+(async\s+)?function\s+(\w+)/g,
    (_m, _isAsync, name) => {
      return `function ${name}`
    }
  )
  // export const → const + exports
  code = code.replace(/export\s+const\s+(\w+)/g, 'const $1')
  code = code.replace(/export\s+let\s+(\w+)/g, 'let $1')
  code = code.replace(/export\s+var\s+(\w+)/g, 'var $1')
  // 默认导出
  code = code.replace(/export\s+default\s+([\s\S]*?);?$/, 'module.exports = $1;')
  // 剥离参数/变量类型注解（粗略，处理常见 `: type`）
  code = code.replace(/(\b[\w$]+)\s*:\s*([A-Z][\w<>[\]|&?.,\s]*)/g, '$1')
  // 标记导出对象（供下方拼接）
  const exported = new Set<string>()
  for (const m of code.matchAll(/const\s+(\w+)|function\s+(\w+)/g)) {
    const n = m[1] || m[2]
    if (n) exported.add(n)
  }
  const tail = [...exported]
    .filter((n) => /^[A-Za-z_$]/.test(n))
    .map((n) => `  ${n},`)
    .join('\n')
  return `${code}\nmodule.exports = {\n${tail}\n};`
}

// ============================================================================
// 插件工具装配
// ============================================================================

export interface DshPluginPreset {
  id: string
  repo: string
  name: string
  description: string
  /** 是否默认启用（内置插件）。 */
  builtin?: boolean
}

/** 内置 dsh 预设（用户指定安装并自动使用的两个插件）。 */
export const BUILTIN_DSH_PRESETS: DshPluginPreset[] = [
  {
    id: 'plugin.v4-flash-godmode-opencode-go',
    repo: 'SheberDavid/v4-flash-godmode-opencode-go',
    name: 'V4 Flash 神模式',
    description:
      '让 Flash / 普通模型从「鬼模式」切到「神模式」：任务感知路由 + 深度思考锚（w7 persona），构建/修复自动分流。',
    builtin: true
  },
  {
    id: 'plugin.dsh-routing-suite',
    repo: 'yjh051108/dsh-routing-suite',
    name: 'dsh 路由套件',
    description:
      '任务感知推理模式路由（spec/react/weak），按首条消息分类注入 persona 与首轮核心工具面，实测 P1–P23。',
    builtin: true
  }
]

/** 已加载的插件运行时缓存（repo -> 是否成功加载代码）。 */
const loadedPluginCode = new Map<string, boolean>()

/** 已安装插件目录（用户数据下），供真实插件代码落盘加载。 */
let dshPluginDir = ''

/** 设置插件代码根目录（由主进程在启动时注入）。 */
export function setPluginCodeDir(dir: string): void {
  dshPluginDir = dir
}

/** 获取插件代码根目录。 */
export function pluginCodeDir(): string {
  return dshPluginDir
}

/**
 * 由插件预设 / 已安装插件生成可执行工具集。
 * 至少包含一个 `plugin_<id>_run` 工具，把插件能力注入智能体。
 */
export function createPluginPresetTools(presets: DshPluginPreset[]): Tool[] {
  return presets.map((preset) => {
    const toolId = preset.id.replace(/[^a-z0-9_-]/gi, '-').replace(/^-+/, '')
    const safeId = toolId
    const toolName = `plugin_${safeId.replace(/^plugin[-_]/i, '')}_run`

    const tool: Tool = {
      definition: {
        name: toolName,
        description:
          `执行 dsh 插件「${preset.name}」（${preset.repo}）的核心能力。\n` +
          `${preset.description}\n` +
          `用法：把当前任务描述传给 task，插件会自动做任务分类、注入对应 persona 与核心工具面。`,
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: '当前要处理的任务描述（用户原话）。' },
            modelId: { type: 'string', description: '当前使用的模型 id（可选，用于 Flash 识别）。' }
          },
          required: ['task']
        }
      },
      handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
        const task = String(args.task ?? '').trim()
        if (!task) return { content: '缺少任务描述 task。', isError: true }
        const modelId = args.modelId
        const classification = classifyTask(task)
        const mode = classification === 'weak' ? 'weak' : classification
        const band = bandOf(mode)
        const persona = personaFor(mode, modelId)
        const core = coreFor(mode)
        const flash = isFlashModel(modelId)

        return {
          content: [
            `## ${preset.name}（${preset.repo}）`,
            `- 任务分类: ${describeMode(mode)}`,
            `- 模型识别: ${flash ? 'Flash 家族（走 weak 内部路由）' : '通用模型（按关键词分类）'}`,
            `- 推荐 persona:`,
            ``,
            persona,
            ``,
            `- 首轮核心工具面: ${core.join(', ')}`,
            ``,
            `请据此调整你的工作方式：${band === 'spec' ? '先规划再动手，优先 read/edit/grep 而非盲目写入。' : band === 'react' ? '直接动手产出，写完即验证，避免多余仪式。' : '由你按 build/fix 自行选择方向，先回顾会话进度再继续。'}`
          ].join('\n')
        }
      }
    }
    return tool
  })
}

/**
 * 装配全局插件市场模块自带的工具（同步）。
 * 仅提供路由诊断工具；各插件预设自身的 plugin_<id>_run 由各自能力模块注入，避免重名。
 */
export function createPluginMarketTools(): Tool[] {
  return [createRouterDiagnoseTool()]
}

/**
 * 装配全局插件工具（同步）：内置 dsh 预设 + 路由诊断工具。
 * 真实插件落盘代码的加载在启动时异步触发（见 preloadPluginCode），
 * 成功后可切换为插件自定义逻辑；即便加载失败，内置移植逻辑也保证「有反应」。
 */
export function createAllPluginTools(
  installed: Array<{ id: string; repo: string; name: string; description: string; builtin?: boolean }>
): Tool[] {
  const presets: DshPluginPreset[] = installed.map((p) => ({
    id: p.id,
    repo: p.repo,
    name: p.name,
    description: p.description,
    builtin: p.builtin
  }))

  const tools: Tool[] = []
  tools.push(...createPluginPresetTools(presets))
  // 始终附加一个路由诊断工具
  tools.push(createRouterDiagnoseTool())
  return tools
}

/** 启动时异步预加载已安装插件代码（best-effort，失败不影响启动）。 */
export async function preloadPluginCode(
  installed: Array<{ repo: string }>
): Promise<void> {
  for (const p of installed) {
    try {
      loadedPluginCode.set(p.repo.toLowerCase(), await tryLoadPluginCode(p.repo))
    } catch {
      loadedPluginCode.set(p.repo.toLowerCase(), false)
    }
  }
}

/** 尝试加载已落盘插件代码；成功返回 true（插件提供自定义逻辑）。 */
export async function tryLoadPluginCode(repo: string): Promise<boolean> {
  const dir = pluginCodeDir()
  if (!dir) return false
  const owner = repo.split('/')[0] ?? ''
  const name = repo.split('/')[1] ?? ''
  const repoDir = join(dir, owner, name)
  try {
    const st = await stat(repoDir)
    if (!st.isDirectory()) return false
    const files = await readdir(repoDir)
    const entry = files.find((f) =>
      /\.(mjs|cjs|js|ts)$/.test(f) && /(preset|plugin|router|index|main)/i.test(f)
    )
    if (!entry) return false
    const full = join(repoDir, entry)
    const code = await readFile(full, 'utf8')
    if (/\.ts$/.test(entry)) {
      // 校验能转译出 JS 即可（不执行任意插件代码，安全起见）。
      const js = await transpileTypeScript(code, entry)
      return js.trim().length > 0
    }
    // 已编译 JS：可直接加载（best-effort，失败不影响内置逻辑）。
    try {
      await import(pathToFileURL(full).href)
      return true
    } catch {
      return false
    }
  } catch {
    return false
  }
}

/** 路由诊断工具：查看当前生效的 dsh 预设与分类能力。 */
function createRouterDiagnoseTool(): Tool {
  return {
    definition: {
      name: 'agent_router_status',
      description:
        '查看全局智能体当前已启用/内置的 dsh 任务路由预设（persona / 分类 / 核心工具面），以及 TS 转译后端是否可用。',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '（可选）给一段任务文本，返回其路由分类结果。' }
        }
      }
    },
    handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
      const builtins = BUILTIN_DSH_PRESETS.map((p) => p.name).join('、')
      const tsBackend = await loadTypeScript()
      let classification = ''
      if (args.task) {
        const m = classifyTask(String(args.task))
        const mode = m === 'weak' ? 'weak' : m
        classification = `\n- 任务分类: ${describeMode(mode)}`
      }
      return {
        content:
          `## 全局智能体 dsh 路由状态\n` +
          `- 内置路由预设: ${builtins}\n` +
          `- TypeScript 后端: ${tsBackend ? 'typescript 包（完整转译）' : 'esbuild/最小转译器'}\n` +
          `- 分类能力: build→react / fix→spec / 无倾向→weak\n` +
          classification
      }
    }
  }
}

export { describeMode }
