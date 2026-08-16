import { describe, it, expect } from 'vitest'
import { isModelScopeBaseUrl, getModelScopeFallbackModels } from './models'

describe('ModelScope（魔搭/魔塔社区）模型列表补全', () => {
  it('能正确识别 ModelScope 的 baseUrl', () => {
    expect(isModelScopeBaseUrl('https://api-inference.modelscope.cn/v1')).toBe(true)
    expect(isModelScopeBaseUrl('https://api-inference.modelscope.cn')).toBe(true)
    expect(isModelScopeBaseUrl('https://www.modelscope.cn')).toBe(true)
    expect(isModelScopeBaseUrl('https://api.openai.com/v1')).toBe(false)
    expect(isModelScopeBaseUrl('')).toBe(false)
  })

  it('保底模型列表完整包含用户要求的全部模型 ID', () => {
    const required = [
      // 图片生成
      'Qwen/Qwen-Image',
      'Qwen/Qwen-Image-Edit',
      'black-forest-labs/FLUX.1-dev',
      'MAILAND/majicflus_v1',
      'ChaosMY/MYkawaii4MJ',
      // 文本
      'Qwen/Qwen2.5-7B-Instruct',
      'Qwen/Qwen2.5-14B-Instruct',
      'Qwen/Qwen2.5-32B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/QwQ-32B-Preview',
      'Qwen/Qwen2.5-Coder-7B-Instruct',
      'Qwen/Qwen2.5-Coder-14B-Instruct',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'deepseek-ai/DeepSeek-R1',
      'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
      'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
      'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
      'deepseek-ai/DeepSeek-V3',
      '01ai/Yi-9B-Chat',
      'internlm/internlm3-8b-instruct',
      'baichuan-inc/Baichuan4-Aither-7B-Chat',
      'MiniMax/MiniMax-M1-80k',
      // 视觉
      'Qwen/Qwen2.5-VL-7B-Instruct',
      'Qwen/Qwen2.5-VL-14B-Instruct',
      'Qwen/Qwen2.5-VL-72B-Instruct'
    ]
    const ids = new Set(getModelScopeFallbackModels().map((m) => m.id))
    const missing = required.filter((id) => !ids.has(id))
    expect(missing).toEqual([])
    expect(required.length).toBe(25)
  })
})
