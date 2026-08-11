/**
 * SillyTavern 酒馆角色卡 V2 规范解析 / 序列化工具。
 *
 * - V2 JSON：`{ "spec": "chara_card_v2", "spec_version": "2.0", "data": {...} }`
 * - V1 JSON：`{ "name": ..., "description": ..., ... }`（兼容读取）
 * - PNG 角色卡：JSON 以 base64 形式存放在 PNG 的 `chara` tEXt 文本块中
 *
 * 本模块运行在主进程（Node 环境），负责文件级别的解析与写入。
 */

/** 角色卡数据字段（与 renderer 端 CharacterCard 核心字段一一对应） */
export interface StCharacterCardData {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  alternate_greetings: string[]
  character_book?: unknown
  tags: string[]
  creator: string
  character_version: string
  extensions: Record<string, unknown>
}

/** 归一化后的角色卡（ST V2 标准字段 + 头像 base64） */
export interface StParsedCard {
  name: string
  description: string
  appearance: string
  personality: string
  scenario: string
  greeting: string
  dialogueExamples: string
  tags: string[]
  avatar?: string
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CHARA_KEYWORD = 'chara'
const CHARA_V2_SPEC = 'chara_card_v2'

/** 判断是否为 PNG 文件（校验文件头签名） */
export function isPngBuffer(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
}

function decodeBase64Unicode(value: string): string {
  // 兼容 base64 与 URL-safe base64
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const buf = Buffer.from(normalized, 'base64')
    return buf.toString('utf-8')
  } catch {
    return ''
  }
}

/** 将 tEXt 块内容解码为角色卡 JSON 字符串（兼容 base64 与明文两种存储） */
function decodeCharaValue(value: string): string | null {
  if (!value) return null
  // 优先按 base64 解码并校验是否为合法 JSON
  const decoded = decodeBase64Unicode(value)
  if (decoded) {
    try {
      JSON.parse(decoded)
      return decoded
    } catch {
      // 不是 base64 编码的 JSON，回退到明文
    }
  }
  try {
    JSON.parse(value)
    return value
  } catch {
    return null
  }
}

/**
 * 从 PNG buffer 中解析出 `chara` tEXt 文本块内容（返回其 JSON 字符串）。
 * 支持 classic tEXt 块与 iTXt 块。
 */
export function extractCharaJsonFromPng(buffer: Buffer): string | null {
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd > buffer.length) break

    if (type === 'tEXt' || type === 'iTXt') {
      // 读取关键字（null 结尾）
      const nullIndex = buffer.indexOf(0, dataStart)
      if (nullIndex > dataStart && nullIndex < dataEnd) {
        const keyword = buffer.toString('latin1', dataStart, nullIndex)
        if (keyword === CHARA_KEYWORD) {
          if (type === 'tEXt') {
            const raw = buffer.toString('latin1', nullIndex + 1, dataEnd)
            return decodeCharaValue(raw)
          }
          // iTXt：关键字 \0 压缩标志(1) 压缩方法(1) 语言标签\0 翻译关键字\0 文本
          let cursor = nullIndex + 1
          // 跳过压缩标志与压缩方法
          cursor += 2
          const langEnd = buffer.indexOf(0, cursor)
          if (langEnd < 0 || langEnd >= dataEnd) break
          cursor = langEnd + 1
          const transEnd = buffer.indexOf(0, cursor)
          if (transEnd < 0 || transEnd >= dataEnd) break
          cursor = transEnd + 1
          const textBuf = buffer.subarray(cursor, dataEnd)
          // iTXt 若压缩标志为 1，则文本以 zlib 压缩存储
          return textBuf.toString('utf-8')
        }
      }
    }

    offset = dataEnd + 4 // 跳过 CRC
  }
  return null
}

/** 解析 PNG 角色卡，返回归一化角色卡数据 */
export function parsePngCharacterCard(buffer: Buffer): StParsedCard | null {
  const json = extractCharaJsonFromPng(buffer)
  if (!json) return null
  return parseCardJson(json)
}

/** 解析角色卡 JSON 字符串（兼容 V1 / V2） */
export function parseCardJson(json: string): StParsedCard | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  return normalizeCardPayload(parsed)
}

