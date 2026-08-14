/**
 * 智能体预设 SVG 头像。
 *
 * 提供 10 个精心设计的 SVG 头像，每个头像采用不同主色和图形主题，
 * 用于智能体创建时的预设选择。
 *
 * 所有头像都是 1:1 正方形 viewBox="0 0 64 64"。
 */

export interface PresetAgentAvatar {
  index: number
  name: string
  /** 主色。 */
  color: string
  /** SVG 原始代码（不含 <svg> 外层标签，只含内部内容）。 */
  inner: string
}

function buildAvatar(
  index: number,
  name: string,
  color: string,
  bg: string,
  inner: string
): PresetAgentAvatar {
  return { index, name, color, inner }
}

export const PRESET_AGENT_AVATARS: PresetAgentAvatar[] = [
  {
    index: 0,
    name: '星火',
    color: '#f59e0b',
    inner: `
      <rect width="64" height="64" rx="14" fill="#fef3c7"/>
      <path d="M32 12 L36.5 26 L50 26 L39 35 L43 49 L32 40 L21 49 L25 35 L14 26 L27.5 26 Z" fill="#f59e0b" stroke="#d97706" stroke-width="1.5"/>
      <circle cx="32" cy="32" r="4" fill="#fff7ed"/>
    `
  },
  {
    index: 1,
    name: '海蓝',
    color: '#0ea5e9',
    inner: `
      <rect width="64" height="64" rx="14" fill="#e0f2fe"/>
      <path d="M14 40 Q22 30 32 38 Q42 46 50 34 L50 46 Q40 56 32 48 Q24 40 14 50 Z" fill="#0ea5e9"/>
      <path d="M14 28 Q22 18 32 26 Q42 34 50 22 L50 34 Q40 44 32 36 Q24 28 14 38 Z" fill="#38bdf8" opacity="0.8"/>
      <path d="M14 50 Q22 40 32 48 Q42 56 50 46" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round"/>
    `
  },
  {
    index: 2,
    name: '薄荷',
    color: '#10b981',
    inner: `
      <rect width="64" height="64" rx="14" fill="#d1fae5"/>
      <path d="M32 10 C40 18 42 26 36 34 C44 34 48 40 46 48 C38 52 30 50 26 44 C20 48 14 46 12 40 C18 36 24 36 26 38 C24 30 28 22 32 10 Z" fill="#10b981"/>
      <circle cx="36" cy="22" r="3" fill="#34d399"/>
      <circle cx="40" cy="32" r="2.5" fill="#6ee7b7"/>
      <circle cx="28" cy="44" r="2" fill="#a7f3d0"/>
    `
  },
  {
    index: 3,
    name: '紫韵',
    color: '#8b5cf6',
    inner: `
      <rect width="64" height="64" rx="14" fill="#ede9fe"/>
      <circle cx="32" cy="30" r="18" fill="#8b5cf6"/>
      <circle cx="32" cy="30" r="10" fill="#a78bfa"/>
      <circle cx="32" cy="30" r="4" fill="#c4b5fd"/>
      <path d="M22 52 L30 44 L34 48 L42 42" stroke="#7c3aed" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <circle cx="26" cy="24" r="2" fill="#fff"/>
      <circle cx="38" cy="24" r="2" fill="#fff"/>
      <path d="M26 34 Q32 40 38 34" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    `
  },
  {
    index: 4,
    name: '赤焰',
    color: '#ef4444',
    inner: `
      <rect width="64" height="64" rx="14" fill="#fee2e2"/>
      <path d="M32 8 C36 16 42 22 46 30 C50 38 46 50 36 54 C30 56 22 54 18 48 C14 42 16 34 20 30 C24 26 28 24 28 20 C28 16 30 12 32 8 Z" fill="#ef4444"/>
      <path d="M26 28 C30 32 36 36 38 42 C40 46 38 50 34 50 C28 50 22 44 20 38 C18 34 22 30 26 28 Z" fill="#f87171" opacity="0.7"/>
    `
  },
  {
    index: 5,
    name: '墨玉',
    color: '#334155',
    inner: `
      <rect width="64" height="64" rx="14" fill="#e2e8f0"/>
      <rect x="14" y="14" width="36" height="36" rx="6" fill="#334155"/>
      <path d="M22 26 L34 22 L42 30 L38 40 L26 42 L20 34 Z" fill="#64748b"/>
      <circle cx="30" cy="31" r="3" fill="#94a3b8"/>
      <path d="M30 20 L34 18 L36 22 L34 26 Z" fill="#cbd5e1"/>
      <rect x="28" y="40" width="8" height="6" rx="1" fill="#475569"/>
    `
  },
  {
    index: 6,
    name: '金箔',
    color: '#d4a017',
    inner: `
      <rect width="64" height="64" rx="14" fill="#fef9c3"/>
      <path d="M32 10 L36 24 L50 24 L39 33 L44 48 L32 39 L20 48 L25 33 L14 24 L28 24 Z" fill="#fbbf24" stroke="#d97706" stroke-width="1"/>
      <rect x="28" y="28" width="8" height="8" rx="2" fill="#fef3c7" opacity="0.8"/>
      <circle cx="36" cy="38" r="1.5" fill="#fff7ed"/>
      <circle cx="44" cy="30" r="1" fill="#fff7ed"/>
    `
  },
  {
    index: 7,
    name: '青瓷',
    color: '#14b8a6',
    inner: `
      <rect width="64" height="64" rx="14" fill="#ccfbf1"/>
      <ellipse cx="32" cy="38" rx="18" ry="16" fill="#14b8a6"/>
      <ellipse cx="32" cy="36" rx="10" ry="8" fill="#5eead4"/>
      <path d="M26 24 Q28 18 34 16 Q40 18 38 24" stroke="#0d9488" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <circle cx="27" cy="33" r="2" fill="#134e4a"/>
      <circle cx="37" cy="33" r="2" fill="#134e4a"/>
      <path d="M28 42 Q32 45 36 42" stroke="#0d9488" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    `
  },
  {
    index: 8,
    name: '曙光',
    color: '#f97316',
    inner: `
      <rect width="64" height="64" rx="14" fill="#ffedd5"/>
      <rect x="14" y="16" width="36" height="32" rx="6" fill="#f97316"/>
      <rect x="14" y="16" width="18" height="18" rx="6" fill="#fdba74"/>
      <rect x="36" y="38" width="14" height="10" rx="3" fill="#c2410c" opacity="0.6"/>
      <path d="M20 44 L28 36" stroke="#7c2d12" stroke-width="1.5"/>
      <path d="M24 48 L32 40" stroke="#7c2d12" stroke-width="1"/>
    `
  },
  {
    index: 9,
    name: '雪松',
    color: '#6366f1',
    inner: `
      <rect width="64" height="64" rx="14" fill="#e0e7ff"/>
      <path d="M32 8 L34 20 L44 16 L38 26 L50 28 L36 32 L46 42 L32 36 L22 46 L28 34 L14 32 L28 28 L22 18 L34 22 Z" fill="#6366f1"/>
      <circle cx="38" cy="36" r="2" fill="#c7d2fe"/>
      <circle cx="26" cy="26" r="1.5" fill="#a5b4fc"/>
    `
  }
]

