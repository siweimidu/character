import type { CharacterCard } from '@/types/app'

/**
 * 将人物卡片内容转换为可直接喂给大模型的 Prompt 文本。
 * 依据酒馆角色卡 V2 规范组织字段，便于下游模型理解角色设定。
 */
export function buildCharacterPrompt(card: Partial<CharacterCard>): string {
  const sections: Array<[string, string]> = [
    ['角色名称', card.name?.trim() || ''],
    ['角色定位', card.role?.trim() || ''],
    ['外貌描述', card.appearance?.trim() || ''],
    ['性格', card.personality?.trim() || ''],
    ['背景故事', card.background?.trim() || ''],
    ['开局场景', card.scenario?.trim() || ''],
    ['开场白', card.greeting?.trim() || ''],
    ['对话示例', card.dialogueExamples?.trim() || ''],
    ['角色简介', card.description?.trim() || '']
  ]

  const lines: string[] = ['以下是一名小说角色的完整设定，请基于这些信息进行角色扮演或创作：']
  for (const [label, value] of sections) {
    if (!value) continue
    lines.push(`\n【${label}】\n${value}`)
  }

  const tags = [...(card.customTags ?? []), ...(card.tags ?? []).map((tag) => tag.label)]
    .filter((tag, index, arr) => tag && arr.indexOf(tag) === index)
  if (tags.length) {
    lines.push(`\n【角色标签】\n${tags.join('、')}`)
  }

  lines.push(
    '\n【扮演要求】\n始终保持角色人设一致，言行符合上述性格、背景与说话风格；回应使用中文，融入场景并推动剧情发展。'
  )
  return lines.join('\n')
}
