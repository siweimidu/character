import type { AppSettings } from '../shared-types'
import { createProxyFetch } from '../proxy-fetch'

/**
 * 语音识别配置的专用字段名（AppSettings 中新增的语音识别配置）。
 * 这些字段独立于文本模型与图片识别配置，避免互相覆盖。
 */
export function normalizeSpeechSettings(settings: AppSettings): AppSettings {
  const source = settings ?? ({} as AppSettings)
  return {
    ...source,
    model: source.speechModel?.trim() || '',
    apiKey: source.speechApiKey?.trim() || '',
    baseUrl: source.speechBaseUrl?.trim() || ''
  }
}

export interface TranscribeSpeechResult {
  text: string
  model?: string
}

/**
 * 调用 OpenAI 兼容的「语音转文字」接口（/audio/transcriptions）。
 *
 * 适用于 OpenAI Whisper、Deepgram、AssemblyAI、ElevenLabs、Azure OpenAI、
 * FunASR、Faster-Whisper、Whisper.cpp、SenseVoice、TokenDance 等走
 * OpenAI 兼容音频转写协议的厂商。国内私有协议厂商（火山/百度/阿里/讯飞/腾讯/华为）
 * 请使用各自 SDK，此接口无法覆盖。
 *
 * @param settings - 应用配置（需包含 speechModel、speechBaseUrl、speechApiKey）
 * @param audioData - 待识别的音频字节
 * @param audioType - 音频 MIME 类型，例如 audio/webm
 */
export async function transcribeSpeech(
  settings: AppSettings,
  audioData: Uint8Array,
  audioType: string
): Promise<TranscribeSpeechResult> {
  const normalized = normalizeSpeechSettings(settings)
  if (!normalized.model.trim()) {
    throw new Error('请先在设置中填写专用的语音识别模型。')
  }
  if (!normalized.baseUrl.trim()) {
    throw new Error('请先在设置中填写专用的语音识别 Base URL。')
  }
  if (!normalized.apiKey.trim()) {
    throw new Error('请先在设置中填写专用的语音识别 API Key。')
  }
  if (!audioData || audioData.length === 0) {
    throw new Error('缺少待识别的音频数据。')
  }

  const base = normalized.baseUrl.replace(/\/$/, '')
  const url = `${base}/audio/transcriptions`

  // OpenAI 兼容音频转写为 multipart/form-data：file + model
  const boundary = `----arc-${Date.now().toString(36)}`
  const encoder = new TextEncoder()
  const header = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
    `Content-Type: ${audioType || 'audio/webm'}\r\n\r\n`
  )
  const footer = encoder.encode(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `${normalized.model}\r\n` +
    `--${boundary}--\r\n`
  )

  const body = new Uint8Array(header.length + audioData.length + footer.length)
  body.set(header, 0)
  body.set(audioData, header.length)
  body.set(footer, header.length + audioData.length)

  const requestFetch = createProxyFetch(settings.proxyUrl)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await requestFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalized.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: body.buffer as ArrayBuffer,
      signal: controller.signal
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`语音识别请求失败：${response.status} ${response.statusText}${text ? ` ${text}` : ''}`)
    }

    const data = (await response.json()) as { text?: string; model?: string }
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    if (!text) {
      throw new Error('语音识别接口未返回文字结果。')
    }
    return { text, model: data.model }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('语音识别请求超时，请检查网络或模型服务状态。')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
