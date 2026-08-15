/**
 * DshRouter · DeepSeek Harness 任务路由引擎（TypeScript 深度移植）
 *
 * 从 deepseek-harness 的 router-core（dsh-router-standard / v4-flash-godmode 系列
 * preset 所依赖的零依赖路由核心）移植而来，用于让全局智能体具备「everything is
 * a plugin」里 dsh agent preset 的「任务感知推理模式路由」能力：
 *
 *   spec  （Specification-first，plan-collective）—— 维护/修复类任务
 *   react （Reactive-execution，doer）            —— 新建/构建类任务
 *   weak  （内部路由，让模型自己按任务选方向）      —— 无明确倾向
 *   transition（react↔spec 不稳定带，回避）
 *
 * 依据任务首条消息分类出模式，注入对应 persona + 首轮核心工具面，使 Flash /
 * 普通模型都能进入「神模式」（深度规划、高质量交付），而不是「鬼模式」。
 *
 * 全部实现为纯函数，零外部依赖，可直接被插件运行时复用。
 */

// ============================================================================
// Persona（来自 dsh router-core 的 w6 / w7 标定文本）
// ============================================================================

const SPEC_PERSONA = 'You are a helpful software engineer assistant.'

const MIXED_PERSONA =
  'You are a helpful software engineer assistant.\n'
  + 'Work directly: prefer writing or editing code over describing plans. '
  + 'Verify your changes by reading and running them.'

const REACT_PERSONA =
  'You are a hands-on software engineer who delivers working output fast.\n'
  + 'Work directly: write or edit code, then verify it by reading and running. '
  + 'Keep the loop tight — produce, verify, fix — and do not build test '
  + 'harnesses, scaffolding, or ceremony the user did not ask for. '
  + 'Finish with a usable deliverable and a short summary.'

const WEAK_PRO =
  'You are a helpful software engineer assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.'

const WEAK_FLASH =
  'You are a helpful assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.\n'
  + 'Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.\n'
  + 'Think deeply about the architecture, edge cases, and integration points before writing. Do not spend reasoning on the environment or tooling. Produce when your information is complete, and end each reasoning block with a decision or an information need.'

// ============================================================================
// 模式与分类
// ============================================================================

export type RouterMode = 'spec' | 'react' | 'weak' | 'transition'

/** 是否为 Flash 家族模型。 */
export function isFlashModel(modelId: unknown): boolean {
  return typeof modelId === 'string' && /flash/i.test(modelId)
}

export function clamp01(v: unknown): number {
  return Math.min(1, Math.max(0, Number(v) || 0))
}

/** 把数值模式量化到实测稳定带。 */
export function bandOf(mode: number | string): RouterMode {
  if (mode === 'weak') return 'weak'
  const m = clamp01(mode)
  if (m < 0.2) return 'spec'
  if (m < 0.5) return 'transition'
  return 'react'
}

/** 给定模式与模型，返回对应 persona。 */
export function personaFor(mode: number | string, modelId?: unknown): string {
  switch (bandOf(mode)) {
    case 'spec':
      return SPEC_PERSONA
    case 'transition':
      return MIXED_PERSONA
    case 'weak':
      return isFlashModel(modelId) ? WEAK_FLASH : WEAK_PRO
    default:
      return REACT_PERSONA
  }
}

/** 首轮核心工具面（shell 由运行时动态补上）。 */
export function coreFor(mode: number | string): string[] {
  switch (bandOf(mode)) {
    case 'spec':
      return ['read', 'edit', 'glob', 'grep']
    case 'transition':
      return ['read', 'edit', 'write', 'glob', 'grep']
    default:
      return ['read', 'write', 'edit']
  }
}

const REACT_RE =
  /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE =
  /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi

function countHits(regex: RegExp, text: string): number {
  return [...text.matchAll(regex)].length
}

/**
 * 把任务文本分类为模式：react(1) / spec(0) / weak（无倾向）。
 * 移植自 dsh router-core 的 classifyTask。
 */
export function classifyTask(text: string): number | 'weak' {
  const t = text ?? ''
  const react = countHits(REACT_RE, t)
  const spec = countHits(SPEC_RE, t)
  if (react > spec) return 1
  if (spec > react) return 0
  return 'weak'
}

/** 从会话事件里抽取首条用户文本。 */
export function extractText(data: unknown): string {
  if (!data) return ''
  const record = data as { content?: unknown }
  const content = Array.isArray(record.content) ? record.content : []
  return content
    .map((c) =>
      typeof c === 'string' ? c : (c as { text?: string }).text ?? ''
    )
    .join(' ')
}

/** 依据首条用户消息推导会话模式（非 Flash 走这里）。 */
export function sessionMode(
  events: Array<{ type: string; data?: unknown }>,
  modelId?: unknown
): number | 'weak' {
  if (isFlashModel(modelId)) return 'weak'
  const userMsg = events.find((e) => e.type === 'user/message')
  return classifyTask(extractText(userMsg?.data))
}

/** 只替换 persona 区块，保留其余 sections。 */
export function applyPersona(
  sections: Array<{ name?: string; text?: string; order?: number }>,
  personaText: string
): Array<{ name: string; text: string; order: number }> {
  const rest = (sections || []).filter(
    (section) => section.name !== 'persona' && !/persona/i.test(section.name ?? '')
  )
  return [
    ...rest.map((s) => ({ name: s.name ?? '', text: s.text ?? '', order: s.order ?? 0 })),
    { name: 'router-persona', text: personaText, order: 0 }
  ]
}

/** 一句话描述分类结果，供工具/UI 展示。 */
export function describeMode(mode: number | string): string {
  switch (bandOf(mode)) {
    case 'spec':
      return 'spec（先规划后动手：维护/修复类，走 read/edit/glob/grep）'
    case 'react':
      return 'react（快速交付：新建/构建类，走 read/write/edit）'
    case 'weak':
      return 'weak（内部路由：让模型按任务自选 build/fix 方向）'
    default:
      return 'transition（react↔spec 不稳定带，建议避免）'
  }
}
