export type ReferenceAssetExportFormat = 'txt' | 'md' | 'json' | 'docx'

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
  const extension = format === 'md' ? 'md' : format === 'txt' ? 'txt' : format === 'docx' ? 'docx' : 'json'
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

/** 将拆书资产文档结构转换为 DOCX 段落数组（懒加载 docx，供导出用）。 */
export async function buildReferenceAssetDocx(
  title: string,
  asset: ReferenceAssetExportAsset,
  documents: ReferenceAssetExportDocument[]
): Promise<Buffer> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx')
  const safeTitle = String(title || asset.title || '参考作品').trim() || '参考作品'

  const docParagraphs: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: safeTitle, bold: true, size: 44 })]
    })
  ]

  const metaLine = buildMetaLine(asset)
  if (metaLine) {
    docParagraphs.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: metaLine, italics: true, size: 22, color: '666666' })]
      })
    )
  }

  if (asset.summary) {
    docParagraphs.push(
      new Paragraph({
        spacing: { before: 120, after: 200 },
        children: [new TextRun({ text: String(asset.summary).trim(), size: 24 })]
      })
    )
  }

  documents.forEach((doc, index) => {
    const docTitle = doc.title || `文档 ${index + 1}`
    docParagraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 100 },
        children: [new TextRun({ text: docTitle, bold: true, size: 32 })]
      })
    )

    const metaParts: string[] = []
    if (doc.sourceTypeLabel || doc.sourceType) metaParts.push(`类型：${doc.sourceTypeLabel ?? doc.sourceType}`)
    if (doc.sourceLabel) metaParts.push(`来源：${doc.sourceLabel}`)
    if ((doc.keywords ?? []).length) metaParts.push(`关键词：${(doc.keywords ?? []).join('、')}`)
    if (doc.updatedAtLabel) metaParts.push(`更新时间：${doc.updatedAtLabel}`)
    if (metaParts.length) {
      docParagraphs.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: metaParts.join('　'), italics: true, size: 21, color: '888888' })]
        })
      )
    }

    if (doc.summary) {
      docParagraphs.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: `摘要：${String(doc.summary).trim()}`, size: 24, bold: true })]
        })
      )
    }

    const body = (doc.content || '（暂无正文内容）').split(/\r?\n/)
    body.forEach((line) => {
      docParagraphs.push(
        new Paragraph({
          spacing: { line: 320, after: 60 },
          children: [new TextRun({ text: line, size: 24 })]
        })
      )
    })
  })

  const doc = new Document({
    creator: 'CharacterArc',
    title: safeTitle,
    description: '拆书知识库导出',
    sections: [{ children: docParagraphs }]
  })

  return Packer.toBuffer(doc)
}
