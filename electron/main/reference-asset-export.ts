export type ReferenceAssetExportFormat = 'txt' | 'md' | 'json'

export interface ReferenceAssetExportDocument {
  title?: string
  sourceType?: string
  sourceTypeLabel?: string
  sourceLabel?: string
  summary?: string
  content?: string
  keywords?: string[]
  updatedAtLabel?: string
}

export interface ReferenceAssetExportAsset {
  title?: string
  source?: string
  fileName?: string
  notes?: string
  summary?: string
  topKeywords?: string[]
  styleRules?: string[]
  documentCount?: number
  summaryCount?: number
  chunkCount?: number
  chapterCount?: number
  characterCount?: number
  updatedAtLabel?: string
}

export function resolveReferenceAssetFileName(
  format: ReferenceAssetExportFormat,
  asset: ReferenceAssetExportAsset
): { baseName: string; extension: string } {
  const safeTitle = String(asset.title ?? '参考作品').trim() || '参考作品'
  const baseName = safeTitle.replace(/[\\/:*?"<>|]/g, '_')
  const extension = format === 'md' ? 'md' : format === 'txt' ? 'txt' : 'json'
  return { baseName, extension }
}

function buildMetaLine(asset: ReferenceAssetExportAsset): string {
  const keywordText = (asset.topKeywords ?? []).join('、')
  const ruleText = (asset.styleRules ?? []).join('、')
  return [
    asset.source ? `来源：${asset.source}` : '',
    asset.fileName ? `文件：${asset.fileName}` : '',
    keywordText ? `关键词：${keywordText}` : '',
    ruleText ? `风格规则：${ruleText}` : ''
  ].filter(Boolean).join('　')
}

export function buildReferenceAssetExportContent(
  format: ReferenceAssetExportFormat,
  asset: ReferenceAssetExportAsset,
  documents: ReferenceAssetExportDocument[]
): string {
  const safeTitle = String(asset.title ?? '参考作品').trim() || '参考作品'
  const metaLine = buildMetaLine(asset)

  if (format === 'json') {
    return JSON.stringify({
      asset: {
        title: safeTitle,
        source: asset.source ?? '',
        fileName: asset.fileName ?? '',
        notes: asset.notes ?? '',
        summary: asset.summary ?? '',
        topKeywords: asset.topKeywords ?? [],
        styleRules: asset.styleRules ?? [],
        documentCount: asset.documentCount ?? documents.length,
        summaryCount: asset.summaryCount ?? 0,
        chunkCount: asset.chunkCount ?? 0,
        chapterCount: asset.chapterCount ?? 0,
        characterCount: asset.characterCount ?? 0,
        updatedAtLabel: asset.updatedAtLabel ?? ''
      },
      documents: documents.map((doc) => ({
        title: doc.title ?? '',
        sourceType: doc.sourceType ?? '',
        sourceTypeLabel: doc.sourceTypeLabel ?? '',
        sourceLabel: doc.sourceLabel ?? '',
        summary: doc.summary ?? '',
        keywords: doc.keywords ?? [],
        updatedAtLabel: doc.updatedAtLabel ?? '',
        content: doc.content ?? ''
      }))
    }, null, 2)
  }

  if (format === 'md') {
    return [
      `# ${safeTitle}｜拆书资产`,
      '',
      metaLine || '参考作品拆书资产',
      '',
      asset.summary ? `> ${String(asset.summary).trim()}` : '',
      '',
      ...documents.map((doc) => [
        `## ${doc.title ?? '未命名文档'}`,
        '',
        `- 类型：${doc.sourceTypeLabel ?? doc.sourceType ?? '未知'}`,
        doc.sourceLabel ? `- 来源：${doc.sourceLabel}` : '',
        (doc.keywords ?? []).length ? `- 关键词：${(doc.keywords ?? []).join('、')}` : '',
        doc.updatedAtLabel ? `- 更新时间：${doc.updatedAtLabel}` : '',
        '',
        doc.summary ? `**摘要**：${String(doc.summary).trim()}` : '',
        '',
        '**正文**：',
        '',
        doc.content || '（暂无正文内容）',
        '',
        '---'
      ].filter(Boolean).join('\n'))
    ].filter(Boolean).join('\n').trimEnd() + '\n'
  }

  return [
    `《${safeTitle}》拆书资产`,
    metaLine,
    ''.padEnd(48, '='),
    asset.summary ? `摘要：${String(asset.summary).trim()}` : '',
    '',
    ...documents.map((doc) => [
      `【${doc.sourceTypeLabel ?? doc.sourceType ?? '知识文档'}】${doc.title ?? '未命名文档'}`,
      doc.sourceLabel ? `来源：${doc.sourceLabel}` : '',
      (doc.keywords ?? []).length ? `关键词：${(doc.keywords ?? []).join('、')}` : '',
      doc.summary ? `摘要：${String(doc.summary).trim()}` : '',
      '',
      doc.content || '（暂无正文内容）',
      ''.padEnd(40, '-')
    ].filter(Boolean).join('\n'))
  ].filter(Boolean).join('\n\n') + '\n'
}
