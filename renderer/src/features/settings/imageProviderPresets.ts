export interface ImageProviderPreset {
  label: string
  value: string
  model: string
  baseUrl: string
  hint: string
}

export const imageProviderPresets: ImageProviderPreset[] = [
  {
    label: 'GPT-Image-2 (OpenAI)',
    value: 'gpt-image-openai',
    model: 'gpt-image-1',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI 官方图片生成接口，支持 gpt-image-1。需要 OpenAI API Key。'
  },
  {
    label: 'GPT-Image-2 (云雾 AI)',
    value: 'gpt-image-yunwu',
    model: 'gpt-image-1',
    baseUrl: 'https://yunwu.ai/v1',
    hint: '云雾 AI 中转，兼容 OpenAI 格式。适合国内用户使用 GPT-Image 系列模型。'
  },
  {
    label: 'FLUX.1 (SiliconFlow)',
    value: 'flux-siliconflow',
    model: 'black-forest-labs/FLUX.1-schnell',
    baseUrl: 'https://api.siliconflow.cn/v1',
    hint: 'SiliconFlow 提供的 FLUX.1 系列模型。模型示例：FLUX.1-schnell / FLUX.1-dev。'
  },
  {
    label: 'ModelScope 魔搭（图片生成）',
    value: 'modelscope-image',
    model: 'Qwen/Qwen-Image',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    hint: 'ModelScope（魔搭/魔塔社区）图片生成，支持 Qwen/Qwen-Image、Qwen/Qwen-Image-Edit、black-forest-labs/FLUX.1-dev、MAILAND/majicflus_v1、ChaosMY/MYkawaii4MJ 等模型。'
  },
  {
    label: 'Doubao Seedream 3.0 (火山引擎)',
    value: 'doubao-seedream',
    model: 'doubao-seedream-3.0',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    hint: '字节跳动火山引擎旗下的 Seedream 图片生成模型。'
  },
  {
    label: 'Kolors (快手可图)',
    value: 'kolors-siliconflow',
    model: 'Kwai-Kolors/Kolors',
    baseUrl: 'https://api.siliconflow.cn/v1',
    hint: 'SiliconFlow 提供的快手 Kolors 可图模型，适合生成高质量中文风格封面。'
  },
  {
    label: 'Stable Diffusion OpenAI兼容',
    value: 'sd-openai-compatible',
    model: 'stable-diffusion-xl-1024-v1-0',
    baseUrl: 'https://api.stability.ai/v2beta',
    hint: 'Stable Diffusion 的 OpenAI 兼容接口。若使用第三方/本地中转，请填写对应 Base URL 与模型名。'
  },
  {
    label: 'DALL·E 3 (OpenAI)',
    value: 'dall-e-3-openai',
    model: 'dall-e-3',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI 官方 DALL·E 3 图片生成模型。需要 OpenAI API Key。'
  },
  {
    label: 'Gemini Imagen (谷歌)',
    value: 'gemini-imagen-google',
    model: 'imagen-3.0-generate-002',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    hint: '谷歌 Gemini 平台的 Imagen 图片生成模型，需谷歌 API Key。'
  },
  {
    label: '通义万相 (阿里百炼)',
    value: 'tongyi-wanx-alibaba',
    model: 'wanx2.1-t2i-turbo',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    hint: '阿里百炼（DashScope）通义万相图片生成模型，需阿里云百炼 API Key。'
  },
  {
    label: '文心一格 (百度千帆)',
    value: 'wenxin-yige-baidu',
    model: 'ernie-vilg',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ernievilg/v1/txt2img',
    hint: '百度千帆文心一格图片生成接口，需百度智能云 API Key。'
  },
  {
    label: 'Stable Image Core',
    value: 'stable-image-core',
    model: 'stable-image-core',
    baseUrl: 'https://api.stability.ai/v2beta',
    hint: 'Stability AI 官方 Stable Image Core 图片生成模型。'
  },
  {
    label: 'Midjourney 中转API',
    value: 'midjourney-proxy',
    model: '',
    baseUrl: '',
    hint: 'Midjourney 中转 API（第三方代理）。请手动填写中转商提供的模型名和 Base URL。'
  },
  {
    label: 'Ideogram 2.0',
    value: 'ideogram-2',
    model: 'V_2',
    baseUrl: 'https://api.ideogram.ai',
    hint: 'Ideogram 官方 API，支持 Ideogram 2.0 模型。需要 Ideogram API Key。'
  },
  {
    label: 'ComfyUI API',
    value: 'comfyui-api',
    model: '',
    baseUrl: 'http://127.0.0.1:8188',
    hint: '本地 ComfyUI 服务接口，默认地址 127.0.0.1:8188，需本地运行 ComfyUI。'
  },
  {
    label: 'SD WebUI API',
    value: 'sd-webui-api',
    model: '',
    baseUrl: 'http://127.0.0.1:7860',
    hint: '本地 Stable Diffusion WebUI 接口，默认地址 127.0.0.1:7860，需开启 --api 参数。'
  },
  {
    label: 'Flux OpenAI兼容中转',
    value: 'flux-openai-compatible',
    model: '',
    baseUrl: '',
    hint: 'Flux 的 OpenAI 兼容中转接口（第三方）。请手动填写中转商提供的模型名和 Base URL。'
  },
  {
    label: 'Pollinations',
    value: 'pollinations',
    model: '',
    baseUrl: 'https://gen.pollinations.ai',
    hint: 'Pollinations 开放的图片生成服务，Base URL 可使用 https://gen.pollinations.ai 或 https://image.pollinations.ai。'
  },
  {
    label: 'ModelScope（魔搭社区）',
    value: 'modelscope',
    model: '',
    baseUrl: 'https://api-inference.modelscope.cn',
    hint: '阿里达摩院魔搭社区 ModelScope 的推理服务接口，需魔搭 API Key。'
  },
  {
    label: 'Hugging Face',
    value: 'huggingface',
    model: '',
    baseUrl: 'https://router.huggingface.co',
    hint: 'Hugging Face 推理服务，Base URL 可使用 https://router.huggingface.co 或 https://api-inference.huggingface.co，需 HF Token。'
  },
  {
    label: 'Pixazo',
    value: 'pixazo',
    model: '',
    baseUrl: 'https://gateway.pixazo.ai',
    hint: 'Pixazo 图片生成网关服务，需 Pixazo API Key。'
  },
  {
    label: 'Replicate',
    value: 'replicate',
    model: '',
    baseUrl: 'https://api.replicate.com/v1',
    hint: 'Replicate 模型托管平台，Base URL 为 https://api.replicate.com/v1，需 Replicate API Token。'
  },
  {
    label: 'fal.ai',
    value: 'fal-ai',
    model: '',
    baseUrl: 'https://fal.run',
    hint: 'fal.ai 模型推理服务，Base URL 可使用 https://fal.run 或 https://queue.fal.run，需 fal 平台 Key。'
  },
  {
    label: 'Cloudflare Workers AI',
    value: 'cloudflare-workers-ai',
    model: '',
    baseUrl: '',
    hint: 'Cloudflare Workers AI。Base URL 为自建 Worker 后的 https://你的子域名.workers.dev（或官方 Workers AI 端点），需 Worker 部署后填写。'
  },
  {
    label: 'Leonardo AI',
    value: 'leonardo-ai',
    model: '',
    baseUrl: 'https://cloud.leonardo.ai/api/rest/v1',
    hint: 'Leonardo AI 官方 API，Base URL 为 https://cloud.leonardo.ai/api/rest/v1，需 Leonardo API Key。'
  },
  {
    label: 'Stability AI',
    value: 'stability-ai',
    model: '',
    baseUrl: 'https://api.stability.ai',
    hint: 'Stability AI 官方 API，Base URL 为 https://api.stability.ai，需 Stability AI API Key。'
  },
  {
    label: 'ModelScope 魔搭（FLUX.1-dev）',
    value: 'modelscope-flux-dev',
    model: 'AI-ModelScope/FLUX.1-dev',
    baseUrl: 'https://api-inference.modelscope.cn',
    hint: '魔搭社区 ModelScope 图片生成模型（如 FLUX.1-dev 等），需 ModelScope API Key。'
  },
  {
    label: '通用 OpenAI 兼容接口',
    value: 'custom-openai-compatible',
    model: '',
    baseUrl: '',
    hint: '自定义 OpenAI 兼容的图片生成接口，请手动填写模型名和 Base URL。'
  }
]

