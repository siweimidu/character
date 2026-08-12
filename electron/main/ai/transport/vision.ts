import type { AppSettings } from '../shared-types'
import { performAiRequest } from './http'
import { createProxyFetch } from '../proxy-fetch'

/**
 * 图片识别配置的专用字段名（AppSettings 中新增的视觉识别配置）。
 * 这些字段独立于文本模型与图片生成配置，避免互相覆盖。
 */
export function normalizeVisionSettings(settings: AppSettings): AppSettings {
  const source = settings ?? ({} as AppSettings)
  return {
    ...source,
    model: source.visionModel?.trim() || '',
    apiKey: source.visionApiKey?.trim() || '',
    baseUrl: source.visionBaseUrl?.trim() || ''
  }
}

export interface VisionProfileResult {
  name: string
  role: string
  appearance: string
  personality: string
  background: string
  tags: string[]
  description: string
}

/** 从 JSON 字符串中容错提取人物卡片字段 */
function parseVisionProfile(content: string): VisionProfileResult | null {
  if (!content) return null
  const text = content.trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  const raw = jsonMatch ? jsonMatch[0] : text
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const arr = (v: unknown): string[] => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
    return {
      name: String(obj.name ?? '').trim(),
      role: String(obj.role ?? '').trim(),
      appearance: String(obj.appearance ?? '').trim(),
      personality: String(obj.personality ?? '').trim(),
      background: String(obj.background ?? '').trim(),
      tags: arr(obj.tags),
      description: String(obj.description ?? '').trim()
    }
  } catch {
    return null
  }
}

/**
 * 调用 OpenAI 兼容的「图片识别 → 人物卡片」接口，根据人物图片反推人设字段。
 *
 * @param settings - 应用配置（需包含 visionModel、visionBaseUrl、visionApiKey）
 * @param imageDataUrl - 图片 data URL（例如 data:image/png;base64,...）
 * @returns 反推出来的人物卡片字段
 */
export async function recognizeCharacterImage(
  settings: AppSettings,
  imageDataUrl: string
): Promise<VisionProfileResult> {
  const normalized = normalizeVisionSettings(settings)
  if (!normalized.model.trim()) {
    throw new Error('请先在设置中填写专用的图片识别模型（不会自动回退到图片生成或文本模型）。')
  }
  if (!normalized.baseUrl.trim()) {
    throw new Error('请先在设置中填写专用的图片识别 Base URL。')
  }
  if (!normalized.apiKey.trim()) {
    throw new Error('请先在设置中填写专用的图片识别 API Key。')
  }
  if (!imageDataUrl) {
    throw new Error('缺少待识别的人物图片。')
  }

  const url = `${normalized.baseUrl.replace(/\/$/, '')}/chat/completions`
  const requestFetch = createProxyFetch(settings.proxyUrl)

  const systemPrompt =
    '你是一名资深人物角色设计师。请根据用户提供的人物图片，观察其外貌、气质、服饰与神态，' +
    '反推并脑补出完整的人物卡片设定。必须严格只输出一个 JSON 对象，不要输出任何多余文字，字段如下：\n' +
    '{\n' +
    '  "name": "给角色起一个贴合形象的中文姓名",\n' +
    '  "role": "角色定位，如：神秘医者 / 少年剑客",\n' +
    '  "appearance": "根据图片外貌写一段外貌描述，包含五官、发型、服饰、气质",\n' +
    '  "personality": "根据神态气质脑补的性格特征",\n' +
    '  "background": "根据形象脑补的背景故事与身世经历",\n' +
    '  "tags": ["标签1", "标签2", "标签3"],\n' +
    '  "description": "一段完整的人物简介，综合性格、背景与动机"\n' +
    '}'

  const body = JSON.stringify({
    model: normalized.model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请根据这张人物图片反推人物卡片设定。' },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ]
  })

  const response = await performAiRequest({
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalized.apiKey}`
      },
      body
    },
    providerLabel: '图片识别接口',
    requestFetch,
    timeoutMs: 90_000
  })

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = data.choices?.[0]?.message?.content
  const contentText = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  const parsed = parseVisionProfile(contentText)
  if (!parsed) {
    throw new Error('图片识别成功，但未能从返回内容中解析出人物卡片，请检查模型输出是否为 JSON。')
  }
  return parsed
}
