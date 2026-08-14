/**
 * 语音识别（ASR / STT）服务配置预设。
 *
 * 语音识别用于「语音输入 → 自动填入输入框」，走各厂商的语音转文字接口。
 * 不同厂商的鉴权与协议各不相同：
 *  - 海外云端 / 本地自托管 / 聚合中转多支持 OpenAI 兼容的 /audio/transcriptions 接口；
 *  - 国内厂商（火山 / 百度 / 阿里 / 讯飞 / 腾讯 / 华为）使用各自的私有签名协议，
 *    配置时需按厂商文档填写对应的 API Key 与 Base URL。
 *
 * 每个预设包含独立的模型名、Base URL，用于快速填充语音识别配置。
 */

export interface SpeechProviderPreset {
  label: string
  value: string
  model: string
  baseUrl: string
  hint: string
  website: string
}

/** 语音识别厂商预设 */
export const speechProviderPresets: SpeechProviderPreset[] = [
  // ── Groq（置顶推荐）──
  {
    label: 'Groq',
    value: 'speech-groq',
    model: 'whisper-large-v3-turbo',
    baseUrl: 'https://api.groq.com/openai/v1',
    hint: 'Groq Whisper 语音转写，走 OpenAI 兼容的 /audio/transcriptions 接口，需 Groq API Key。'
    website: 'https://groq.com'
  },

  // ── 国内云厂商 ──
  {
    label: '火山引擎语音识别',
    value: 'speech-volcengine',
    model: 'volcengine-asr',
    baseUrl: 'https://openspeech.bytedance.com',
    hint: '火山引擎语音识别（语音转写），需火山引擎语音服务 App ID / Access Token。',
    website: 'https://www.volcengine.com/speech'
  },
  {
    label: '百度智能云语音识别',
    value: 'speech-baidu',
    model: 'baidu-asr',
    baseUrl: 'https://aip.baidubce.com',
    hint: '百度智能云语音识别（短语音 / 极速版），需百度智能云 API Key + Secret Key。',
    website: 'https://ai.baidu.com/tech/speech/asr'
  },
  {
    label: '阿里云通义语音（DashScope）',
    value: 'speech-alibaba',
    model: 'paraformer-realtime-v2',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    hint: '阿里云通义语音（DashScope）Paraformer 语音识别，需 DashScope API Key。',
    website: 'https://www.aliyun.com/product/bailian'
  },
  {
    label: '科大讯飞语音听写',
    value: 'speech-xfyun',
    model: 'xfyun-iat',
    baseUrl: 'https://iat-api.xfyun.cn/v2',
    hint: '科大讯飞语音听写（iat），需讯飞开放平台 APPID / APIKey / APISecret。',
    website: 'https://www.xfyun.cn/services/voicedictation'
  },
  {
    label: '腾讯云语音识别',
    value: 'speech-tencent',
    model: 'tencent-asr',
    baseUrl: 'https://asr.tencentcloudapi.com',
    hint: '腾讯云语音识别（实时 / 录音文件识别），需腾讯云 SecretId / SecretKey。',
    website: 'https://cloud.tencent.com/product/asr'
  },
  {
    label: '华为云语音识别',
    value: 'speech-huawei',
    model: 'huawei-asr',
    baseUrl: 'https://sis.cn-north-4.myhuaweicloud.com',
    hint: '华为云语音识别服务（SIS），需华为云账号与访问密钥（AK/SK）。',
    website: 'https://www.huaweicloud.com/product/sis.html'
  },

  // ── 海外云端 ASR（OpenAI 兼容音频接口）──
  {
    label: 'OpenAI Whisper API',
    value: 'speech-openai',
    model: 'whisper-1',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI Whisper 语音转写，走 /audio/transcriptions，需 OpenAI API Key。',
    website: 'https://platform.openai.com'
  },
  {
    label: 'Deepgram',
    value: 'speech-deepgram',
    model: 'nova-3',
    baseUrl: 'https://api.deepgram.com/v1',
    hint: 'Deepgram 语音识别，需 Deepgram API Key。',
    website: 'https://deepgram.com'
  },
  {
    label: 'AssemblyAI',
    value: 'speech-assemblyai',
    model: 'universal',
    baseUrl: 'https://api.assemblyai.com/v2',
    hint: 'AssemblyAI 语音识别，需 AssemblyAI API Key。',
    website: 'https://www.assemblyai.com'
  },
  {
    label: 'ElevenLabs Scribe',
    value: 'speech-elevenlabs',
    model: 'scribe_v1',
    baseUrl: 'https://api.elevenlabs.io/v1',
    hint: 'ElevenLabs Scribe 语音转写，需 ElevenLabs API Key。',
    website: 'https://elevenlabs.io'
  },
  {
    label: 'Azure OpenAI（Whisper）',
    value: 'speech-azure',
    model: 'whisper',
    baseUrl: 'https://{你的资源名}.openai.azure.com',
    hint: 'Azure OpenAI Whisper，需替换为你的 Azure 资源域名与 API Key。',
    website: 'https://azure.microsoft.com/zh-cn/products/ai-services/openai-service'
  },

  // ── 本地自托管开源 ASR（OpenAI 兼容）──
  {
    label: 'FunASR OpenAI 服务',
    value: 'speech-funasr',
    model: 'funasr',
    baseUrl: 'http://127.0.0.1:8000/v1',
    hint: 'FunASR 本地 OpenAI 兼容服务，默认 127.0.0.1:8000，需本地运行 FunASR。',
    website: 'https://github.com/modelscope/FunASR'
  },
  {
    label: 'Faster-Whisper API (Speaches)',
    value: 'speech-faster-whisper',
    model: 'faster-whisper',
    baseUrl: 'http://127.0.0.1:8000/v1',
    hint: 'Faster-Whisper (Speaches) 本地 OpenAI 兼容服务，默认 127.0.0.1:8000。',
    website: 'https://github.com/speaches-ai/speaches'
  },
  {
    label: 'Whisper.cpp API 服务',
    value: 'speech-whisper-cpp',
    model: 'whisper.cpp',
    baseUrl: 'http://127.0.0.1:8080/v1',
    hint: 'Whisper.cpp 本地 OpenAI 兼容服务，默认 127.0.0.1:8080。',
    website: 'https://github.com/ggerganov/whisper.cpp'
  },
  {
    label: 'SenseVoice API',
    value: 'speech-sensevoice',
    model: 'sensevoice',
    baseUrl: 'http://127.0.0.1:8000/v1',
    hint: 'SenseVoice 本地 OpenAI 兼容服务，默认 127.0.0.1:8000。',
    website: 'https://github.com/FunAudioLLM/SenseVoice'
  },

  // ── API 聚合中转平台 ──
  {
    label: '词元跳动（TokenDance）',
    value: 'speech-tokendance',
    model: 'whisper-1',
    baseUrl: 'https://api.tokendance.com/v1',
    hint: 'TokenDance 聚合中转，兼容 OpenAI 音频转写接口，需 TokenDance API Key。',
    website: 'https://tokendance.com'
  },

  // ── 通用 OpenAI 兼容识别接口 ──
  {
    label: '通用 OpenAI 兼容识别接口',
    value: 'speech-custom',
    model: '',
    baseUrl: '',
    hint: '自定义 OpenAI 兼容的语音识别接口，请手动填写模型名和 Base URL。',
    website: 'https://platform.openai.com/docs/api-reference/audio'
  }
]