export const imageProviderOptions = imageProviderPresets.map(({ label, value }) => ({ label, value }))

export function getImageProviderPreset(value: string): ImageProviderPreset {
  return imageProviderPresets.find((item) => item.value === value) ?? imageProviderPresets[imageProviderPresets.length - 1]
}

export function resolveImageProviderDefaults(value: string): { model: string; baseUrl: string } {
  const preset = getImageProviderPreset(value)
  return {
    model: preset.model,
    baseUrl: preset.baseUrl
  }
}

/** 图片生成厂商的官网地址，用于「打开模型厂商官网」按钮 */
const IMAGE_PROVIDER_WEBSITES: Record<string, string> = {
  'gpt-image-openai': 'https://platform.openai.com/docs/guides/images',
  'gpt-image-yunwu': 'https://yunwu.ai',
  'flux-siliconflow': 'https://cloud.siliconflow.cn',
  'modelscope-image': 'https://www.modelscope.cn',
  'doubao-seedream': 'https://www.volcengine.com/product/ark',
  'kolors-siliconflow': 'https://cloud.siliconflow.cn',
  'sd-openai-compatible': 'https://stability.ai',
  'dall-e-3-openai': 'https://platform.openai.com/docs/guides/images',
  'gemini-imagen-google': 'https://ai.google.dev/gemini-api/docs/image-generation',
  'tongyi-wanx-alibaba': 'https://bailian.console.aliyun.com',
  'wenxin-yige-baidu': 'https://cloud.baidu.com/product/wenxinworkshop',
  'stable-image-core': 'https://stability.ai',
  'midjourney-proxy': 'https://www.midjourney.com',
  'ideogram-2': 'https://ideogram.ai',
  'comfyui-api': 'https://www.comfy.org',
  'sd-webui-api': 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
  'flux-openai-compatible': 'https://docs.bfl.ai',
  'pollinations': 'https://pollinations.ai',
  'modelscope': 'https://www.modelscope.cn',
  'huggingface': 'https://huggingface.co',
  'pixazo': 'https://www.pixazo.ai',
  'replicate': 'https://replicate.com',
  'fal-ai': 'https://fal.ai',
  'cloudflare-workers-ai': 'https://developers.cloudflare.com/workers-ai',
  'leonardo-ai': 'https://leonardo.ai',
  'stability-ai': 'https://stability.ai',
  'modelscope-flux-dev': 'https://www.modelscope.cn',
  'custom-openai-compatible': 'https://platform.openai.com/docs/api-reference'
}

/** 根据图片生成服务预设返回对应的厂商官网地址 */
export function resolveImageProviderWebsite(value: string): string {
  return IMAGE_PROVIDER_WEBSITES[value] ?? 'https://platform.openai.com/docs/api-reference'
}
