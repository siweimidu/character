import type { GlobalThemeOverrides } from 'naive-ui'
import type { DarkModeStyle, ThemeName } from '@/types/app'

/**
 * 完整的主题配色方案（对应一套界面所需的全部颜色 token）。
 * 每个品牌主题都提供一套 light 与一套 dark 配色，从而表达完整的设计风格。
 */
export interface ThemeColorScheme {
  bgBody: string        // 全局背景
  bgWeak: string        // 次级背景（输入框、表头等）
  bgSurface: string     // 卡片/面板表面
  bgSurfaceHover: string// 表面悬停态
  bgSidebar: string     // 侧栏背景
  sidebarBorder: string // 侧栏边框
  textPrimary: string   // 主文字
  textSecondary: string // 次级文字
  textHint: string      // 提示文字
  border: string        // 常规边框
  borderStrong: string  // 强边框
  primary: string       // 主色调
  primaryHover: string  // 主色悬停态
  primaryPressed: string// 主色按下态
  primarySoft: string   // 柔和主色背景（标签、徽章）
  shadowSm: string      // 小阴影
  shadowMd: string      // 中阴影
  shadowLg: string      // 大阴影
  bgMix: string         // 混合背景（玻璃叠加基底）
  success: string       // 成功色
  warning: string       // 警告色
  danger: string        // 危险色
}

// 主题预设结构定义
export interface ThemePreset {
  name: ThemeName        // 主题标识名
  label: string          // 主题显示名称
  primary: string        // 主色调（浅色，用于设置面板色块展示）
  primaryHover: string   // 主色调悬停态
  primaryPressed: string // 主色调按下态
  darkPrimary: string        // 深色模式主色调
  darkPrimaryHover: string   // 深色模式悬停态
  darkPrimaryPressed: string // 深色模式按下态
  softBackground: string // 柔和背景色（用于标签、徽章等浅色区域）
  light: ThemeColorScheme // 浅色模式完整配色
  dark: ThemeColorScheme  // 深色模式完整配色
}