/** 将任意角色卡载荷规范化为 StParsedCard */
export function normalizeCardPayload(payload: unknown): StParsedCard | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>
  const spec = String(root.spec ?? '')

  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
    : []

  const card: StParsedCard = {
    name: str(data.name).trim(),
    description: str(data.description).trim(),
    appearance: str(data.appearance ?? data.avatar?.toString?.() ?? '').trim(),
    personality: str(data.personality).trim(),
    scenario: str(data.scenario).trim(),
    greeting: str(data.first_mes).trim(),
    dialogueExamples: str(data.mes_example).trim(),
    tags
  }

  // 提取头像：V2 通常有 avatar 字段（base64），V1 可能在 extensions 或直接 avatar
  if (typeof data.avatar === 'string' && data.avatar) {
    card.avatar = data.avatar
  }
  // 兼容 spec 的旧式字段
  if (!card.appearance && typeof data.appearance === 'undefined') {
    card.appearance = ''
  }
  void spec
  return card
}

/** 将归一化角色卡数据序列化为 ST V2 JSON 字符串 */
export function buildV2CardJson(card: StParsedCard, avatarBase64?: string): string {
  const data: Record<string, unknown> = {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.greeting,
    mes_example: card.dialogueExamples,
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    character_book: null,
    tags: card.tags,
    creator: 'CharacterArc',
    character_version: '1.0',
    extensions: {}
  }
  if (card.appearance) {
    data.appearance = card.appearance
  }
  if (avatarBase64) {
    data.avatar = avatarBase64
  }
  const wrapper = {
    spec: CHARA_V2_SPEC,
    spec_version: '2.0',
    data
  }
  return JSON.stringify(wrapper, null, 2)
}

/** 将 base64 头像数据解析为 Buffer（兼容带/不带 data URI 前缀） */
export function resolveAvatarBuffer(avatarBase64: string): Buffer | null {
  const cleaned = avatarBase64.includes('base64,') ? avatarBase64.split('base64,')[1] ?? '' : avatarBase64
  try {
    const buf = Buffer.from(cleaned, 'base64')
    return buf.length ? buf : null
  } catch {
    return null
  }
}

/** CRC32 计算（PNG 块校验） */
const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * 将角色卡 JSON 以 `chara` tEXt 块嵌入 PNG buffer。
 * 若已有 `chara` 块则覆盖；否则在 IEND 前追加。
 */
export function embedCharaJsonIntoPng(pngBuffer: Buffer, cardJson: string): Buffer {
  // SillyTavern 规范：角色卡 JSON 以 base64 形式存储在 chara tEXt 块中（纯 ASCII，兼容 latin1）
  const encoded = Buffer.from(cardJson, 'utf-8').toString('base64')
  const keywordBuf = Buffer.from(CHARA_KEYWORD, 'latin1')
  const textBuf = Buffer.from(encoded, 'latin1')
  const dataBuf = Buffer.concat([keywordBuf, Buffer.from([0]), textBuf])
  const newChunk = Buffer.alloc(8 + dataBuf.length + 4)
  newChunk.writeUInt32BE(dataBuf.length, 0)
  newChunk.write('tEXt', 4, 'ascii')
  dataBuf.copy(newChunk, 8)
  newChunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from('tEXt', 'ascii'), dataBuf])), 8 + dataBuf.length)

  // 移除已存在的 chara tEXt 块
  const chunks: Buffer[] = []
  let offset = 8
  while (offset + 8 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset)
    const type = pngBuffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const crcEnd = dataEnd + 4
    if (dataEnd > pngBuffer.length) break

    if (type === 'tEXt' || type === 'iTXt') {
      const nullIndex = pngBuffer.indexOf(0, dataStart)
      if (nullIndex > dataStart && nullIndex < dataEnd) {
        const keyword = pngBuffer.toString('latin1', dataStart, nullIndex)
        if (keyword === CHARA_KEYWORD) {
          offset = crcEnd
          continue
        }
      }
    }
    chunks.push(pngBuffer.subarray(offset, crcEnd))
    offset = crcEnd
  }

  // 在最后一个块（通常是 IEND）前插入新块
  const signature = pngBuffer.subarray(0, 8)
  const header = chunks[0] ?? Buffer.alloc(0)
  const rest = chunks.slice(1)
  return Buffer.concat([signature, header, newChunk, ...rest])
}