/**
 * 随机机器人 SVG 头像的颜色主题。
 * 每次创建新智能体时取一个随机主题，保证每个智能体颜色都不一样。
 */
export interface RobotAvatarTheme {
  /** 主色。 */
  color: string
  /** 深色（描边/阴影）。 */
  dark: string
  /** 浅色（高光/衬底）。 */
  light: string
}

/** 预置的机器人配色主题，随机选用保证颜色各不相同。 */
export const ROBOT_AVATAR_THEMES: RobotAvatarTheme[] = [
  { color: '#38bdf8', dark: '#0284c7', light: '#bae6fd' }, // 天蓝
  { color: '#f472b6', dark: '#db2777', light: '#fbcfe8' }, // 粉红
  { color: '#a78bfa', dark: '#7c3aed', light: '#ddd6fe' }, // 紫
  { color: '#34d399', dark: '#059669', light: '#a7f3d0' }, // 翠绿
  { color: '#fb923c', dark: '#ea580c', light: '#fed7aa' }, // 橙
  { color: '#fbbf24', dark: '#d97706', light: '#fde68a' }, // 金
  { color: '#f87171', dark: '#dc2626', light: '#fecaca' }, // 红
  { color: '#2dd4bf', dark: '#0d9488', light: '#99f6e4' }, // 青
  { color: '#818cf8', dark: '#4f46e5', light: '#c7d2fe' }, // 靛
  { color: '#94a3b8', dark: '#64748b', light: '#e2e8f0' }, // 灰蓝
  { color: '#c084fc', dark: '#9333ea', light: '#e9d5ff' }, // 亮紫
  { color: '#f97316', dark: '#c2410c', light: '#fed7aa' }, // 焦橙
  { color: '#22c55e', dark: '#16a34a', light: '#bbf7d0' }, // 草绿
  { color: '#06b6d4', dark: '#0891b2', light: '#a5f3fc' }, // 水蓝
  { color: '#e879f9', dark: '#c026d3', light: '#f5d0fe' }, // 品红
  { color: '#64748b', dark: '#475569', light: '#cbd5e1' }, // 石板
]

