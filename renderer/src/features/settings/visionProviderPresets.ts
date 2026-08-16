/**
 * 图片识别（视觉）模型配置预设。
 *
 * 图片识别用于「识别人物图片 → 反推人物卡片」，走 OpenAI 兼容的 /chat/completions 接口，
 * 因此这里只保留支持「图像理解 / 视觉识别」的模型厂商（如图像输入、多模态理解），
 * 不包含 Midjourney / FLUX / Stable Diffusion 等纯图片生成厂商。
 *
 * 每个预设包含独立的模型名、Base URL，用于快速填充图片识别配置。
 */

export interface VisionProviderPreset {
  label: string
  value: string
  model: string
  baseUrl: string
  hint: string
}

/** 图片识别（视觉理解）厂商预设 */
export const visionProviderPresets: VisionProviderPreset[] = [
  {
    label: 'OpenAI (GPT-4o)',
    value: 'vision-openai',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI GPT-4o / gpt-4o-mini 等支持图像输入的多模态模型。'
  },
  {
    label: 'Anthropic Claude',
    value: 'vision-anthropic',
    model: 'claude-sonnet-4-6',
    baseUrl: 'https://api.anthropic.com/v1',
    hint: 'Anthropic Claude 系列支持图像输入，需 Claude API Key。'
  },
  {
    label: 'Google Gemini',
    value: 'vision-gemini',
    model: 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    hint: 'Google Gemini 原生支持图像理解，走 OpenAI 兼容入口。'
  },
  {
    label: '智谱 GLM-4V (BigModel)',
    value: 'vision-zhipu',
    model: 'glm-4v-plus',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hint: '智谱 GLM-4V 系列视觉理解模型。'
  },
  {
    label: '阿里百炼 Qwen-VL',
    value: 'vision-qwen',
    model: 'qwen-vl-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    hint: '阿里云百炼通义千问视觉理解模型，如 qwen-vl-plus / qwen2.5-vl。'
  },
  {
    label: '百度千帆文心（视觉）',
    value: 'vision-wenxin',
    model: 'ernie-4.0-vision',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    hint: '百度千帆文心大模型视觉理解接口（v2 兼容模式）。'
  },
  {
    label: 'Kimi 视觉 (月之暗面)',
    value: 'vision-moonshot',
    model: 'kimi-latest',
    baseUrl: 'https://api.moonshot.cn/v1',
    hint: '月之暗面 Kimi 支持图像输入，如 kimi-latest / kimi-k2.6。'
  },
  {
    label: '火山方舟豆包视觉',
    value: 'vision-volcengine',
    model: 'doubao-1.5-vision-pro',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    hint: '火山方舟豆包视觉理解模型，模型名可填推理接入点 ID。'
  },
  {
    label: '阶跃星辰 StepFun 视觉',
    value: 'vision-stepfun',
    model: 'step-1v',
    baseUrl: 'https://api.stepfun.com/v1',
    hint: '阶跃星辰 Step-1V 等视觉理解模型。'
  },
  {
    label: 'MiniMax 视觉',
    value: 'vision-minimax',
    model: 'MiniMax-VL-01',
    baseUrl: 'https://api.minimax.chat/v1',
    hint: 'MiniMax 视觉理解模型。'
  },
  {
    label: '腾讯混元视觉',
    value: 'vision-hunyuan',
    model: 'hunyuan-vision',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    hint: '腾讯混元视觉理解模型。'
  },
  {
    label: 'AtomGit（GitCode）视觉模型',
    value: 'vision-atomgit',
    model: 'Qwen/Qwen3-VL-8B-Instruct',
    baseUrl: 'https://api-ai.gitcode.com/v1',
    hint: 'GitCode / AtomGit 平台托管的视觉模型，如 Qwen/Qwen3-VL-8B-Instruct、doubao-seed-evolving-vl、deepseek-v4-flash 等。'
  },
  {
    label: 'ModelScope 魔搭（视觉）',
    value: 'vision-modelscope',
    model: 'Qwen/Qwen2.5-VL-7B-Instruct',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    hint: 'ModelScope（魔搭/魔塔社区）视觉理解模型，如 Qwen/Qwen2.5-VL-7B/14B/72B-Instruct 等。'
  },
  {
    label: '通用 OpenAI 兼容识别接口',
    value: 'vision-custom',
    model: '',
    baseUrl: '',
    hint: '自定义 OpenAI 兼容的图片识别接口，请手动填写模型名和 Base URL。'
  }
]

export const visionProviderOptions = visionProviderPresets.map(({ label, value }) => ({ label, value }))

/** 根据图片识别服务预设返回对应的模型厂商官网地址 */
const VISION_PROVIDER_WEBSITES: Record<string, string> = {
  'vision-openai': 'https://platform.openai.com/docs/guides/vision',
  'vision-anthropic': 'https://docs.anthropic.com/en/docs/build-with-claude/vision',
  'vision-gemini': 'https://ai.google.dev/gemini-api/docs/vision',
  'vision-zhipu': 'https://open.bigmodel.cn/dev/howuse/glm-4v',
  'vision-qwen': 'https://help.aliyun.com/zh/model-studio/vision',
  'vision-wenxin': 'https://cloud.baidu.com/doc/WENXINWORKSHOP/s/2ltwsk2fu',
  'vision-moonshot': 'https://platform.moonshot.cn/docs/guide/vision',
  'vision-volcengine': 'https://www.volcengine.com/docs/82379',
  'vision-stepfun': 'https://platform.stepfun.com/docs/guide/vision',
  'vision-minimax': 'https://platform.minimaxi.com/document/vision',
  'vision-hunyuan': 'https://cloud.tencent.com/document/product/1729',
  'vision-atomgit': 'https://atomgit.com/setting/token-classic',
  'vision-modelscope': 'https://www.modelscope.cn',
  'vision-custom': 'https://platform.openai.com/docs/guides/vision'
}

export function resolveVisionProviderWebsite(value: string): string {
  return VISION_PROVIDER_WEBSITES[value] ?? 'https://platform.openai.com/docs/guides/vision'
}

export function resolveVisionProviderDefaults(value: string): { model: string; baseUrl: string } {
  const preset = visionProviderPresets.find((item) => item.value === value)
  if (!preset) return { model: '', baseUrl: '' }
  return { model: preset.model, baseUrl: preset.baseUrl }
}