// 内置主题预设列表
export const themePresets: ThemePreset[] = [
  {
    name: 'ocean',
    label: '海蓝',
    primary: '#0066cc',
    primaryHover: '#0b76e8',
    primaryPressed: '#0058b0',
    darkPrimary: '#347fc7',
    darkPrimaryHover: '#438ed7',
    darkPrimaryPressed: '#286baa',
    softBackground: '#ebf3fa',
    light: {
      bgBody: '#f8f8f9',
      bgWeak: '#fafafb',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#eef0f3',
      bgSidebar: '#ececef',
      sidebarBorder: '#dcdce0',
      textPrimary: '#18181b',
      textSecondary: '#52525b',
      textHint: '#a1a1aa',
      border: '#e4e4e7',
      borderStrong: '#d4d4d8',
      primary: '#0066cc',
      primaryHover: '#0b76e8',
      primaryPressed: '#0058b0',
      primarySoft: '#ebf3fa',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06)',
      shadowMd: '0 2px 8px rgba(0, 0, 0, 0.07)',
      shadowLg: '0 4px 16px rgba(0, 0, 0, 0.09)',
      bgMix: '#ffffff',
      success: '#15803d',
      warning: '#a16207',
      danger: '#dc2626'
    },
    dark: {
      bgBody: '#111315',
      bgWeak: '#181b1f',
      bgSurface: '#1e2227',
      bgSurfaceHover: '#272c33',
      bgSidebar: '#15181c',
      sidebarBorder: '#2a2f36',
      textPrimary: '#f1f3f5',
      textSecondary: '#b8bec7',
      textHint: '#7f8894',
      border: '#30353d',
      borderStrong: '#424953',
      primary: '#347fc7',
      primaryHover: '#438ed7',
      primaryPressed: '#286baa',
      primarySoft: 'color-mix(in srgb, #347fc7 18%, #20252b)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.3)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.34)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.4)',
      bgMix: '#191c20',
      success: '#49c98a',
      warning: '#dda94f',
      danger: '#ec7272'
    }
  },
  {
    name: 'jade',
    label: '玉绿',
    primary: '#0f8b6d',
    primaryHover: '#14a17f',
    primaryPressed: '#0d755c',
    darkPrimary: '#238b73',
    darkPrimaryHover: '#2d9d83',
    darkPrimaryPressed: '#1b735f',
    softBackground: '#e9f7f2',
    light: {
      bgBody: '#f8faf9',
      bgWeak: '#fafcfb',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#edf4f1',
      bgSidebar: '#ebf1ee',
      sidebarBorder: '#dbe5e0',
      textPrimary: '#17221e',
      textSecondary: '#4e5c57',
      textHint: '#9aa8a2',
      border: '#e0e8e4',
      borderStrong: '#cfdbd5',
      primary: '#0f8b6d',
      primaryHover: '#14a17f',
      primaryPressed: '#0d755c',
      primarySoft: '#e9f7f2',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06)',
      shadowMd: '0 2px 8px rgba(0, 0, 0, 0.07)',
      shadowLg: '0 4px 16px rgba(0, 0, 0, 0.09)',
      bgMix: '#ffffff',
      success: '#15803d',
      warning: '#a16207',
      danger: '#dc2626'
    },
    dark: {
      bgBody: '#101512',
      bgWeak: '#161d19',
      bgSurface: '#1b231f',
      bgSurfaceHover: '#242e29',
      bgSidebar: '#141a16',
      sidebarBorder: '#2a342f',
      textPrimary: '#eef4f1',
      textSecondary: '#b4c0ba',
      textHint: '#7c8a83',
      border: '#2e3a34',
      borderStrong: '#405048',
      primary: '#2d9d83',
      primaryHover: '#38ae93',
      primaryPressed: '#22826c',
      primarySoft: 'color-mix(in srgb, #2d9d83 18%, #1e2822)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.3)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.34)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.4)',
      bgMix: '#18211c',
      success: '#49c98a',
      warning: '#dda94f',
      danger: '#ec7272'
    }
  },
  {
    name: 'amber',
    label: '琥珀',
    primary: '#d97706',
    primaryHover: '#ea8b1a',
    primaryPressed: '#bc6604',
    darkPrimary: '#b87520',
    darkPrimaryHover: '#ca8428',
    darkPrimaryPressed: '#965d17',
    softBackground: '#fff3df',
    light: {
      bgBody: '#faf8f5',
      bgWeak: '#fcfbf8',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#f5f1ea',
      bgSidebar: '#f2eee6',
      sidebarBorder: '#e4ddd2',
      textPrimary: '#26221b',
      textSecondary: '#5d574d',
      textHint: '#a59e92',
      border: '#ece5da',
      borderStrong: '#ddd4c6',
      primary: '#d97706',
      primaryHover: '#ea8b1a',
      primaryPressed: '#bc6604',
      primarySoft: '#fff3df',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06)',
      shadowMd: '0 2px 8px rgba(0, 0, 0, 0.07)',
      shadowLg: '0 4px 16px rgba(0, 0, 0, 0.09)',
      bgMix: '#ffffff',
      success: '#15803d',
      warning: '#a16207',
      danger: '#dc2626'
    },
    dark: {
      bgBody: '#14120e',
      bgWeak: '#1a1813',
      bgSurface: '#201e18',
      bgSurfaceHover: '#2a2720',
      bgSidebar: '#181612',
      sidebarBorder: '#33302a',
      textPrimary: '#f3efe7',
      textSecondary: '#bdb6aa',
      textHint: '#857e72',
      border: '#38342c',
      borderStrong: '#4b463b',
      primary: '#ca8428',
      primaryHover: '#dd9430',
      primaryPressed: '#a96d1b',
      primarySoft: 'color-mix(in srgb, #ca8428 18%, #242118)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.3)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.34)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.4)',
      bgMix: '#1e1b16',
      success: '#49c98a',
      warning: '#dda94f',
      danger: '#ec7272'
    }
  },
  {
    name: 'rose',
    label: '玫红',
    primary: '#c43d6b',
    primaryHover: '#db4a7a',
    primaryPressed: '#aa355d',
    darkPrimary: '#b65376',
    darkPrimaryHover: '#ca6287',
    darkPrimaryPressed: '#98415f',
    softBackground: '#fdeef4',
    light: {
      bgBody: '#faf7f8',
      bgWeak: '#fcfafb',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#f5eef1',
      bgSidebar: '#f2ebee',
      sidebarBorder: '#e4d8dd',
      textPrimary: '#281c21',
      textSecondary: '#5f4c54',
      textHint: '#a5949c',
      border: '#eae0e4',
      borderStrong: '#ddcfd4',
      primary: '#c43d6b',
      primaryHover: '#db4a7a',
      primaryPressed: '#aa355d',
      primarySoft: '#fdeef4',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06)',
      shadowMd: '0 2px 8px rgba(0, 0, 0, 0.07)',
      shadowLg: '0 4px 16px rgba(0, 0, 0, 0.09)',
      bgMix: '#ffffff',
      success: '#15803d',
      warning: '#a16207',
      danger: '#dc2626'
    },
    dark: {
      bgBody: '#141113',
      bgWeak: '#1a1618',
      bgSurface: '#201b1e',
      bgSurfaceHover: '#2a2327',
      bgSidebar: '#181417',
      sidebarBorder: '#332a2f',
      textPrimary: '#f3eef0',
      textSecondary: '#bdb2b8',
      textHint: '#857a80',
      border: '#393035',
      borderStrong: '#4c4047',
      primary: '#ca6287',
      primaryHover: '#dd6f94',
      primaryPressed: '#ab4f72',
      primarySoft: 'color-mix(in srgb, #ca6287 18%, #241d21)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.3)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.34)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.4)',
      bgMix: '#1e191c',
      success: '#49c98a',
      warning: '#dda94f',
      danger: '#ec7272'
    }
  },
  {
    name: 'apple',
    label: '苹果',
    primary: '#007aff',
    primaryHover: '#2e8dff',
    primaryPressed: '#0064d6',
    darkPrimary: '#0a84ff',
    darkPrimaryHover: '#2e9dff',
    darkPrimaryPressed: '#0060df',
    softBackground: '#e8f2ff',
    light: {
      bgBody: '#f5f5f7',
      bgWeak: '#fafafa',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#ebebf0',
      bgSidebar: '#f0f0f4',
      sidebarBorder: '#e2e2e8',
      textPrimary: '#1d1d1f',
      textSecondary: '#6e6e73',
      textHint: '#aeaeb2',
      border: '#e5e5ea',
      borderStrong: '#d1d1d6',
      primary: '#007aff',
      primaryHover: '#2e8dff',
      primaryPressed: '#0064d6',
      primarySoft: '#e8f2ff',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.08)',
      shadowMd: '0 4px 14px rgba(0, 0, 0, 0.08)',
      shadowLg: '0 10px 30px rgba(0, 0, 0, 0.12)',
      bgMix: '#ffffff',
      success: '#34c759',
      warning: '#ff9500',
      danger: '#ff3b30'
    },
    dark: {
      bgBody: '#000000',
      bgWeak: '#1c1c1e',
      bgSurface: '#1c1c1e',
      bgSurfaceHover: '#2c2c2e',
      bgSidebar: '#0c0c0d',
      sidebarBorder: '#38383a',
      textPrimary: '#f5f5f7',
      textSecondary: '#aeaeb2',
      textHint: '#48484a',
      border: '#3a3a3c',
      borderStrong: '#4a4a4d',
      primary: '#0a84ff',
      primaryHover: '#2e9dff',
      primaryPressed: '#0060df',
      primarySoft: 'color-mix(in srgb, #0a84ff 18%, #1c1c1e)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.5)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.5)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.55)',
      bgMix: '#161617',
      success: '#30d158',
      warning: '#ff9f0a',
      danger: '#ff453a'
    }
  },
  {
    name: 'google',
    label: '谷歌',
    primary: '#4285f4',
    primaryHover: '#5a95f5',
    primaryPressed: '#3367d6',
    darkPrimary: '#fc2c50',
    darkPrimaryHover: '#ff4d6d',
    darkPrimaryPressed: '#d62442',
    softBackground: '#e8f0fe',
    light: {
      bgBody: '#f8f9fa',
      bgWeak: '#fbfbfb',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#f1f3f4',
      bgSidebar: '#f0f6ff',
      sidebarBorder: '#e7eaef',
      textPrimary: '#0e1115',
      textSecondary: '#5f6368',
      textHint: '#9aa0a6',
      border: '#e0e0e0',
      borderStrong: '#cfd4da',
      primary: '#4285f4',
      primaryHover: '#5a95f5',
      primaryPressed: '#3367d6',
      primarySoft: '#e8f0fe',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.06)',
      shadowMd: '0 4px 16px rgba(0, 0, 0, 0.08)',
      shadowLg: '0 8px 28px rgba(0, 0, 0, 0.12)',
      bgMix: '#ffffff',
      success: '#34a853',
      warning: '#fbbc05',
      danger: '#ea4335'
    },
    dark: {
      bgBody: '#161616',
      bgWeak: '#1d1d1c',
      bgSurface: '#1d1d1c',
      bgSurfaceHover: '#2e2e2e',
      bgSidebar: '#171717',
      sidebarBorder: '#2e2e2e',
      textPrimary: '#eff1f4',
      textSecondary: '#b0b6bd',
      textHint: '#949494',
      border: '#2e2e2e',
      borderStrong: '#3d3d3d',
      primary: '#fc2c50',
      primaryHover: '#ff4d6d',
      primaryPressed: '#d62442',
      primarySoft: 'color-mix(in srgb, #fc2c50 18%, #242426)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.4)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.5)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.55)',
      bgMix: '#1a1a1a',
      success: '#34d399',
      warning: '#fbbf24',
      danger: '#f87171'
    }
  },
  {
    name: 'minimalist',
    label: '极简',
    primary: '#333333',
    primaryHover: '#4d4d4d',
    primaryPressed: '#262626',
    darkPrimary: '#e6e6e6',
    darkPrimaryHover: '#f2f2f2',
    darkPrimaryPressed: '#cccccc',
    softBackground: '#f2f2f2',
    light: {
      bgBody: '#f7f7f7',
      bgWeak: '#fbfbfb',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#f0f0f0',
      bgSidebar: '#f0f0f0',
      sidebarBorder: '#e3e3e3',
      textPrimary: '#1a1a1a',
      textSecondary: '#555555',
      textHint: '#9a9a9a',
      border: '#e5e5e5',
      borderStrong: '#d6d6d6',
      primary: '#333333',
      primaryHover: '#4d4d4d',
      primaryPressed: '#262626',
      primarySoft: '#f2f2f2',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.05)',
      shadowMd: '0 2px 10px rgba(0, 0, 0, 0.06)',
      shadowLg: '0 6px 24px rgba(0, 0, 0, 0.08)',
      bgMix: '#ffffff',
      success: '#3a8a5c',
      warning: '#b07a2a',
      danger: '#c33a3a'
    },
    dark: {
      bgBody: '#141414',
      bgWeak: '#191919',
      bgSurface: '#1e1e1e',
      bgSurfaceHover: '#262626',
      bgSidebar: '#181818',
      sidebarBorder: '#2c2c2c',
      textPrimary: '#f2f2f2',
      textSecondary: '#b8b8b8',
      textHint: '#7a7a7a',
      border: '#303030',
      borderStrong: '#3d3d3d',
      primary: '#e6e6e6',
      primaryHover: '#f2f2f2',
      primaryPressed: '#cccccc',
      primarySoft: 'color-mix(in srgb, #e6e6e6 14%, #232323)',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.35)',
      shadowMd: '0 4px 16px rgba(0, 0, 0, 0.4)',
      shadowLg: '0 12px 36px rgba(0, 0, 0, 0.45)',
      bgMix: '#1b1b1b',
      success: '#4fae74',
      warning: '#d3a050',
      danger: '#e06b6b'
    }
  },
  {
    name: 'claude',
    label: 'Claude',
    primary: '#c96442',
    primaryHover: '#d6866a',
    primaryPressed: '#b0562f',
    darkPrimary: '#d6866a',
    darkPrimaryHover: '#e0a892',
    darkPrimaryPressed: '#c96442',
    softBackground: '#fbf2ed',
    light: {
      bgBody: '#faf9f5',
      bgWeak: '#fcfbf7',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#f2f0e9',
      bgSidebar: '#f0eee5',
      sidebarBorder: '#e2ded1',
      textPrimary: '#3d3929',
      textSecondary: '#6e6d68',
      textHint: '#9b988c',
      border: '#e7e3d7',
      borderStrong: '#d8d3c4',
      primary: '#c96442',
      primaryHover: '#d6866a',
      primaryPressed: '#b0562f',
      primarySoft: '#fbf2ed',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.07)',
      shadowMd: '0 4px 16px rgba(0, 0, 0, 0.09)',
      shadowLg: '0 10px 32px rgba(0, 0, 0, 0.12)',
      bgMix: '#ffffff',
      success: '#2f9e63',
      warning: '#c98a2d',
      danger: '#d64545'
    },
    dark: {
      bgBody: '#1f1e1c',
      bgWeak: '#262420',
      bgSurface: '#2a2926',
      bgSurfaceHover: '#35332f',
      bgSidebar: '#201f1c',
      sidebarBorder: '#3a3833',
      textPrimary: '#f5f0e8',
      textSecondary: '#b8b2a6',
      textHint: '#857f74',
      border: '#3a3833',
      borderStrong: '#4c4943',
      primary: '#d6866a',
      primaryHover: '#e0a892',
      primaryPressed: '#c96442',
      primarySoft: 'color-mix(in srgb, #d6866a 18%, #2e2b27)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.45)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.5)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.55)',
      bgMix: '#25231f',
      success: '#3fae6e',
      warning: '#dda94f',
      danger: '#e06565'
    }
  },
  {
    name: 'doubao',
    label: '豆包',
    primary: '#0065fd',
    primaryHover: '#2b7fff',
    primaryPressed: '#0057da',
    darkPrimary: '#3b82f6',
    darkPrimaryHover: '#5b96f7',
    darkPrimaryPressed: '#2563eb',
    softBackground: '#e5e9ff',
    light: {
      bgBody: '#f7f8fa',
      bgWeak: '#fbfbfc',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#eff1f4',
      bgSidebar: '#eff1f4',
      sidebarBorder: '#e3e6ea',
      textPrimary: '#0e1115',
      textSecondary: '#4e5561',
      textHint: '#7f8d9f',
      border: '#e7eaef',
      borderStrong: '#d4d9e0',
      primary: '#0065fd',
      primaryHover: '#2b7fff',
      primaryPressed: '#0057da',
      primarySoft: '#e5e9ff',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06)',
      shadowMd: '0 4px 16px rgba(0, 0, 0, 0.08)',
      shadowLg: '0 8px 28px rgba(0, 0, 0, 0.12)',
      bgMix: '#ffffff',
      success: '#00b578',
      warning: '#ff9f0a',
      danger: '#ef4444'
    },
    dark: {
      bgBody: '#17181a',
      bgWeak: '#1f2124',
      bgSurface: '#1f2124',
      bgSurfaceHover: '#2a2d31',
      bgSidebar: '#1a1c1f',
      sidebarBorder: '#33363b',
      textPrimary: '#f2f3f5',
      textSecondary: '#b0b6bd',
      textHint: '#7b8289',
      border: '#33363b',
      borderStrong: '#44484e',
      primary: '#3b82f6',
      primaryHover: '#5b96f7',
      primaryPressed: '#2563eb',
      primarySoft: 'color-mix(in srgb, #3b82f6 18%, #23262b)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.4)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.5)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.55)',
      bgMix: '#1d2024',
      success: '#34d399',
      warning: '#fbbf24',
      danger: '#f87171'
    }
  },
  {
    name: 'traework',
    label: 'Trae办公',
    primary: '#4B3FE3',
    primaryHover: '#6A6FFF',
    primaryPressed: '#3F31C6',
    darkPrimary: '#6A6FFF',
    darkPrimaryHover: '#8894FF',
    darkPrimaryPressed: '#4B3FE3',
    softBackground: '#E5EAFF',
    light: {
      bgBody: '#F5F5F5',
      bgWeak: '#FAFAFA',
      bgSurface: '#FFFFFF',
      bgSurfaceHover: '#F0F0F0',
      bgSidebar: '#FAFAFA',
      sidebarBorder: '#E5E5E5',
      textPrimary: '#171717',
      textSecondary: '#404040',
      textHint: '#737373',
      border: '#E5E5E5',
      borderStrong: '#D4D4D4',
      primary: '#4B3FE3',
      primaryHover: '#6A6FFF',
      primaryPressed: '#3F31C6',
      primarySoft: '#E5EAFF',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06)',
      shadowMd: '0 4px 14px rgba(0, 0, 0, 0.08)',
      shadowLg: '0 8px 24px rgba(0, 0, 0, 0.1)',
      bgMix: '#FFFFFF',
      success: '#2fb876',
      warning: '#e6a23c',
      danger: '#f56c6c'
    },
    dark: {
      bgBody: '#1A1B1D',
      bgWeak: '#222427',
      bgSurface: '#222427',
      bgSurfaceHover: '#2A2D31',
      bgSidebar: '#1E1F22',
      sidebarBorder: '#34363b',
      textPrimary: '#D1D3DB',
      textSecondary: '#9599A6',
      textHint: '#666B75',
      border: '#34363b',
      borderStrong: '#45474e',
      primary: '#6A6FFF',
      primaryHover: '#8894FF',
      primaryPressed: '#4B3FE3',
      primarySoft: 'color-mix(in srgb, #6A6FFF 18%, #232530)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.4)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.5)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.55)',
      bgMix: '#1f2023',
      success: '#34d399',
      warning: '#fbbf24',
      danger: '#f87171'
    }
  },
  {
    name: 'traecode',
    label: 'Trae代码',
    primary: '#32F08C',
    primaryHover: '#0FDC78',
    primaryPressed: '#2BD07E',
    darkPrimary: '#32F08C',
    darkPrimaryHover: '#0FDC78',
    darkPrimaryPressed: '#2BD07E',
    softBackground: '#e6fff3',
    light: {
      bgBody: '#f5f7f6',
      bgWeak: '#fafcfb',
      bgSurface: '#ffffff',
      bgSurfaceHover: '#eef2f0',
      bgSidebar: '#edf1ef',
      sidebarBorder: '#dfe5e1',
      textPrimary: '#17181b',
      textSecondary: '#4a4f55',
      textHint: '#8a9096',
      border: '#e0e5e2',
      borderStrong: '#cfd6d2',
      primary: '#0fb46a',
      primaryHover: '#0FDC78',
      primaryPressed: '#0c9a58',
      primarySoft: '#e6fff3',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06)',
      shadowMd: '0 4px 14px rgba(0, 0, 0, 0.07)',
      shadowLg: '0 8px 24px rgba(0, 0, 0, 0.1)',
      bgMix: '#ffffff',
      success: '#0fb46a',
      warning: '#e6a23c',
      danger: '#f56c6c'
    },
    dark: {
      bgBody: '#1A1B1D',
      bgWeak: '#222427',
      bgSurface: '#222427',
      bgSurfaceHover: '#2A2D31',
      bgSidebar: '#1E1F22',
      sidebarBorder: '#34363b',
      textPrimary: '#D1D3DB',
      textSecondary: '#9599A6',
      textHint: '#666B75',
      border: '#34363b',
      borderStrong: '#45474e',
      primary: '#32F08C',
      primaryHover: '#0FDC78',
      primaryPressed: '#2BD07E',
      primarySoft: 'color-mix(in srgb, #32F08C 16%, #21262a)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.4)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.5)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.55)',
      bgMix: '#1f2023',
      success: '#32F08C',
      warning: '#fbbf24',
      danger: '#f87171'
    }
  },
  {
    name: 'paper',
    label: '纸质',
    primary: '#b8860b',
    primaryHover: '#ca9a1e',
    primaryPressed: '#9a730a',
    darkPrimary: '#d8b45a',
    darkPrimaryHover: '#e2c170',
    darkPrimaryPressed: '#b8963c',
    softBackground: '#f6efdf',
    light: {
      bgBody: '#f3ead6',
      bgWeak: '#f8f1e1',
      bgSurface: '#fbf6ea',
      bgSurfaceHover: '#efe4cb',
      bgSidebar: '#efe5cf',
      sidebarBorder: '#ddd0b6',
      textPrimary: '#3b342a',
      textSecondary: '#6d6454',
      textHint: '#a79d87',
      border: '#e4d9c2',
      borderStrong: '#d3c5a8',
      primary: '#b8860b',
      primaryHover: '#ca9a1e',
      primaryPressed: '#9a730a',
      primarySoft: '#f6efdf',
      shadowSm: '0 1px 3px rgba(92, 74, 40, 0.08)',
      shadowMd: '0 4px 14px rgba(92, 74, 40, 0.1)',
      shadowLg: '0 10px 28px rgba(92, 74, 40, 0.12)',
      bgMix: '#f7f0e0',
      success: '#8a6d2f',
      warning: '#b07a2a',
      danger: '#c04a3a'
    },
    dark: {
      bgBody: '#232019',
      bgWeak: '#2b271d',
      bgSurface: '#322d21',
      bgSurfaceHover: '#3b3527',
      bgSidebar: '#272318',
      sidebarBorder: '#454032',
      textPrimary: '#f0ead9',
      textSecondary: '#c3bbaa',
      textHint: '#8a8272',
      border: '#474133',
      borderStrong: '#5a5241',
      primary: '#d8b45a',
      primaryHover: '#e2c170',
      primaryPressed: '#b8963c',
      primarySoft: 'color-mix(in srgb, #d8b45a 18%, #322d21)',
      shadowSm: '0 1px 3px rgba(0, 0, 0, 0.4)',
      shadowMd: '0 8px 24px rgba(0, 0, 0, 0.48)',
      shadowLg: '0 18px 48px rgba(0, 0, 0, 0.55)',
      bgMix: '#2b261c',
      success: '#c9b06a',
      warning: '#dda94f',
      danger: '#e06b5a'
    }
  }
]

