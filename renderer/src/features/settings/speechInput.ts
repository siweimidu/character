/**
 * 语音识别输入工具。
 *
 * 优先使用「设置 → 语音识别配置」中选定的语音识别厂商进行识别（OpenAI 兼容
 * /audio/transcriptions 接口），未配置厂商时回退到浏览器 Web Speech API。
 *
 * 返回的识别文本由调用方填入输入框。
 */

export interface SpeechInputHandle {
  stop: () => void
}

/**
 * 使用浏览器原生 Web Speech API 进行语音识别。
 * @returns 返回取消控制器，调用方可通过它停止识别。
 */
export function startBrowserSpeech(
  onResult: (text: string) => void,
  onEnd: () => void
): { stop: () => void; supported: boolean } {
  type SpeechRecognitionCtor = new () => {
    lang: string
    continuous: boolean
    interimResults: boolean
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void
    onend: () => void
    onerror: (e: { error: string }) => void
    start: () => void
    stop: () => void
    abort: () => void
  }
  const SR = (window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }).SpeechRecognition ?? (window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }).webkitSpeechRecognition
  if (!SR) {
    return { stop: () => {}, supported: false }
  }
  const recognition = new SR()
  recognition.lang = 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true
  recognition.onresult = (e) => {
    let text = ''
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0]?.transcript ?? ''
    }
    if (text) onResult(text)
  }
  recognition.onend = () => onEnd()
  recognition.onerror = () => onEnd()
  recognition.start()
  return { stop: () => recognition.stop(), supported: true }
}

/** 录音状态：start / listening / error */
export type RecorderPhase = 'idle' | 'listening' | 'error'

export interface SpeechRecorder {
  start: () => Promise<void>
  stop: () => Promise<string>
  abort: () => void
}

/**
 * 使用 MediaRecorder 采集麦克风音频，返回录音器。
 * 录音停止后通过 onStopped(audioData, mimeType) 交给调用方做识别。
 */
export function createSpeechRecorder(onStopped: (audioData: Uint8Array, mimeType: string) => void): SpeechRecorder {
  let mediaRecorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  const chunks: Blob[] = []

  return {
    async start(): Promise<void> {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }
      mediaRecorder.onstop = async () => {
        try {
          const type = mediaRecorder?.mimeType || mimeType || 'audio/webm'
          const blob = new Blob(chunks, { type })
          const buffer = await blob.arrayBuffer()
          onStopped(new Uint8Array(buffer), type)
        } finally {
          stream?.getTracks().forEach((track) => track.stop())
          stream = null
        }
      }
      mediaRecorder.start()
    },
    async stop(): Promise<string> {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop()
      }
      return ''
    },
    abort(): void {
      try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
      } catch {
        /* noop */
      }
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      chunks.length = 0
    }
  }
}
