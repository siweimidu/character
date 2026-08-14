<script setup lang="ts">
/**
 * AiProviderIcon · AI 厂商品牌 SVG 图标
 *
 * 用一组轻量的内联 SVG 表现常用 AI 接口厂商标识，用于接口切换 / 上下文展示。
 * 未收录的厂商回退为通用机器人图标，保证任意 provider 都有可辨识图标。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 厂商 provider 值（如 deepseek / openai / anthropic）。 */
    provider?: string
    /** 图标尺寸。 */
    size?: number
  }>(),
  { provider: '', size: 16 }
)

const key = computed(() => (props.provider || '').trim().toLowerCase())

const deepseek = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M7.2 4.2c.9-.5 1.9-.7 2.9-.7.7 0 1.4.1 2 .4l-4.9 8.6V4.2z" fill="currentColor" opacity="0.85"/>
  <path d="M12 20.5a8.5 8.5 0 1 1 0-17c1.3 0 2.5.3 3.6.8-1.2 1.4-1.9 3.2-1.9 5.2 0 2 0.7 3.8 1.9 5.2a8.4 8.4 0 0 1-3.6 5.8z" fill="currentColor"/>
  <circle cx="8.4" cy="9.2" r="1.05" fill="var(--arc-bg-surface, #fff)"/>
</svg>`

const openai = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M9.2 6.6c1.4-2.4 4.6-3.1 6.9-1.6.9.6 1.5 1.4 1.8 2.4l-1.2-1.9c-1.3-2-4-2.5-5.9-1.2l-1.6 2.3z" fill="currentColor"/>
  <path d="M20 11.4c.3 2.8-1.7 5.3-4.5 5.6h-2.3l2.3.4c2.8.3 5.4-1.7 5.7-4.5v-.5c.1-.4.1-.7 0-1z" fill="currentColor" opacity="0.9"/>
  <path d="M4.4 14.7c-.5-.4-.9-.9-1.1-1.5-.7-1.8 0-3.8 1.7-4.8.7-.4 1.4-.5 2.1-.5l-1.5-1.1c-1.9-1.4-4.5-1-6 1-.6.8-.8 1.8-.6 2.7l1.4 4.2z" fill="currentColor" opacity="0.75"/>
</svg>`

const anthropic = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11.4 3 5.4 21h3.6l1.9-5.4h5L17.9 21h3.6L15.5 3h-4.1zm.8 9.7 1.5-4.2 1.5 4.2h-3z" fill="currentColor"/>
</svg>`

const gemini = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.5c.4 4.9 2 8.2 5.3 9.5C14 13.3 12.4 16.6 12 21.5c-.4-4.9-2-8.2-5.3-9.5C10 10.7 11.6 7.4 12 2.5z" fill="currentColor"/>
</svg>`

const qwen = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3c-4 0-7 2.6-7 6 0 3.1 2.6 5.6 6 6v2.4c0 .9.9 1.5 1.8 1.2l5-2c2-.8 3.2-2.5 3.2-4.5V9c0-3.4-3-6-7-6zm0 3.4c1.9 0 3.5 1.3 3.7 3H8.3c.2-1.7 1.8-3 3.7-3z" fill="currentColor"/>
</svg>`

const zhipu = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3a9 9 0 1 0 9 9 7.2 7.2 0 0 1-9-9z" fill="currentColor"/>
  <circle cx="15.5" cy="15.5" r="2.4" fill="var(--arc-bg-surface, #fff)"/>
</svg>`

const ollama = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3c-2 2-3 4.2-3 6.4C9 11.8 10.3 13.5 12 14c1.7-.5 3-2.2 3-4.6C15 7.2 14 5 12 3z" fill="currentColor"/>
  <path d="M12 14c-2.6.2-4.5 1.9-4.5 4.2 0 .6.4 1 1 1h7c.6 0 1-.4 1-1 0-2.3-1.9-4-4.5-4.2z" fill="currentColor" opacity="0.8"/>
</svg>`

const generic = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="7" width="16" height="12" rx="2.5" fill="currentColor" opacity="0.2"/>
  <rect x="7" y="4" width="10" height="5" rx="2" fill="currentColor"/>
</svg>`

const ICONS: Record<string, string> = {
  deepseek,
  openai,
  anthropic,
  gemini,
  qwen,
  zhipu,
  ollama
}

const iconSvg = computed(() => ICONS[key.value] ?? generic)
</script>

<template>
  <span
    class="api-icon"
    :style="{ width: `${size}px`, height: `${size}px` }"
    v-html="iconSvg"
  />
</template>

<style scoped>
.api-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: inherit;
}
.api-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