// 根据主题名查找预设，未找到时回退到第一个预设
export function getThemePreset(name: ThemeName): ThemePreset {
  return themePresets.find((preset) => preset.name === name) ?? themePresets[0]
}

// 返回主题在指定模式下的完整配色方案
export function getThemeColorScheme(name: ThemeName, darkMode: boolean): ThemeColorScheme {
  const preset = getThemePreset(name)
  return darkMode ? preset.dark : preset.light
}

export interface DarkModePreset {
  name: DarkModeStyle
  label: string
  description: string
  bgBody: string
  bgWeak: string
  bgSurface: string
  bgSurfaceHover: string
  bgSidebar: string
  sidebarBorder: string
  textPrimary: string
  textSecondary: string
  textHint: string
  border: string
  borderStrong: string
  shadowSm: string
  shadowMd: string
  shadowLg: string
  bgMix: string
  primarySoftBase: string
}

export const darkModePresets: DarkModePreset[] = [
  {
    name: 'nord',
    label: '深夜中性',
    description: '中性炭灰背景配合清晰的内容层级，减少偏蓝与泛灰，适合长时间写作。',
    bgBody: '#111315',
    bgWeak: '#181b1f',
    bgSurface: '#1e2227',
    bgSurfaceHover: '#272c33',
    bgSidebar: '#15181c',
    sidebarBorder: '#2a2f36',
    textPrimary: '#f1f3f5',
    textSecondary: '#b8bec7',
    textHint: '#7f8894',
    border: '#30353d',
    borderStrong: '#424953',
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.3)',
    shadowMd: '0 8px 24px rgba(0, 0, 0, 0.34)',
    shadowLg: '0 18px 48px rgba(0, 0, 0, 0.4)',
    bgMix: '#191c20',
    primarySoftBase: '#20252b'
  }
]

