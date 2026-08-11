import type { Component } from 'vue'

/** 命令面板中的一个动作项 */
export interface CommandPaletteAction {
  id: string
  /** 显示标题 */
  title: string
  /** 搜索关键词（可包含别名） */
  keywords?: string
  /** 分组/分类名 */
  section?: string
  /** 图标（lucide 组件） */
  icon?: Component
  /** 快捷键提示 */
  keyHint?: string
  /** 自定义命令类型，由父组件分发处理 */
  type: string
}
