import { imageProviderPresets, imageProviderOptions } from './imageProviderPresets'

export { imageProviderOptions as visionProviderOptions }

/**
 * 图片识别（视觉）模型配置预设。
 * 复用了图片生成的服务商预设，因为视觉识别同样走 OpenAI 兼容的 /chat/completions 接口，
 * 但使用独立的模型名、API Key 与 Base URL 配置，避免互相覆盖。
 */

/** 各服务商对应的模型厂商官网地址，用于「打开模型厂商官网」按钮 */
const PROVIDER_WEBSITES: Record<string, string> = {
  'gpt-image-openai': 'https://platform.openai.com/docs/guides/images',
  'gpt-image-yunwu': 'https://yunwu.ai',
  'flux-siliconflow': 'https://cloud.siliconflow.cn',
  'doubao-seedream': 'https://www.volcengine.com/product/ark',
  'kolors-siliconflow': 'https://cloud.siliconflow.cn',
  'sd-openai-compatible': 'https://stability.ai',
  'dall-e-3-openai': 'https://platform.openai.com/docs/guides/images',
  'gemini-imagen-google': 'https://ai.google.dev',
  'tongyi-wanx-alibaba': 'https://bailian.console.aliyun.com',
  'wenxin-yige-baidu': 'https://console.bce.baidu.com/qianfan/overview',
  'stable-image-core': 'https://stability.ai',
  'midjourney-proxy': 'https://www.midjourney.com',
  'ideogram-2': 'https://ideogram.ai',
  'comfyui-api': 'https://www.comfy.org',
  'sd-webui-api': 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
  'flux-openai-compatible': 'https://docs.bfl.ai',
  'custom-openai-compatible': 'https://platform.openai.com/docs/api-reference'
}

/** 根据图片/识别服务预设返回对应的模型厂商官网地址 */
export function resolveProviderWebsite(value: string): string {
  return PROVIDER_WEBSITES[value] ?? 'https://platform.openai.com/docs'
}

export function resolveImageProviderWebsite(value: string): string {
  return resolveProviderWebsite(value)
}

export function resolveVisionProviderWebsite(value: string): string {
  return resolveProviderWebsite(value)
}

/** 复用图片服务预设的默认值解析 */
export function resolveVisionProviderDefaults(value: string): { model: string; baseUrl: string } {
  const preset = imageProviderPresets.find((item) => item.value === value)
  if (!preset) return { model: '', baseUrl: '' }
  return { model: preset.model, baseUrl: preset.baseUrl }
}