export function getDarkModePreset(name: DarkModeStyle): DarkModePreset {
  return darkModePresets.find((preset) => preset.name === name) ?? darkModePresets[0]
}

// 将主题预设转换为 Naive UI 的全局主题覆盖配置
export function createNaiveThemeOverrides(
  name: ThemeName,
  darkMode: boolean = false,
  darkStyle: DarkModeStyle = 'nord'
): GlobalThemeOverrides {
  const colors = getThemeColorScheme(name, darkMode)
  void getDarkModePreset(darkStyle)

  const primary = colors.primary
  const primaryHover = colors.primaryHover
  const primaryPressed = colors.primaryPressed

  const darkCommon: GlobalThemeOverrides['common'] = darkMode
    ? {
        bodyColor: colors.bgBody,
        cardColor: colors.bgSurface,
        modalColor: colors.bgSurface,
        popoverColor: colors.bgSurface,
        tableColor: colors.bgSurface,
        tableHeaderColor: colors.bgWeak,
        inputColor: colors.bgWeak,
        inputColorDisabled: colors.bgWeak,
        actionColor: colors.bgSurfaceHover,
        hoverColor: colors.bgSurfaceHover,
        pressedColor: colors.bgSurfaceHover,
        tagColor: colors.bgSurfaceHover,
        borderColor: colors.border,
        dividerColor: colors.border,
        textColorBase: colors.textPrimary,
        textColor1: colors.textPrimary,
        textColor2: colors.textSecondary,
        textColor3: colors.textHint,
        placeholderColor: colors.textHint,
        iconColor: colors.textSecondary,
        closeIconColor: colors.textSecondary
      }
    : {}

  return {
    common: {
      primaryColor: primary,
      primaryColorHover: primaryHover,
      primaryColorPressed: primaryPressed,
      primaryColorSuppl: primaryHover,
      borderRadius: '6px',
      borderRadiusSmall: '4px',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif',
      ...darkCommon
    },
    Button: {
      borderRadiusMedium: '6px',
      borderRadiusSmall: '6px',
      borderRadiusLarge: '8px',
      paddingMedium: '0 14px',
      fontWeight: '600'
    },
    Input: {
      borderRadius: '6px'
    },
    Select: {
      peers: {
        InternalSelection: {
          borderRadius: '6px'
        }
      }
    },
    Card: {
      borderRadius: '10px'
    },
    Modal: {
      borderRadius: '10px'
    },
    Dialog: {
      borderRadius: '10px'
    }
  }
}