export const speechProviderOptions = speechProviderPresets.map(({ label, value }) => ({ label, value }))

/** 根据语音识别服务预设返回对应的模型厂商官网地址 */
const SPEECH_PROVIDER_WEBSITES: Record<string, string> = {
  'speech-groq': 'https://groq.com',
  'speech-volcengine': 'https://www.volcengine.com/speech',
  'speech-baidu': 'https://ai.baidu.com/tech/speech/asr',
  'speech-alibaba': 'https://www.aliyun.com/product/bailian',
  'speech-xfyun': 'https://www.xfyun.cn/services/voicedictation',
  'speech-tencent': 'https://cloud.tencent.com/product/asr',
  'speech-huawei': 'https://www.huaweicloud.com/product/sis.html',
  'speech-openai': 'https://platform.openai.com',
  'speech-deepgram': 'https://deepgram.com',
  'speech-assemblyai': 'https://www.assemblyai.com',
  'speech-elevenlabs': 'https://elevenlabs.io',
  'speech-azure': 'https://azure.microsoft.com/zh-cn/products/ai-services/openai-service',
  'speech-funasr': 'https://github.com/modelscope/FunASR',
  'speech-faster-whisper': 'https://github.com/speaches-ai/speaches',
  'speech-whisper-cpp': 'https://github.com/ggerganov/whisper.cpp',
  'speech-sensevoice': 'https://github.com/FunAudioLLM/SenseVoice',
  'speech-groq': 'https://groq.com',
  'speech-tokendance': 'https://tokendance.com',
  'speech-custom': 'https://platform.openai.com/docs/api-reference/audio'
}

export function resolveSpeechProviderWebsite(value: string): string {
  return SPEECH_PROVIDER_WEBSITES[value] ?? 'https://platform.openai.com/docs/api-reference/audio'
}

export function resolveSpeechProviderDefaults(value: string): { model: string; baseUrl: string } {
  const preset = speechProviderPresets.find((item) => item.value === value)
  if (!preset) return { model: '', baseUrl: '' }
  return { model: preset.model, baseUrl: preset.baseUrl }
}
