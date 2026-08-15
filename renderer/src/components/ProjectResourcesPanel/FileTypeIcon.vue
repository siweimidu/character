<script setup lang="ts">
/**
 * FileTypeIcon · 项目资源区域文件类型 SVG 图标
 *
 * 根据文件扩展名返回对应的彩色 SVG 图标（HTML / Markdown / PPT / PDF / JSON /
 * TypeScript / JavaScript / Shell / Batch / CSS / 图片 / 文档 / XML / 压缩包 / 通用文件）。
 * 全部为内联 SVG，无需额外依赖。
 */
import { computed } from 'vue'

const props = defineProps<{
  name?: string
  size?: number
}>()

const size = computed(() => props.size ?? 22)

interface IconSpec {
  color: string
  label: string
  render: (s: number) => string
}

/** 生成一个带彩色圆角矩形底 + 白色文字/图形的简单文件图标。 */
function badgeIcon(s: number, color: string, text: string): string {
  return `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="${color}"/>
      <text x="12" y="16" font-family="Arial, sans-serif" font-size="10" font-weight="700"
        fill="#fff" text-anchor="middle">${text}</text>
    </svg>`
}

/** 文本类图标（带折角的文档轮廓）。 */
function docIcon(s: number, color: string, lines: string): string {
  return `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="${color}"/>
      <path d="M15 2v5h5" fill="#fff" opacity="0.5"/>
      ${lines}
    </svg>`
}

function codeDocIcon(s: number, color: string): string {
  return `
    <svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="${color}"/>
      <path d="M9 9l-3 3 3 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M15 9l3 3-3 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
}

const ext = computed(() => {
  if (!props.name) return ''
  const base = props.name.toLowerCase()
  const lastDot = base.lastIndexOf('.')
  return lastDot >= 0 ? base.slice(lastDot + 1) : ''
})

const spec = computed<IconSpec>(() => {
  const e = ext.value
  switch (e) {
    case 'html':
    case 'htm':
      return { color: '#e44d26', label: 'HTML', render: (s) => badgeIcon(s, '#e44d26', 'HTML') }
    case 'md':
    case 'markdown':
      return { color: '#3a5cff', label: 'Markdown', render: (s) => docIcon(s, '#4f6ef7', '<rect x="8" y="10" width="8" height="1.6" rx="0.8" fill="#fff"/><rect x="8" y="13" width="5" height="1.6" rx="0.8" fill="#fff"/>') }
    case 'ppt':
    case 'pptx':
      return { color: '#d24726', label: 'PPT', render: (s) => badgeIcon(s, '#d24726', 'PPT') }
    case 'pdf':
      return { color: '#e74040', label: 'PDF', render: (s) => badgeIcon(s, '#e74040', 'PDF') }
    case 'json':
      return { color: '#f7b731', label: 'JSON', render: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="3" fill="#f7b731"/><path d="M10 7l-3 5 3 5" stroke="#4a3f00" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 7l3 5-3 5" stroke="#4a3f00" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` }
    case 'ts':
      return { color: '#3178c6', label: 'TypeScript', render: (s) => badgeIcon(s, '#3178c6', 'TS') }
    case 'js':
    case 'mjs':
    case 'cjs':
      return { color: '#f7df1e', label: 'JavaScript', render: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="3" fill="#f7df1e"/><text x="12" y="16" font-family="Arial, sans-serif" font-size="9" font-weight="900" fill="#3d3d00" text-anchor="middle">JS</text></svg>` }
    case 'sh':
    case 'bash':
      return { color: '#4eaa25', label: 'Shell', render: (s) => badgeIcon(s, '#4eaa25', 'sh') }
    case 'bat':
    case 'cmd':
      return { color: '#2b2b2b', label: 'Batch', render: (s) => badgeIcon(s, '#2b2b2b', 'BAT') }
    case 'css':
    case 'scss':
    case 'less':
      return { color: '#2965f1', label: 'CSS', render: (s) => badgeIcon(s, '#2965f1', 'CSS') }
    case 'py':
      return { color: '#3776ab', label: 'Python', render: (s) => badgeIcon(s, '#3776ab', 'py') }
    case 'java':
      return { color: '#e76f00', label: 'Java', render: (s) => badgeIcon(s, '#e76f00', 'J') }
    case 'c':
    case 'h':
      return { color: '#555555', label: 'C', render: (s) => badgeIcon(s, '#555555', 'C') }
    case 'cpp':
    case 'cc':
    case 'cxx':
      return { color: '#00599c', label: 'C++', render: (s) => badgeIcon(s, '#00599c', 'C++') }
    case 'go':
      return { color: '#00add8', label: 'Go', render: (s) => badgeIcon(s, '#00add8', 'GO') }
    case 'rs':
      return { color: '#dea584', label: 'Rust', render: (s) => badgeIcon(s, '#dea584', 'RS') }
    case 'php':
      return { color: '#777bb4', label: 'PHP', render: (s) => badgeIcon(s, '#777bb4', 'PHP') }
    case 'vue':
      return { color: '#42b883', label: 'Vue', render: (s) => badgeIcon(s, '#42b883', 'VUE') }
    case 'sql':
      return { color: '#e38d13', label: 'SQL', render: (s) => badgeIcon(s, '#e38d13', 'SQL') }
    case 'yml':
    case 'yaml':
      return { color: '#cb171e', label: 'YAML', render: (s) => badgeIcon(s, '#cb171e', 'YML') }
    case 'xml':
    case 'svg':
      return { color: '#ff6600', label: 'XML', render: (s) => codeDocIcon(s, '#ff6600') }
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'ico':
      return { color: '#8b5cf6', label: 'Image', render: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="3" fill="#8b5cf6"/><circle cx="9" cy="9" r="1.8" fill="#fff"/><path d="M4 18l5-5 3 3 4-4 4 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2z" fill="#fff" opacity="0.85"/></svg>` }
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return { color: '#9b9b9b', label: 'Archive', render: (s) => badgeIcon(s, '#9b9b9b', 'ZIP') }
    case 'doc':
    case 'docx':
      return { color: '#2b579a', label: 'Word', render: (s) => badgeIcon(s, '#2b579a', 'DOC') }
    case 'xls':
    case 'xlsx':
    case 'csv':
      return { color: '#217346', label: 'Excel', render: (s) => badgeIcon(s, '#217346', 'XLS') }
    case 'txt':
    case 'log':
      return { color: '#7c8a99', label: 'Text', render: (s) => docIcon(s, '#7c8a99', '<rect x="8" y="10" width="8" height="1.6" rx="0.8" fill="#fff"/><rect x="8" y="13" width="5" height="1.6" rx="0.8" fill="#fff"/>') }
    default:
      return { color: '#8b95a5', label: 'File', render: (s) => docIcon(s, '#8b95a5', '<rect x="8" y="10" width="8" height="1.6" rx="0.8" fill="#fff"/><rect x="8" y="13" width="5" height="1.6" rx="0.8" fill="#fff"/>') }
  }
})

const iconSvg = computed(() => {
  const s = size.value
  if (props.name && ext.value === '') {
    // 无扩展名视为文本文件
    return docIcon(s, '#7c8a99', '<rect x="8" y="10" width="8" height="1.6" rx="0.8" fill="#fff"/><rect x="8" y="13" width="5" height="1.6" rx="0.8" fill="#fff"/>')
  }
  return spec.value.render(s)
})

const title = computed(() => spec.value.label)
</script>

<template>
  <span class="file-type-icon" :title="title" v-html="iconSvg" />
</template>

<style scoped>
.file-type-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 0;
}
.file-type-icon :deep(svg) {
  display: block;
}
</style>