/** 随机取一个机器人配色主题。 */
export function randomRobotAvatarTheme(): RobotAvatarTheme {
  return ROBOT_AVATAR_THEMES[Math.floor(Math.random() * ROBOT_AVATAR_THEMES.length)]
}

/**
 * 默认机器人配色主题（确定性的固定主题）。
 * 用于智能体没有自定义头像时的兜底显示，保证始终能看到默认机器人头像。
 */
export function defaultRobotAvatarTheme(): RobotAvatarTheme {
  return ROBOT_AVATAR_THEMES[0]
}

/**
 * 生成随机颜色的机器人 SVG 头像（完整 SVG 字符串）。
 * 用于新智能体默认头像，颜色每次随机，保证每个智能体都不同。
 */
export function randomRobotAvatarSvg(): string {
  return robotAvatarSvg(randomRobotAvatarTheme())
}

/**
 * 生成确定性的默认机器人 SVG 头像（完整 SVG 字符串）。
 * 用于智能体没有自定义头像时的兜底展示，保证始终显示默认机器人头像。
 */
export function defaultRobotAvatarSvg(): string {
  return robotAvatarSvg(defaultRobotAvatarTheme())
}

/**
 * 生成指定配色的机器人 SVG 头像（完整 SVG 字符串）。
 * viewBox 为 1:1 正方形 0 0 64 64。
 */
export function robotAvatarSvg(theme: RobotAvatarTheme): string {
  const { color, dark, light } = theme
  const inner = `
    <rect width="64" height="64" rx="14" fill="${light}"/>
    <!-- 天线 -->
    <rect x="30" y="6" width="4" height="10" rx="2" fill="${dark}"/>
    <circle cx="32" cy="6" r="4" fill="${color}"/>
    <!-- 左传感器 -->
    <rect x="8" y="22" width="7" height="10" rx="3" fill="${dark}"/>
    <!-- 右传感器 -->
    <rect x="49" y="22" width="7" height="10" rx="3" fill="${dark}"/>
    <!-- 机身 -->
    <rect x="12" y="16" width="40" height="42" rx="12" fill="${color}"/>
    <!-- 眼睛 -->
    <circle cx="25" cy="32" r="6" fill="#fff"/>
    <circle cx="39" cy="32" r="6" fill="#fff"/>
    <circle cx="25" cy="32" r="3" fill="${dark}"/>
    <circle cx="39" cy="32" r="3" fill="${dark}"/>
    <!-- 嘴 -->
    <rect x="25" y="44" width="14" height="4" rx="2" fill="${dark}"/>
  `
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${inner}</svg>`
}

/** 生成完整的 SVG 字符串。 */
export function presetAvatarSvg(index: number): string {
  const preset = PRESET_AGENT_AVATARS.find((p) => p.index === index)
  if (!preset) return ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${preset.inner}</svg>`
}

/** 获取预设头像 SVG 的 data URI（兼容浏览器与 Node.js）。 */
export function presetAvatarDataUri(index: number): string {
  const svg = presetAvatarSvg(index)
  if (!svg) return ''
  // 浏览器环境使用 btoa，Node 环境使用 Buffer
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(svg).toString('base64')
    : btoa(unescape(encodeURIComponent(svg)))
  return `data:image/svg+xml;base64,${base64}`
}

/** 从 data URI 解析头像类型。 */
export function parseAvatarType(avatar: string): 'svg' | 'image' | 'none' {
  if (!avatar) return 'none'
  if (avatar.startsWith('data:image/svg')) return 'svg'
  if (avatar.startsWith('data:image/')) return 'image'
  if (avatar.startsWith('<svg')) return 'svg'
  return 'image'
}
