<script setup lang="ts">
/**
 * AiProviderIcon · AI 厂商品牌 SVG 图标
 *
 * 按用户要求：无论切换什么模型/厂商，统一使用 Gemini 的 SVG 图标。
 */
import { computed } from 'vue'

withDefaults(
  defineProps<{
    /** 厂商 provider 值（如 deepseek / openai / anthropic）。仅作兼容保留，不再影响图标。 */
    provider?: string
    /** 图标尺寸。 */
    size?: number
  }>(),
  { provider: '', size: 16 }
)

const gemini = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.5c.4 4.9 2 8.2 5.3 9.5C14 13.3 12.4 16.6 12 21.5c-.4-4.9-2-8.2-5.3-9.5C10 10.7 11.6 7.4 12 2.5z" fill="currentColor"/>
</svg>`

// 用户要求：无论切换什么模型/厂商，统一使用 Gemini 的 SVG 图标。
const iconSvg = computed(() => gemini)
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
