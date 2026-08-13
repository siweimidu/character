import { BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import * as XLSX from 'xlsx'

import type { AiTaskPayload, ReferenceStyleAnalysisResult, ReferenceStyleChunkResult } from './ai/shared-types'
import { runAiTask } from './ai/runtime'
import { indexReferenceNovel } from './ai/knowledge-retrieval'
import { refreshRegistry as refreshSkillRegistry, toScanEntries as skillScanEntries, toContextEntries as skillContextEntries } from './ai/skills'
import { getBuiltinSkillsDirPath, getProjectSkillsDirPath as getSkillsDirPath } from './ai/skills/discovery'
import { extractReferenceNovelContext, type ReferenceNovelLocalContext } from './referenceAnalysis'
import { fetchWithCache } from './github-mirror'
import { fetchFanqieTrends } from './fanqie-trends'
import { getWorkspaceDirPath, getWorkspaceDbFilePath } from './workspace-store'
import { inspectContinuationNovelFile } from './continuation-import'
import {
  embedCharaJsonIntoPng,
  isPngBuffer,
  parsePngCharacterCard,
  parseCardJson,
  buildV2CardJson,
  createCharacterCardPng,
  resolveAvatarBuffer
} from '@shared/character-card'
import {
  exportProjectArchive,
  getProjectArchiveDefaultName,
  importProjectArchiveInWorker,
  inspectProjectArchive,
  type ProjectArchiveImportProgressPayload,
  type ProjectArchiveImportMode,
  type ProjectArchiveModule
} from './archive/project-archive'
import {
  buildReferenceAssetExportContent,
  resolveReferenceAssetFileName,
  type ReferenceAssetExportAsset,
  type ReferenceAssetExportDocument,
  type ReferenceAssetExportFormat
} from './reference-asset-export'
import type { WorkspacePayload } from './workspace-types'
import type { WindowManager } from './window-manager'

type ReferenceNovelImportRequest = {
  settings: AiTaskPayload['settings']
  projectId?: string
  projectTitle?: string
  projectGenre?: string
  projectPlatform?: string
  preferredTitle?: string
  preferredSource?: string
  projectSkills?: Array<{
    id: string
    name: string
    description: string
    content: string
  }>
}

type ReferenceImportProgressPayload = {
  phase: 'extracting' | 'chunking' | 'chunk-analysis' | 'aggregating' | 'saving' | 'done'
  message: string
  current: number
  total: number
  percent: number
  sourceTitle?: string
  bookId?: string
  bookIndex?: number
  bookTotal?: number
  status?: 'queued' | 'running' | 'success' | 'error' | 'canceled'
  chunkIndex?: number
  chunkTotal?: number
  chunkLabel?: string
}

let activeBatchBookControllers: Map<string, AbortController> | null = null

const OUTLINE_SPREADSHEET_HEADERS = ['分卷名称', '分卷目标字数', '分卷摘要', '章节序号', '章节标题', '目标字数', '核心冲突', '剧情摘要', '状态']

function normalizeOutlineHeader(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').trim()
}

function scoreOutlineSheet(rows: string[][]): number {
  if (rows.length === 0) return 0
  const headers = rows[0].map(normalizeOutlineHeader)
  const headerScore = OUTLINE_SPREADSHEET_HEADERS.reduce((score, header) => score + (headers.includes(header) ? 10 : 0), 0)
  const dataScore = Math.min(rows.slice(1).filter((row) => row.some(Boolean)).length, 20)
  return headerScore + dataScore
}

function readOutlineSheetRows(sheet: XLSX.WorkSheet): string[][] {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false
  })
  return rawRows
    .slice(0, 5001)
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some(Boolean))
}

function formatOutlineStatusLabel(status: unknown): string {
  switch (String(status ?? '').trim()) {
    case 'idea':
      return '点子'
    case 'drafting':
      return '写作中'
    case 'done':
      return '已完成'
    case 'planned':
    default:
      return '已规划'
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

type RegisterMainIpcHandlersDeps = {
  windowManager: WindowManager
  setLatestWorkspaceSnapshot: (payload: unknown) => void
  setLatestAppSettings: (
    settings: unknown,
    metadata: { theme: string; selectedProjectId: string }
  ) => void
  normalizeWorkspacePayload: (payload: unknown) => unknown
  ensureWorkspaceDb: () => Promise<DatabaseSync>
  getWorkspaceDbIfInitialized: () => DatabaseSync | null
  readWorkspaceSnapshot: (db: DatabaseSync) => unknown
  writeWorkspaceSnapshot: (db: DatabaseSync, payload: unknown) => void
  writeAppSettingsRow: (
    db: DatabaseSync,
    settings: unknown,
    metadata: { theme: string; selectedProjectId: string }
  ) => void
  validateImportedPayload: (payload: unknown) => { valid: true; payload: unknown; meta: unknown } | { valid: false; message: string }
  resolveImageMime: (filePath: string) => string
  emitReferenceImportProgress: (window: BrowserWindow, payload: ReferenceImportProgressPayload) => void
  buildImportedReferenceKnowledgeDocuments: (
    title: string,
    localContext: ReferenceNovelLocalContext,
    analysis: ReferenceStyleAnalysisResult,
    chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }>,
    importedAt: string
  ) => unknown[]
  buildImportedReferenceStylePrompt: (title: string, analysis: ReferenceStyleAnalysisResult) => string
  formatReferenceChunkSummaries: (
    chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }>
  ) => string
}

type ExportRequest = {
  data: unknown
  title?: string
  defaultPath?: string
}

type ProjectArchiveImportRequest = {
  filePath?: string
  mode?: ProjectArchiveImportMode
  targetProjectId?: string
  modules?: ProjectArchiveModule[]
  filePaths?: string[]
}

async function cleanupOrphanReferenceNovelFiles(payload: unknown): Promise<void> {
  const activeIds = new Set<string>()
  const works = (payload as { referenceWorks?: Array<{ id?: unknown }> })?.referenceWorks ?? []
  for (const work of works) {
    const id = String(work?.id ?? '').trim()
    if (id) activeIds.add(id)
  }

  const novelStorageDir = join(getWorkspaceDirPath(), 'reference-novels')
  if (!existsSync(novelStorageDir)) return

  const files = await readdir(novelStorageDir)
  for (const file of files) {
    if (!file.endsWith('.txt')) continue
    const id = file.slice(0, -4)
    if (!activeIds.has(id)) {
      await unlink(join(novelStorageDir, file)).catch(() => {})
    }
  }
}

export function registerMainIpcHandlers(deps: RegisterMainIpcHandlersDeps): void {
  ipcMain.handle('characterarc:export-json', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
      ? payload
      : {
          data: payload
        }) as ExportRequest

    const result = await dialog.showSaveDialog(window, {
      title: request.title ?? '导出项目数据',
      defaultPath: request.defaultPath ?? 'characterarc-export.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    await writeFile(result.filePath, JSON.stringify(request.data, null, 2), 'utf-8')
    return {
      success: true,
      canceled: false,
      filePath: result.filePath
    }
  })

  ipcMain.handle('characterarc:export-project-archive', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as { projectId?: string; projectTitle?: string }
    const projectId = String(request.projectId ?? '').trim()
    if (!projectId) {
      return { success: false, canceled: false, error: '缺少要导出的项目 ID。' }
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出项目归档包',
      defaultPath: getProjectArchiveDefaultName(String(request.projectTitle ?? 'CharacterArc 项目')),
      filters: [{ name: 'CharacterArc 项目归档', extensions: ['carc'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    try {
      const db = await deps.ensureWorkspaceDb()
      await exportProjectArchive({
        db,
        filePath: result.filePath,
        projectId,
        readWorkspaceSnapshot: deps.readWorkspaceSnapshot as (db: DatabaseSync) => WorkspacePayload | null
      })
      return { success: true, canceled: false, filePath: result.filePath }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '导出项目归档失败'
      }
    }
  })

  ipcMain.handle('characterarc:inspect-project-archive', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择项目归档包（可多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'CharacterArc 项目归档', extensions: ['carc'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const archives: Array<{ filePath: string; preview: Awaited<ReturnType<typeof inspectProjectArchive>> }> = []
      for (const filePath of result.filePaths) {
        const preview = await inspectProjectArchive(filePath)
        archives.push({ filePath, preview })
      }
      return {
        success: true,
        canceled: false,
        files: archives,
        singleFile: archives.length === 1 ? archives[0] : undefined
      }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '无法读取项目归档包'
      }
    }
  })

  ipcMain.handle('characterarc:import-project-archive', async (_event, payload: unknown) => {
    const request = (payload ?? {}) as ProjectArchiveImportRequest
    const filePaths = Array.isArray(request.filePaths) && request.filePaths.length > 0
      ? request.filePaths.map((path) => String(path).trim()).filter(Boolean)
      : []
    const filePath = String(request.filePath ?? '').trim()
    const allFilePaths = filePath ? [filePath, ...filePaths] : filePaths
    const sendProgress = (progress: ProjectArchiveImportProgressPayload): void => {
      _event.sender.send('characterarc:project-archive-import-progress', progress)
    }
    if (allFilePaths.length === 0) {
      return { success: false, canceled: false, error: '缺少要导入的项目归档文件。' }
    }

    try {
      let lastSelectedProjectId = ''
      const total = allFilePaths.length
      await deps.ensureWorkspaceDb()

      for (let index = 0; index < total; index++) {
        const currentFilePath = allFilePaths[index]
        sendProgress({
          phase: 'preparing',
          message: `正在准备导入 ${index + 1}/${total}...`,
          percent: Math.round((index / total) * 100)
        })

        const result = await importProjectArchiveInWorker({
          filePath: currentFilePath,
          mode: request.mode ?? 'new-project',
          targetProjectId: request.targetProjectId,
          modules: request.modules,
          onProgress: (progress) => {
            const weighted = Math.round(
              (index / total) * 100 + (progress.percent / total)
            )
            sendProgress({
              ...progress,
              percent: Math.min(95, weighted),
              message: `[${index + 1}/${total}] ${progress.message}`
            })
          }
        })
        lastSelectedProjectId = result.selectedProjectId || lastSelectedProjectId
      }

      sendProgress({ phase: 'syncing', message: '正在刷新工作区数据...', percent: 96 })
      const db = await deps.ensureWorkspaceDb()
      const workspace = deps.readWorkspaceSnapshot(db)
      if (workspace) {
        deps.setLatestWorkspaceSnapshot(workspace)
        deps.windowManager.broadcastWindowEvent('characterarc:workspace-sync-event', workspace)
      }
      sendProgress({ phase: 'done', message: `已完成 ${total} 个项目归档导入`, percent: 100 })
      return { success: true, canceled: false, selectedProjectId: lastSelectedProjectId }
    } catch (error) {
      sendProgress({
        phase: 'error',
        message: error instanceof Error ? error.message : '导入项目归档失败',
        percent: 100
      })
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '导入项目归档失败'
      }
    }
  })

  ipcMain.handle('characterarc:export-text', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
      ? payload
      : {
          data: payload
        }) as ExportRequest

    const result = await dialog.showSaveDialog(window, {
      title: request.title ?? '导出章节文本',
      defaultPath: request.defaultPath ?? 'characterarc-export.txt',
      filters: [{ name: '文本文档', extensions: ['txt'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    const data = request.data as {
      project?: { title?: string } | null
      outlineVolumes?: Array<{ id?: string; title?: string }>
      chapters?: Array<{ volumeId?: string; title?: string; content?: string }>
    }
    const volumeTitleMap = new Map((data.outlineVolumes ?? []).map((volume) => [volume.id ?? '', volume.title?.trim() || '未命名分卷']))
    let activeVolumeId = ''

    const text = [
      data.project?.title ? `# ${data.project.title}` : '# CharacterArc 导出',
      '',
      ...(data.chapters ?? []).flatMap((chapter, index) => {
        const shouldPrintVolume = chapter.volumeId && chapter.volumeId !== activeVolumeId
        if (chapter.volumeId) {
          activeVolumeId = chapter.volumeId
        }

        return [
          ...(shouldPrintVolume ? [`## ${volumeTitleMap.get(chapter.volumeId ?? '') || '未命名分卷'}`, ''] : []),
          `第${index + 1}章 ${chapter.title ?? '未命名章节'}`,
          '',
          chapter.content?.trim() || '（暂无正文内容）',
          '',
          ''.padEnd(48, '-'),
          ''
        ]
      })
    ].join('\n')

    await writeFile(result.filePath, text, 'utf-8')
    return {
      success: true,
      canceled: false,
      filePath: result.filePath
    }
  })

  ipcMain.handle('characterarc:export-markdown', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }
    const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>) ? payload : { data: payload }) as ExportRequest
    const result = await dialog.showSaveDialog(window, {
      title: request.title ?? '导出章节 Markdown',
      defaultPath: request.defaultPath ?? 'characterarc-export.md',
      filters: [{ name: 'Markdown 文档', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    const data = request.data as {
      project?: { title?: string } | null
      outlineVolumes?: Array<{ id?: string; title?: string }>
      chapters?: Array<{ volumeId?: string; title?: string; content?: string }>
    }
    const volumeTitleMap = new Map((data.outlineVolumes ?? []).map((volume) => [volume.id ?? '', volume.title?.trim() || '未命名分卷']))
    let activeVolumeId = ''
    const md = [
      data.project?.title ? `# ${data.project.title}` : '# CharacterArc 导出',
      '',
      ...(data.chapters ?? []).flatMap((chapter, index) => {
        const shouldPrintVolume = chapter.volumeId && chapter.volumeId !== activeVolumeId
        if (chapter.volumeId) activeVolumeId = chapter.volumeId
        return [
          ...(shouldPrintVolume ? [`## ${volumeTitleMap.get(chapter.volumeId ?? '') || '未命名分卷'}`, ''] : []),
          `### 第${index + 1}章 ${chapter.title ?? '未命名章节'}`,
          '',
          chapter.content?.trim() || '（暂无正文内容）',
          ''
        ]
      })
    ].join('\n')
    await writeFile(result.filePath, md, 'utf-8')
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:export-excel', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }
    const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>) ? payload : { data: payload }) as ExportRequest
    const result = await dialog.showSaveDialog(window, {
      title: request.title ?? '导出章节 Excel',
      defaultPath: request.defaultPath ?? 'characterarc-export.xlsx',
      filters: [{ name: 'Excel 表格', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    const data = request.data as {
      project?: { title?: string } | null
      outlineVolumes?: Array<{ id?: string; title?: string }>
      chapters?: Array<{ volumeId?: string; title?: string; content?: string }>
    }
    const volumeTitleMap = new Map((data.outlineVolumes ?? []).map((volume) => [volume.id ?? '', volume.title?.trim() || '未命名分卷']))
    const rows = (data.chapters ?? []).map((chapter, index) => {
      const volumeTitle = chapter.volumeId ? (volumeTitleMap.get(chapter.volumeId ?? '') || '未命名分卷') : ''
      return {
        '序号': index + 1,
        '分卷': volumeTitle,
        '章节标题': chapter.title ?? '未命名章节',
        '正文内容': chapter.content?.trim() || ''
      }
    })
    const { utils, write } = await import('xlsx')
    const worksheet = utils.json_to_sheet(rows)
    const workbook = utils.book_new()
    utils.book_append_sheet(workbook, worksheet, '章节')
    const buffer = write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    await writeFile(result.filePath, buffer)
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:export-providers-excel', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }
    const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>) ? payload : { data: payload }) as ExportRequest
    const result = await dialog.showSaveDialog(window, {
      title: request.title ?? '导出模型厂商官网 Excel',
      defaultPath: request.defaultPath ?? 'model-providers.xlsx',
      filters: [{ name: 'Excel 表格', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    const rows = (request.data as Array<{ provider?: string; homepage?: string }> ?? [])
      .filter((row) => row && row.provider)
      .map((row) => ({ '模型厂商': row.provider ?? '', '官网链接': row.homepage ?? '' }))
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '模型厂商官网')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    await writeFile(result.filePath, buffer)
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:export-chapter-txt', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as {
      title?: string
      content?: string
      defaultFileName?: string
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出章节为 TXT',
      defaultPath: request.defaultFileName?.trim() || 'chapter.txt',
      filters: [{ name: '文本文档', extensions: ['txt'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    const text = [request.title?.trim() || '未命名章节', '', request.content ?? ''].join('\n')
    await writeFile(result.filePath, text, 'utf-8')
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:export-chapter-docx', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as {
      title?: string
      content?: string
      defaultFileName?: string
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出章节为 DOCX',
      defaultPath: request.defaultFileName?.trim() || 'chapter.docx',
      filters: [{ name: 'Word 文档', extensions: ['docx'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx')
    const titleText = request.title?.trim() || '未命名章节'
    const paragraphs = (request.content ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())

    const docParagraphs = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: titleText, bold: true, size: 36 })]
      }),
      ...paragraphs.map((line) =>
        new Paragraph({
          spacing: { line: 360 },
          children: [new TextRun({ text: line, size: 24 })]
        })
      )
    ]

    const doc = new Document({
      creator: 'CharacterArc',
      title: titleText,
      sections: [{ children: docParagraphs }]
    })

    const buffer = await Packer.toBuffer(doc)
    await writeFile(result.filePath, buffer)
    return { success: true, canceled: false, filePath: result.filePath }
  })

  // ── 伏笔导入 / 导出 ──
  ipcMain.handle('characterarc:export-plot-threads', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }

    const request = (payload ?? {}) as {
      data: unknown
      format?: 'md' | 'txt' | 'json'
      title?: string
      defaultPath?: string
    }
    const format = request.format ?? 'txt'
    const ext = format === 'json' ? 'json' : (format === 'md' ? 'md' : 'txt')
    const label = format === 'json' ? 'JSON 文件' : (format === 'md' ? 'Markdown 文档' : '文本文档')

    const result = await dialog.showSaveDialog(window, {
      title: request.title ?? `导出伏笔 ${ext.toUpperCase()}`,
      defaultPath: request.defaultPath ?? `plot-threads.${ext}`,
      filters: [{ name: label, extensions: [ext] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    if (format === 'json') {
      await writeFile(result.filePath, JSON.stringify(request.data, null, 2), 'utf-8')
    } else {
      const data = request.data as Array<Record<string, unknown>>
      const lines = (data ?? []).map((t) => {
        const title = String(t.title ?? '未命名伏笔')
        const desc = String(t.description ?? '')
        const statusMap: Record<string, string> = {
          pending: '待回收',
          resolved: '已回收',
          abandoned: '废弃'
        }
        const status = statusMap[String(t.status ?? 'pending')] ?? '待回收'
        const priorityMap: Record<string, string> = { low: '低', medium: '中', high: '高' }
        const priority = priorityMap[String(t.priority ?? 'medium')] ?? '中'
        const tags = Array.isArray(t.tags) ? (t.tags as string[]).join(',') : ''
        const remark = String(t.remark ?? '')
        const opened = String(t.openedInChapterTitle ?? '')
        const plannedClose = String(t.plannedCloseChapterTitle ?? '')

        const lines = [
          `标题：${title}`,
          `状态：${status}`,
          `优先级：${priority}`,
          ...(opened ? [`埋设章节：${opened}`] : []),
          ...(plannedClose ? [`计划回收章节：${plannedClose}`] : []),
          ...(tags ? [`标签：${tags}`] : []),
          ...(remark ? [`备注：${remark}`] : []),
          ...(desc ? ['描述：', desc, ''] : [])
        ]
        return lines.join('\n')
      })

      const text = [
        '# 伏笔清单',
        '',
        `共 ${lines.length} 条伏笔`,
        '',
        ...lines.map((line, i) => `## 伏笔 ${i + 1}\n\n${line}`)
      ].join('\n\n')

      await writeFile(result.filePath, text, 'utf-8')
    }

    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:import-plot-threads', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }

    const result = await dialog.showOpenDialog(window, {
      title: '导入伏笔',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown / 文本文档 / JSON', extensions: ['md', 'txt', 'json'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const items: Array<Record<string, unknown>> = []
    const errors: string[] = []

    for (const filePath of result.filePaths) {
      try {
        const raw = await readFile(filePath, 'utf-8')
        const lowerPath = filePath.toLowerCase()

        if (lowerPath.endsWith('.json')) {
          const parsed = JSON.parse(raw)
          const arr = Array.isArray(parsed) ? parsed : Array.isArray((parsed as Record<string, unknown>)?.plotThreads)
            ? ((parsed as Record<string, unknown>).plotThreads as unknown[])
            : []
          arr.forEach((item) => {
            if (item && typeof item === 'object') {
              items.push(item as Record<string, unknown>)
            }
          })
        } else {
          // Parse MD/TXT: look for title: lines and description blocks
          const sections = raw.split(/\n(?=标题[:：])/g)
          for (const section of sections) {
            const titleMatch = section.match(/标题[:：]\s*(.+)/)
            if (!titleMatch) continue
            const title = titleMatch[1].trim()
            if (!title) continue

            const statusMatch = section.match(/状态[:：]\s*(.+)/)
            const statusRaw = statusMatch?.[1]?.trim() ?? ''
            const status = statusRaw.includes('废弃') ? 'abandoned'
              : statusRaw.includes('已回收') ? 'resolved' : 'pending'

            const priorityMatch = section.match(/优先级[:：]\s*(.+)/)
            const priorityRaw = priorityMatch?.[1]?.trim() ?? ''
            const priority = priorityRaw.includes('高') ? 'high'
              : priorityRaw.includes('低') ? 'low' : 'medium'

            const openedMatch = section.match(/埋设章节[:：]\s*(.+)/)
            const plannedCloseMatch = section.match(/计划回收章节[:：]\s*(.+)/)
            const tagsMatch = section.match(/标签[:：]\s*(.+)/)
            const remarkMatch = section.match(/备注[:：]\s*(.+)/)

            // Extract description: everything after 描述: until next section
            const descMatch = section.match(/描述[:：]\n?([\s\S]*?)(?=\n\s*$|$)/)

            items.push({
              title,
              description: descMatch?.[1]?.trim() ?? '',
              status,
              priority,
              openedInChapterId: '',
              plannedCloseChapterId: '',
              tags: tagsMatch ? tagsMatch[1].split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [],
              remark: remarkMatch?.[1]?.trim() ?? '',
              openedInChapterTitle: openedMatch?.[1]?.trim() ?? '',
              plannedCloseChapterTitle: plannedCloseMatch?.[1]?.trim() ?? ''
            })
          }
        }
      } catch (err) {
        errors.push(`${filePath}: ${err instanceof Error ? err.message : '解析失败'}`)
      }
    }

    return {
      success: items.length > 0,
      canceled: false,
      items,
      errors
    }
  })

  ipcMain.handle('characterarc:import-json', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '导入项目 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const raw = await readFile(result.filePaths[0], 'utf-8')
    let parsed: unknown

    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        success: false,
        canceled: false,
        error: '文件不是有效的 JSON 格式。'
      }
    }

    const validation = deps.validateImportedPayload(parsed)
    if (!validation.valid) {
      return {
        success: false,
        canceled: false,
        error: validation.message
      }
    }

    return {
      success: true,
      canceled: false,
      payload: validation.payload,
      meta: validation.meta
    }
  })

  // ── 世界观批量导入 / 导出 ──
  /**
   * 解析 JSON 世界观数据。支持两种结构：
   * - 数组：`[{ type, title, content, tags }]`
   * - 对象：`{ entries: [...] }` 或 `{ worldviewEntries: [...] }`
   */
  function parseWorldviewJson(data: unknown): Array<{ type: string; title: string; content: string; tags: string[] }> {
    const rawEntries = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown> | null)?.entries)
        ? (data as Record<string, unknown>).entries as unknown[]
        : Array.isArray((data as Record<string, unknown> | null)?.worldviewEntries)
          ? (data as Record<string, unknown>).worldviewEntries as unknown[]
          : []
    return rawEntries
      .map((item) => {
        const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
        const title = String(record.title ?? '').trim()
        if (!title) return null
        const tagsRaw = Array.isArray(record.tags) ? record.tags : Array.isArray(record.tagsJson) ? record.tagsJson : []
        return {
          type: String(record.type ?? '地理').trim() || '地理',
          title,
          content: String(record.content ?? '').trim(),
          tags: tagsRaw.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8)
        }
      })
      .filter((entry): entry is { type: string; title: string; content: string; tags: string[] } => entry !== null)
  }

  /** 解析纯文本世界观（TXT/MD）：按二级标题或编号标题切分为词条 */
  function parseWorldviewText(raw: string): Array<{ type: string; title: string; content: string; tags: string[] }> {
    const lines = raw.split(/\r?\n/)
    const entries: Array<{ type: string; title: string; content: string; tags: string[] }> = []
    let current: { type: string; title: string; content: string; tags: string[] } | null = null

    for (const line of lines) {
      const trimmed = line.trim()
      // 匹配 markdown 二级/三级标题，或普通行首的编号标题
      const headingMatch = trimmed.match(/^#{2,3}\s+(.+)$/) || trimmed.match(/^(?:第?\s*[0-9一二三四五六七八九十]+[、\.\s])\s*(.+)$/)
      if (headingMatch && !trimmed.startsWith('#')) {
        // 编号标题
        if (current) entries.push(current)
        current = { type: '地理', title: headingMatch[1].trim(), content: '', tags: [] }
        continue
      }
      if (trimmed.startsWith('#')) {
        const title = headingMatch ? headingMatch[1].trim() : trimmed.replace(/^#+\s*/, '').trim()
        if (!title) continue
        if (current) entries.push(current)
        current = { type: '地理', title, content: '', tags: [] }
        continue
      }
      if (current) {
        current.content = current.content ? `${current.content}\n${trimmed}` : trimmed
      }
    }
    if (current) entries.push(current)
    return entries.filter((entry) => entry.title)
  }

  ipcMain.handle('characterarc:worldview-import', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '批量导入世界观设定',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '世界观文件 (txt/md/json)', extensions: ['txt', 'md', 'markdown', 'json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const entries: Array<{ type: string; title: string; content: string; tags: string[] }> = []
    const errors: string[] = []

    for (const filePath of result.filePaths) {
      try {
        const raw = await readFile(filePath, 'utf-8')
        const ext = basename(filePath).toLowerCase()
        if (ext.endsWith('.json')) {
          try {
            entries.push(...parseWorldviewJson(JSON.parse(raw)))
          } catch {
            errors.push(`${basename(filePath)}：JSON 解析失败`)
          }
        } else {
          entries.push(...parseWorldviewText(raw))
        }
      } catch {
        errors.push(`${basename(filePath)}：读取失败`)
      }
    }

    if (!entries.length) {
      return {
        success: false,
        canceled: false,
        error: errors.length ? errors.join('；') : '未能从所选文件中解析出任何世界观词条。'
      }
    }

    return {
      success: true,
      canceled: false,
      entries,
      fileCount: result.filePaths.length,
      warning: errors.length ? errors.join('；') : undefined
    }
  })

  ipcMain.handle('characterarc:worldview-export', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload && typeof payload === 'object' ? payload : {}) as {
      format?: 'txt' | 'md' | 'json' | 'excel'
      entries?: Array<{ type: string; title: string; content: string; tags?: string[] }>
    }
    const format = request.format ?? 'json'
    const entries = request.entries ?? []
    const defaultPath = `世界观设定-${new Date().toISOString().slice(0, 10)}.${format === 'md' ? 'md' : format === 'txt' ? 'txt' : format === 'excel' ? 'xlsx' : 'json'}`

    const filterMap = {
      txt: { name: '文本文档', extensions: ['txt'] },
      md: { name: 'Markdown 文档', extensions: ['md'] },
      json: { name: 'JSON 文件', extensions: ['json'] },
      excel: { name: 'Excel 工作簿', extensions: ['xlsx'] }
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出世界观设定',
      defaultPath,
      filters: [filterMap[format]]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    let content = ''
    if (format === 'excel') {
      const workbook = XLSX.utils.book_new()
      const headers = ['分类', '标题', '内容', '标签']
      const rows = entries.map((entry) => [
        entry.type,
        entry.title,
        entry.content,
        (entry.tags ?? []).join('、')
      ])
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
      sheet['!cols'] = [
        { wch: 14 },
        { wch: 28 },
        { wch: 60 },
        { wch: 24 }
      ]
      sheet['!autofilter'] = { ref: `A1:D${rows.length + 1}` }
      XLSX.utils.book_append_sheet(workbook, sheet, '世界观设定')
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      await writeFile(result.filePath, buffer)
      return { success: true, canceled: false, filePath: result.filePath }
    }
    if (format === 'json') {
      content = JSON.stringify(
        { entries: entries.map((entry) => ({ type: entry.type, title: entry.title, content: entry.content, tags: entry.tags ?? [] })) },
        null,
        2
      )
    } else if (format === 'md') {
      content = entries
        .map((entry) => [`### ${entry.title}`, '', `**分类**：${entry.type}`, ...(entry.tags?.length ? [`**标签**：${entry.tags.join('、')}`] : []), '', entry.content || '（暂无内容）', ''].join('\n'))
        .join('\n---\n\n')
    } else {
      content = entries
        .map((entry) => {
          const header = `【${entry.type}】${entry.title}`
          const tagLine = entry.tags?.length ? `标签：${entry.tags.join('、')}` : ''
          return [header, tagLine, '', entry.content || '（暂无内容）', ''].filter((line) => line !== '').join('\n')
        })
        .join('\n' + ''.padEnd(40, '-') + '\n\n')
    }

    await writeFile(result.filePath, content, 'utf-8')
    return { success: true, canceled: false, filePath: result.filePath }
  })

  // ── 拆书知识库导出（TXT / Markdown / JSON / Excel） ──
  ipcMain.handle('characterarc:export-knowledge', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }

    const request = (payload && typeof payload === 'object' ? payload : {}) as {
      format?: 'txt' | 'md' | 'json' | 'excel'
      projectTitle?: string
      assets?: Array<{
        title: string
        source?: string
        fileName?: string
        notes?: string
        summary?: string
        topKeywords?: string[]
        styleRules?: string[]
        documents?: Array<{
          title: string
          sourceType?: string
          sourceLabel?: string
          content?: string
          summary?: string
          keywords?: string[]
        }>
      }>
    }
    const format = request.format ?? 'md'
    const assets = request.assets ?? []
    const projectTitle = String(request.projectTitle ?? '').trim() || '拆书知识库'
    const defaultFileName = `拆书知识库-${new Date().toISOString().slice(0, 10)}.${format === 'md' ? 'md' : format === 'txt' ? 'txt' : format === 'excel' ? 'xlsx' : 'json'}`

    const filterMap = {
      txt: { name: '文本文档', extensions: ['txt'] },
      md: { name: 'Markdown 文档', extensions: ['md'] },
      json: { name: 'JSON 文件', extensions: ['json'] },
      excel: { name: 'Excel 表格', extensions: ['xlsx'] }
    }

    const result = await dialog.showSaveDialog(window, {
      title: '导出拆书知识库',
      defaultPath: defaultFileName,
      filters: [filterMap[format]]
    })
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    if (format === 'excel') {
      const workbook = XLSX.utils.book_new()
      const assetRows = assets.map((asset) => ({
        '作品标题': asset.title ?? '',
        '来源': asset.source ?? '',
        '文件名': asset.fileName ?? '',
        '简介': asset.summary ?? '',
        '关键词': (asset.topKeywords ?? []).join('、'),
        '风格规则': (asset.styleRules ?? []).join('、'),
        '文档数': (asset.documents ?? []).length
      }))
      const documentRows = assets.flatMap((asset) =>
        (asset.documents ?? []).map((doc) => ({
          '作品标题': asset.title ?? '',
          '文档标题': doc.title ?? '',
          '来源类型': doc.sourceType ?? '',
          '来源标签': doc.sourceLabel ?? '',
          '摘要': doc.summary ?? '',
          '关键词': (doc.keywords ?? []).join('、'),
          '正文内容': doc.content ?? ''
        }))
      )

      const overviewSheet = XLSX.utils.json_to_sheet(assetRows.length ? assetRows : [{ '作品标题': '', '来源': '', '文件名': '', '简介': '', '关键词': '', '风格规则': '', '文档数': 0 }])
      overviewSheet['!cols'] = [
        { wch: 24 },
        { wch: 14 },
        { wch: 22 },
        { wch: 50 },
        { wch: 24 },
        { wch: 30 },
        { wch: 10 }
      ]
      XLSX.utils.book_append_sheet(workbook, overviewSheet, '拆书总览')

      const docSheet = XLSX.utils.json_to_sheet(documentRows.length ? documentRows : [{ '作品标题': '', '文档标题': '', '来源类型': '', '来源标签': '', '摘要': '', '关键词': '', '正文内容': '' }])
      docSheet['!cols'] = [
        { wch: 24 },
        { wch: 28 },
        { wch: 14 },
        { wch: 22 },
        { wch: 50 },
        { wch: 24 },
        { wch: 80 }
      ]
      XLSX.utils.book_append_sheet(workbook, docSheet, '知识文档')

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      await writeFile(result.filePath, buffer)
      return { success: true, canceled: false, filePath: result.filePath }
    }

    if (format === 'json') {
      const content = JSON.stringify({
        app: 'CharacterArc',
        module: 'knowledge-library',
        exportedAt: new Date().toISOString(),
        projectTitle,
        assets: assets.map((asset) => ({
          title: asset.title,
          source: asset.source,
          fileName: asset.fileName,
          notes: asset.notes,
          summary: asset.summary,
          topKeywords: asset.topKeywords ?? [],
          styleRules: asset.styleRules ?? [],
          documents: (asset.documents ?? []).map((doc) => ({
            title: doc.title,
            sourceType: doc.sourceType,
            sourceLabel: doc.sourceLabel,
            content: doc.content,
            summary: doc.summary,
            keywords: doc.keywords ?? []
          }))
        }))
      }, null, 2)
      await writeFile(result.filePath, content, 'utf-8')
      return { success: true, canceled: false, filePath: result.filePath }
    }

    const separator = ''.padEnd(64, '=')
    type ExportKnowledgeAsset = {
      title: string
      source?: string
      fileName?: string
      notes?: string
      summary?: string
      topKeywords?: string[]
      styleRules?: string[]
      documents?: Array<{
        title: string
        sourceType?: string
        sourceLabel?: string
        content?: string
        summary?: string
        keywords?: string[]
      }>
    }
    const blockForAsset = (asset: ExportKnowledgeAsset, useMarkdown: boolean): string[] => {
      const title = asset.title || '未命名参考资产'
      const meta: string[] = []
      if (asset.source) meta.push(`来源：${asset.source}`)
      if (asset.fileName) meta.push(`文件：${asset.fileName}`)
      if ((asset.topKeywords ?? []).length) meta.push(`关键词：${(asset.topKeywords ?? []).join('、')}`)
      if ((asset.styleRules ?? []).length) meta.push(`风格规则：${(asset.styleRules ?? []).join('、')}`)

      const header = useMarkdown ? `# ${title}` : title
      const lines: string[] = [header]
      if (meta.length) {
        if (useMarkdown) {
          lines.push('', meta.map((item) => `- ${item}`).join('\n'))
        } else {
          lines.push('', meta.join(' / '))
        }
      }
      const summary = asset.summary || asset.notes || ''
      if (summary) {
        lines.push('', '【作品简介】', '', summary)
      }

      ;(asset.documents ?? []).forEach((doc, index) => {
        const docTitle = doc.title || `文档 ${index + 1}`
        const docMeta: string[] = []
        if (doc.sourceType) docMeta.push(`类型：${doc.sourceType}`)
        if (doc.sourceLabel) docMeta.push(`来源：${doc.sourceLabel}`)
        if ((doc.keywords ?? []).length) docMeta.push(`关键词：${(doc.keywords ?? []).join('、')}`)

        lines.push('', ''.padEnd(48, '-'))
        if (useMarkdown) {
          lines.push('', `## ${docTitle}`)
          if (docMeta.length) lines.push('', docMeta.map((item) => `- ${item}`).join('\n'))
          if (doc.summary) lines.push('', `> ${doc.summary}`)
          lines.push('', doc.content || '（暂无正文内容）')
        } else {
          lines.push('', `【${docTitle}】`)
          if (docMeta.length) lines.push(docMeta.join(' / '))
          if (doc.summary) lines.push(`摘要：${doc.summary}`)
          lines.push('', doc.content || '（暂无正文内容）')
        }
      })
      return lines
    }

    const sections = assets.map((asset) => blockForAsset(asset, format === 'md').join('\n'))
    const body = sections.join(`\n\n${separator}\n\n`)
    const content = format === 'md'
      ? `# ${projectTitle} · 拆书知识库导出\n\n> 导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n${body}`
      : `【${projectTitle} · 拆书知识库导出】\n导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n${body}`

    await writeFile(result.filePath, content, 'utf-8')
    return { success: true, canceled: false, filePath: result.filePath }
  })

  // ── 拆书知识库：单本参考作品资产导出（txt / md / json / excel） ──
  ipcMain.handle('characterarc:export-reference-asset', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload && typeof payload === 'object' ? payload : {}) as {
      format?: ReferenceAssetExportFormat
      asset?: ReferenceAssetExportAsset
      documents?: ReferenceAssetExportDocument[]
    }

    const format: ReferenceAssetExportFormat = request.format ?? 'md'
    const asset = request.asset ?? {}
    const documents = Array.isArray(request.documents) ? request.documents : []
    if (!documents.length) {
      return { success: false, canceled: false, error: '没有可导出的拆书文档。' }
    }

    const { baseName, extension } = resolveReferenceAssetFileName(format, asset)
    const dateTag = new Date().toISOString().slice(0, 10)
    const filterMap: Record<ReferenceAssetExportFormat, { name: string; extensions: string[] }> = {
      txt: { name: '文本文档', extensions: ['txt'] },
      md: { name: 'Markdown 文档', extensions: ['md'] },
      json: { name: 'JSON 文件', extensions: ['json'] },
      excel: { name: 'Excel 工作簿', extensions: ['xlsx'] }
    }
    const safeTitle = String(asset.title ?? '参考作品').trim() || '参考作品'

    const result = await dialog.showSaveDialog(window, {
      title: `导出《${safeTitle}》拆书资产`,
      defaultPath: `${baseName}-拆书资产-${dateTag}.${extension}`,
      filters: [filterMap[format]]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    try {
      const content = buildReferenceAssetExportContent(format, asset, documents)
      await writeFile(result.filePath, content)
      return { success: true, canceled: false, filePath: result.filePath }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '导出拆书资产失败'
      }
    }
  })

  // ── 人物卡片导入导出（兼容酒馆 SillyTavern 角色卡 V2） ──

  ipcMain.handle('characterarc:character-card-pick', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true, cards: [] }
    const result = await dialog.showOpenDialog(window, {
      title: '导入人物卡片（PNG / JSON）',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '角色卡片', extensions: ['png', 'json'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true, cards: [] }
    }

    const cards: Array<{
      name: string
      description: string
      appearance: string
      personality: string
      scenario: string
      greeting: string
      dialogueExamples: string
      tags: string[]
      avatar?: string
      sourceFile: string
    }> = []
    const errors: string[] = []

    for (const filePath of result.filePaths) {
      try {
        const buffer = await readFile(filePath)
        let parsed = null
        let avatar: string | undefined

        if (isPngBuffer(buffer)) {
          parsed = parsePngCharacterCard(buffer)
          // 从 PNG 中提取头像（角色卡封面图）
          if (parsed) {
            avatar = buffer.toString('base64')
          }
        } else {
          parsed = parseCardJson(buffer.toString('utf-8'))
        }

        if (!parsed) {
          errors.push(`${basename(filePath)}：无法解析为有效角色卡`)
          continue
        }
        if (!parsed.name) {
          errors.push(`${basename(filePath)}：角色卡缺少名称`)
          continue
        }
        cards.push({ ...parsed, avatar, sourceFile: basename(filePath) })
      } catch {
        errors.push(`${basename(filePath)}：读取失败`)
      }
    }

    return { success: true, canceled: false, cards, errors }
  })

  ipcMain.handle('characterarc:character-card-export', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }
    const req = payload as { cards: Array<Record<string, unknown>>; format: 'png' | 'json' }
    const cards = Array.isArray(req.cards) ? req.cards : []
    if (!cards.length) return { success: false, canceled: true }

    const result = await dialog.showSaveDialog(window, {
      title: '导出人物卡片',
      defaultPath: `${String(cards[0]?.name ?? '角色卡')}.${req.format === 'png' ? 'png' : 'json'}`,
      filters: req.format === 'png'
        ? [{ name: 'PNG 角色卡', extensions: ['png'] }]
        : [{ name: 'JSON 角色卡', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    try {
      const first = cards[0] as Record<string, unknown>
      const card = {
        name: String(first.name ?? ''),
        description: String(first.description ?? ''),
        appearance: String(first.appearance ?? ''),
        personality: String(first.personality ?? ''),
        scenario: String(first.scenario ?? ''),
        greeting: String(first.greeting ?? ''),
        dialogueExamples: String(first.dialogueExamples ?? ''),
        tags: Array.isArray(first.tags) ? first.tags.map((t) => String(t)) : []
      }
      const cardJson = buildV2CardJson(card)

      if (req.format === 'json') {
        await writeFile(result.filePath, cardJson, 'utf-8')
      } else {
        // 优先使用角色头像作为底图，否则生成最小 PNG
        const avatarBase = typeof first.avatar === 'string' ? first.avatar : ''
        const avatarBuf = resolveAvatarBuffer(avatarBase)
        let pngBuffer = avatarBuf
        if (!pngBuffer || !isPngBuffer(pngBuffer)) {
          pngBuffer = createCharacterCardPng(card)
        }
        await writeFile(result.filePath, embedCharaJsonIntoPng(pngBuffer, cardJson))
      }
      return { success: true, canceled: false, filePath: result.filePath }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '导出角色卡失败'
      }
    }
  })

  ipcMain.handle('characterarc:character-card-batch-export', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true, exportedCount: 0 }
    const req = payload as { cards?: Array<Record<string, unknown>>; format?: 'png' | 'json' }
    const cards = Array.isArray(req.cards) ? req.cards : []
    const format = req.format === 'png' ? 'png' : 'json'
    if (!cards.length) return { success: false, canceled: true, exportedCount: 0 }

    const result = await dialog.showOpenDialog(window, {
      title: '选择批量导出保存目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true, exportedCount: 0 }
    const targetDir = result.filePaths[0]

    try {
      await mkdir(targetDir, { recursive: true })
      let exported = 0
      const failed: string[] = []
      // 已占用的文件基名集合，避免同名卡片互相覆盖（同名时追加序号）
      const usedBaseNames = new Set<string>()
      for (const raw of cards) {
        const name = String(raw?.name ?? '角色卡').trim() || '角色卡'
        const baseName = name.replace(/[\\\\/:*?"<>|]/g, '_') || '角色卡'
        // 保证唯一文件名：同名或清洗后同名时追加序号，避免后写的文件覆盖先前的
        let uniqueBase = baseName
        let counter = 2
        while (usedBaseNames.has(uniqueBase)) {
          uniqueBase = `${baseName} (${counter})`
          counter += 1
        }
        usedBaseNames.add(uniqueBase)
        const safeName = uniqueBase
        const card = {
          name,
          description: String(raw?.description ?? ''),
          appearance: String(raw?.appearance ?? ''),
          personality: String(raw?.personality ?? ''),
          scenario: String(raw?.scenario ?? ''),
          greeting: String(raw?.greeting ?? ''),
          dialogueExamples: String(raw?.dialogueExamples ?? ''),
          tags: Array.isArray(raw?.tags) ? raw.tags.map((t) => String(t)) : []
        }
        const cardJson = buildV2CardJson(card)
        try {
          if (format === 'json') {
            const filePath = join(targetDir, `${safeName}.json`)
            await writeFile(filePath, cardJson, 'utf-8')
          } else {
            const avatarBase = typeof raw?.avatar === 'string' ? raw.avatar : ''
            const avatarBuf = resolveAvatarBuffer(avatarBase)
            let pngBuffer = avatarBuf
            if (!pngBuffer || !isPngBuffer(pngBuffer)) pngBuffer = createCharacterCardPng(card)
            const filePath = join(targetDir, `${safeName}.png`)
            await writeFile(filePath, embedCharaJsonIntoPng(pngBuffer, cardJson))
          }
          exported += 1
        } catch {
          failed.push(name)
        }
      }
      return { success: true, canceled: false, exportedCount: exported, failed, filePath: targetDir }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        exportedCount: 0,
        error: error instanceof Error ? error.message : '批量导出失败'
      }
    }
  })

  ipcMain.handle('characterarc:pick-character-avatar', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true, dataUrl: '' }
    const result = await dialog.showOpenDialog(window, {
      title: '选择人物头像',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true, dataUrl: '' }
    }
    const buffer = await readFile(result.filePaths[0])
    const mime = result.filePaths[0].toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
    return { success: true, canceled: false, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, fileName: basename(result.filePaths[0]) }
  })

  ipcMain.handle('characterarc:pick-background-image', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true, dataUrl: '' }
    const result = await dialog.showOpenDialog(window, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true, dataUrl: '' }
    }
    const buffer = await readFile(result.filePaths[0])
    const lower = result.filePaths[0].toLowerCase()
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg'
    return { success: true, canceled: false, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, fileName: basename(result.filePaths[0]) }
  })

  // ── 本地 SQL 文件路径与目录（存储与备份） ──
  ipcMain.handle('characterarc:get-local-sql-path', async () => {
    try {
      const dbPath = getWorkspaceDbFilePath()
      return { success: true, path: dbPath }
    } catch (err) {
      return { success: false, path: '', error: err instanceof Error ? err.message : '获取 SQL 文件地址失败' }
    }
  })

  ipcMain.handle('characterarc:open-local-sql-directory', async () => {
    try {
      const dir = getWorkspaceDirPath()
      const errMsg = await shell.openPath(dir)
      if (errMsg) {
        return { success: false, error: errMsg }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '打开 SQL 目录失败' }
    }
  })

  ipcMain.handle('characterarc:import-outline-spreadsheet', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }

    const result = await dialog.showOpenDialog(window, {
      title: '导入剧情大纲',
      properties: ['openFile'],
      filters: [{ name: 'Excel 或 CSV', extensions: ['xlsx', 'xls', 'csv'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const filePath = result.filePaths[0]
      const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' })
      const candidates = workbook.SheetNames
        .map((name) => {
          const rows = workbook.Sheets[name] ? readOutlineSheetRows(workbook.Sheets[name]) : []
          return {
            sheetName: name,
            rows,
            score: scoreOutlineSheet(rows)
          }
        })
        .sort((left, right) => right.score - left.score)
      const selectedSheet = candidates[0]
      if (!selectedSheet) throw new Error('文件中没有可读取的工作表。')
      const { sheetName, rows } = selectedSheet
      if (rows.length < 2) throw new Error(`工作表「${sheetName}」没有可导入的数据行。`)
      return { success: true, canceled: false, fileName: basename(filePath), sheetName, rows }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '无法读取大纲文件。'
      }
    }
  })

  ipcMain.handle('characterarc:export-outline-template', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }
    const result = await dialog.showSaveDialog(window, {
      title: '下载大纲 Excel 模板',
      defaultPath: 'CharacterArc-大纲导入模板.xlsx',
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    const headers = OUTLINE_SPREADSHEET_HEADERS
    const workbook = XLSX.utils.book_new()
    const templateSheet = XLSX.utils.aoa_to_sheet([headers, ['', '', '', '', '', '', '', '', '']])
    const exampleSheet = XLSX.utils.aoa_to_sheet([
      headers,
      ['第一卷：暗潮', '50000', '主角发现城中粮道失控的真正原因。', '1', '第1章：雨夜来客', '3200', '陌生人的求助可能是一场试探。', '主角在雨夜接下密信，并第一次接触南驿账簿。', '已规划'],
      ['', '', '', '2', '第2章：失踪账簿', '3500', '调查越深入，身边人的立场越可疑。', '账簿失踪，主角必须在官差封锁前找到经手人。', '点子']
    ])
    const descriptionSheet = XLSX.utils.aoa_to_sheet([
      ['字段', '是否必填', '说明'],
      ['分卷名称', '否', '每个分卷第一行填写即可，后续空白行自动沿用上一行分卷。不存在的分卷会在确认导入时新建。'],
      ['分卷目标字数', '否', '仅需在分卷第一行填写。'],
      ['分卷摘要', '否', '仅需在分卷第一行填写。'],
      ['章节序号', '否', '同一插入位置下的顺序，数字越小越靠前。'],
      ['章节标题', '是', '大纲节点标题。'],
      ['目标字数', '否', '章节预计字数。'],
      ['核心冲突', '否', '本章最主要的矛盾或阻力。'],
      ['剧情摘要', '否', '本章剧情推进内容。'],
      ['状态', '否', '可填：点子、已规划、写作中、已完成；不填默认已规划。']
    ])
    templateSheet['!cols'] = headers.map((header) => ({ wch: Math.max(12, header.length + 4) }))
    exampleSheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 36 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 36 }, { wch: 52 }, { wch: 12 }]
    descriptionSheet['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 72 }]
    templateSheet['!autofilter'] = { ref: 'A1:I1' }
    exampleSheet['!autofilter'] = { ref: 'A1:I1' }
    XLSX.utils.book_append_sheet(workbook, templateSheet, '大纲模板')
    XLSX.utils.book_append_sheet(workbook, exampleSheet, '填写示例')
    XLSX.utils.book_append_sheet(workbook, descriptionSheet, '字段说明')
    await writeFile(result.filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:export-outline-spreadsheet', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) return { success: false, canceled: true }
    const request = (payload ?? {}) as {
      projectTitle?: string
      volumes?: Array<{ id?: string; title?: string; wordTarget?: string; summary?: string }>
      items?: Array<{ volumeId?: string; title?: string; wordTarget?: string; conflict?: string; summary?: string; status?: string; sortOrder?: number }>
    }
    const safeProjectTitle = String(request.projectTitle ?? 'CharacterArc').replace(/[\\/:*?"<>|]/g, '-').trim() || 'CharacterArc'
    const result = await dialog.showSaveDialog(window, {
      title: '导出剧情大纲 Excel',
      defaultPath: `${safeProjectTitle}-剧情大纲.xlsx`,
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    const volumes = request.volumes ?? []
    const volumeMap = new Map(volumes.map((volume) => [volume.id ?? '', volume]))
    const volumeOrderMap = new Map(volumes.map((volume, index) => [volume.id ?? '', index]))
    const volumeSequence = new Map<string, number>()
    let previousVolumeId = ''
    const rows = [...(request.items ?? [])]
      .sort((left, right) => {
        const leftVolumeOrder = volumeOrderMap.get(left.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER
        const rightVolumeOrder = volumeOrderMap.get(right.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER
        return leftVolumeOrder - rightVolumeOrder || (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      })
      .map((item) => {
      const volumeId = item.volumeId ?? ''
      const sequence = (volumeSequence.get(volumeId) ?? 0) + 1
      volumeSequence.set(volumeId, sequence)
      const volume = volumeMap.get(volumeId)
      const shouldPrintVolume = volumeId !== previousVolumeId
      previousVolumeId = volumeId
      return {
        分卷名称: shouldPrintVolume ? volume?.title ?? '' : '',
        分卷目标字数: shouldPrintVolume ? volume?.wordTarget ?? '' : '',
        分卷摘要: shouldPrintVolume ? volume?.summary ?? '' : '',
        章节序号: sequence,
        章节标题: item.title ?? '',
        目标字数: item.wordTarget ?? '',
        核心冲突: item.conflict ?? '',
        剧情摘要: item.summary ?? '',
        状态: formatOutlineStatusLabel(item.status)
      }
    })
    const workbook = XLSX.utils.book_new()
    const outlineSheet = XLSX.utils.json_to_sheet(rows, { header: OUTLINE_SPREADSHEET_HEADERS })
    outlineSheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 36 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 36 }, { wch: 52 }, { wch: 12 }]
    outlineSheet['!autofilter'] = { ref: 'A1:I1' }
    XLSX.utils.book_append_sheet(workbook, outlineSheet, '剧情大纲')
    await writeFile(result.filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:pick-cover-image', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择项目封面',
      properties: ['openFile'],
      filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const filePath = result.filePaths[0]
    const bytes = await readFile(filePath)
    const mime = deps.resolveImageMime(filePath)
    return {
      success: true,
      canceled: false,
      filePath,
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`
    }
  })

  ipcMain.handle('characterarc:pick-continuation-novel', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择需要续写的小说 TXT',
      properties: ['openFile'],
      filters: [{ name: 'TXT 小说', extensions: ['txt'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const preview = await inspectContinuationNovelFile(result.filePaths[0])
      return { success: true, canceled: false, preview }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '读取小说文件失败'
      }
    }
  })

  ipcMain.handle('characterarc:pick-assistant-text-file', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择要上传的本地文件（txt / md）',
      properties: ['openFile'],
      filters: [
        { name: '文本文件', extensions: ['txt', 'md', 'markdown', 'mdown', 'mkd'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const filePath = result.filePaths[0]
      const stat = await import('node:fs/promises').then((fs) => fs.stat(filePath))
      if (stat.size > 4 * 1024 * 1024) {
        return { success: false, canceled: false, error: '文件过大，请选择小于 4MB 的文本文件。' }
      }
      const buffer = await import('node:fs/promises').then((fs) => fs.readFile(filePath, 'utf-8'))
      const baseName = filePath.split(/[\\/]/).pop() ?? filePath
      return { success: true, canceled: false, filePath, name: baseName, content: buffer }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '读取文件失败'
      }
    }
  })

  // ── 关系组织数据批量导入/导出 ──
  ipcMain.handle('characterarc:export-relations-data', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as {
      dataType: 'organization' | 'membership' | 'relationship'
      format: 'json' | 'txt' | 'markdown' | 'excel'
      organizations?: Array<{ id?: string; name?: string; type?: string; description?: string; motto?: string; color?: string }>
      memberships?: Array<{ id?: string; characterId?: string; organizationId?: string; role?: string; notes?: string; characterName?: string; organizationName?: string }>
      relationships?: Array<{ id?: string; fromCharacterId?: string; toCharacterId?: string; type?: string; description?: string; intensity?: number; fromCharacterName?: string; toCharacterName?: string }>
      projectTitle?: string
    }

    const dataType = request.dataType || 'organization'
    const format = request.format || 'json'
    const projectTitle = String(request.projectTitle || 'CharacterArc').replace(/[\\/:*?"<>|]/g, '-').trim() || 'CharacterArc'

    let defaultFileName = ''
    let filters: Array<{ name: string; extensions: string[] }> = []
    let fileContent: Buffer | string = ''

    // Build the exported content based on data type and format
    if (dataType === 'organization') {
      const orgs = request.organizations ?? []
      if (format === 'json') {
        defaultFileName = `${projectTitle}-组织势力.json`
        filters = [{ name: 'JSON 文件', extensions: ['json'] }]
        fileContent = JSON.stringify(orgs, null, 2)
      } else if (format === 'txt') {
        defaultFileName = `${projectTitle}-组织势力.txt`
        filters = [{ name: '文本文档', extensions: ['txt'] }]
        fileContent = orgs.map((org) => [
          `名称: ${org.name || ''}`,
          `类型: ${org.type || ''}`,
          `描述: ${org.description || ''}`,
          `口号: ${org.motto || ''}`,
          '---'
        ].join('\n')).join('\n\n')
      } else if (format === 'markdown') {
        defaultFileName = `${projectTitle}-组织势力.md`
        filters = [{ name: 'Markdown 文件', extensions: ['md', 'markdown'] }]
        fileContent = [
          `# ${projectTitle} - 组织势力`,
          '',
          '| 名称 | 类型 | 口号 | 描述 |',
          '|------|------|------|------|',
          ...orgs.map((org) => `| ${String(org.name || '').replace(/\|/g, '\\|')} | ${String(org.type || '').replace(/\|/g, '\\|')} | ${String(org.motto || '').replace(/\|/g, '\\|')} | ${String(org.description || '').replace(/\|/g, '\\|')} |`)
        ].join('\n')
      } else if (format === 'excel') {
        defaultFileName = `${projectTitle}-组织势力.xlsx`
        filters = [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
        const workbook = XLSX.utils.book_new()
        const sheet = XLSX.utils.json_to_sheet(orgs.map((org) => ({
          组织名称: org.name || '',
          组织类型: org.type || '',
          组织描述: org.description || '',
          口号: org.motto || '',
          主色调: org.color || ''
        })))
        sheet['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 50 }, { wch: 30 }, { wch: 12 }]
        XLSX.utils.book_append_sheet(workbook, sheet, '组织势力')
        fileContent = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      }
    } else if (dataType === 'membership') {
      const memberships = request.memberships ?? []
      if (format === 'json') {
        defaultFileName = `${projectTitle}-成员归属.json`
        filters = [{ name: 'JSON 文件', extensions: ['json'] }]
        fileContent = JSON.stringify(memberships, null, 2)
      } else if (format === 'txt') {
        defaultFileName = `${projectTitle}-成员归属.txt`
        filters = [{ name: '文本文档', extensions: ['txt'] }]
        fileContent = memberships.map((m) => [
          `角色: ${m.characterName || m.characterId || ''}`,
          `组织: ${m.organizationName || m.organizationId || ''}`,
          `身份: ${m.role || ''}`,
          `备注: ${m.notes || ''}`,
          '---'
        ].join('\n')).join('\n\n')
      } else if (format === 'markdown') {
        defaultFileName = `${projectTitle}-成员归属.md`
        filters = [{ name: 'Markdown 文件', extensions: ['md', 'markdown'] }]
        fileContent = [
          `# ${projectTitle} - 成员归属`,
          '',
          '| 角色 | 组织 | 身份 | 备注 |',
          '|------|------|------|------|',
          ...memberships.map((m) => `| ${String(m.characterName || m.characterId || '').replace(/\|/g, '\\|')} | ${String(m.organizationName || m.organizationId || '').replace(/\|/g, '\\|')} | ${String(m.role || '').replace(/\|/g, '\\|')} | ${String(m.notes || '').replace(/\|/g, '\\|')} |`)
        ].join('\n')
      } else if (format === 'excel') {
        defaultFileName = `${projectTitle}-成员归属.xlsx`
        filters = [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
        const workbook = XLSX.utils.book_new()
        const sheet = XLSX.utils.json_to_sheet(memberships.map((m) => ({
          角色: m.characterName || m.characterId || '',
          组织: m.organizationName || m.organizationId || '',
          组织身份: m.role || '',
          备注: m.notes || ''
        })))
        sheet['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 40 }]
        XLSX.utils.book_append_sheet(workbook, sheet, '成员归属')
        fileContent = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      }
    } else if (dataType === 'relationship') {
      const relationships = request.relationships ?? []
      if (format === 'json') {
        defaultFileName = `${projectTitle}-人物关系.json`
        filters = [{ name: 'JSON 文件', extensions: ['json'] }]
        fileContent = JSON.stringify(relationships, null, 2)
      } else if (format === 'txt') {
        defaultFileName = `${projectTitle}-人物关系.txt`
        filters = [{ name: '文本文档', extensions: ['txt'] }]
        fileContent = relationships.map((rel) => [
          `角色A: ${rel.fromCharacterName || rel.fromCharacterId || ''}`,
          `角色B: ${rel.toCharacterName || rel.toCharacterId || ''}`,
          `类型: ${rel.type || ''}`,
          `描述: ${rel.description || ''}`,
          `强度: ${rel.intensity ?? 0}`,
          '---'
        ].join('\n')).join('\n\n')
      } else if (format === 'markdown') {
        defaultFileName = `${projectTitle}-人物关系.md`
        filters = [{ name: 'Markdown 文件', extensions: ['md', 'markdown'] }]
        fileContent = [
          `# ${projectTitle} - 人物关系`,
          '',
          '| 角色A | 角色B | 类型 | 强度 | 描述 |',
          '|------|------|------|------|------|',
          ...relationships.map((rel) => `| ${String(rel.fromCharacterName || rel.fromCharacterId || '').replace(/\|/g, '\\|')} | ${String(rel.toCharacterName || rel.toCharacterId || '').replace(/\|/g, '\\|')} | ${String(rel.type || '').replace(/\|/g, '\\|')} | ${rel.intensity ?? 0} | ${String(rel.description || '').replace(/\|/g, '\\|')} |`)
        ].join('\n')
      } else if (format === 'excel') {
        defaultFileName = `${projectTitle}-人物关系.xlsx`
        filters = [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
        const workbook = XLSX.utils.book_new()
        const sheet = XLSX.utils.json_to_sheet(relationships.map((rel) => ({
          角色A: rel.fromCharacterName || rel.fromCharacterId || '',
          角色B: rel.toCharacterName || rel.toCharacterId || '',
          关系类型: rel.type || '',
          强度: rel.intensity ?? 0,
          描述: rel.description || ''
        })))
        sheet['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 8 }, { wch: 40 }]
        XLSX.utils.book_append_sheet(workbook, sheet, '人物关系')
        fileContent = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      }
    } else {
      return { success: false, canceled: false, error: '未知的数据类型。' }
    }

    const result = await dialog.showSaveDialog(window, {
      title: `导出${dataType === 'organization' ? '组织势力' : dataType === 'membership' ? '成员归属' : '人物关系'}`,
      defaultPath: defaultFileName,
      filters
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    await writeFile(result.filePath, fileContent)
    return { success: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('characterarc:import-relations-data', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as {
      dataType: 'organization' | 'membership' | 'relationship'
    }
    const dataType = request.dataType || 'organization'

    const result = await dialog.showOpenDialog(window, {
      title: `导入${dataType === 'organization' ? '组织势力' : dataType === 'membership' ? '成员归属' : '人物关系'}`,
      properties: ['openFile'],
      filters: [
        { name: '支持的文件', extensions: ['json', 'txt', 'md', 'markdown', 'xlsx', 'xls', 'csv'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const filePath = result.filePaths[0]
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      const fileName = basename(filePath)

      // JSON import
      if (ext === 'json') {
        const raw = await readFile(filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        const items = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>).items
        if (!Array.isArray(items)) {
          return { success: false, canceled: false, error: 'JSON 文件结构无效，应为数组或含 items 数组的对象。' }
        }
        return { success: true, canceled: false, fileName, data: items }
      }

      // Excel / CSV import
      if (['xlsx', 'xls', 'csv'].includes(ext)) {
        const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        if (!sheet) return { success: false, canceled: false, error: 'Excel 文件中没有工作表。' }
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
        return { success: true, canceled: false, fileName, data: rows }
      }

      // TXT / Markdown import
      if (['txt', 'md', 'markdown'].includes(ext)) {
        const raw = await readFile(filePath, 'utf-8')
        const lines = raw.split('\n').map((line) => line.trim())

        // Detect if it's a markdown table
        const isMarkdownTable = lines.some((line) => /^\|.*\|.*\|.*\|$/.test(line)) && lines.some((line) => /^\|[-:]+\|/.test(line))

        if (isMarkdownTable) {
          // Parse markdown table
          const headerLine = lines.findIndex((line) => /^\|/.test(line) && /[^\|]/.test(line))
          const separatorLine = lines.findIndex((line, i) => i > headerLine && /^\|[-:]+\|/.test(line))
          if (headerLine < 0 || separatorLine < 0) {
            return { success: false, canceled: false, error: 'Markdown 表格格式无效。' }
          }
          const headers = lines[headerLine].split('\|').filter((h) => h.trim()).map((h) => h.trim())
          const items = []
          for (let i = separatorLine + 1; i < lines.length; i++) {
            const line = lines[i]
            if (!line.startsWith('|')) continue
            const cells = line.split('\|').filter((c) => c.trim())
            if (cells.length < headers.length) continue
            const item: Record<string, unknown> = {}
            headers.forEach((header, index) => {
              item[header] = cells[index]?.trim() || ''
            })
            items.push(item)
          }
          return { success: true, canceled: false, fileName, data: items }
        }

        // Parse TXT format with "key: value" lines
        const items: Array<Record<string, unknown>> = []
        let current: Record<string, unknown> | null = null
        for (const line of lines) {
          if (!line) continue
          if (line === '---') {
            if (current) items.push(current)
            current = null
            continue
          }
          const match = line.match(/^([^:]+):\s*(.*)$/)
          if (match) {
            const key = match[1].trim()
            const value = match[2].trim()
            if (!current) current = {}
            current[key] = value
          } else if (current) {
            // Append continuation text
            const lastKey = Object.keys(current).pop()
            if (lastKey) {
              const existing = String(current[lastKey] ?? '')
              current[lastKey] = existing ? `${existing}\n${line}` : line
            }
          }
        }
        if (current) items.push(current)

        if (items.length === 0) {
          return { success: false, canceled: false, error: '未能从文本文件中解析出数据。' }
        }
        return { success: true, canceled: false, fileName, data: items }
      }

      return { success: false, canceled: false, error: '不支持的文件格式。' }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '文件解析失败'
      }
    }
  })

  ipcMain.handle('characterarc:save-cover-image', async (_event, payload: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = payload as { dataUrl?: string; defaultFileName?: string }
    const dataUrl = String(request?.dataUrl ?? '').trim()
    if (!dataUrl) {
      return { success: false, error: '没有可保存的封面图片。' }
    }

    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) {
      return { success: false, error: '封面数据格式无效，无法保存。' }
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const base64Data = match[2]
    const defaultName = request?.defaultFileName?.trim() || `cover-${Date.now()}.${ext}`

    const result = await dialog.showSaveDialog(window, {
      title: '保存封面图片',
      defaultPath: defaultName,
      filters: [{ name: '图片文件', extensions: [ext, 'png', 'jpg', 'webp'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    await writeFile(result.filePath, Buffer.from(base64Data, 'base64'))
    return {
      success: true,
      canceled: false,
      filePath: result.filePath
    }
  })

  ipcMain.handle('characterarc:read-reference-novel-text', async (_event, refId: string) => {
    if (!refId) return { success: false, error: '缺少参考作品 ID' }
    const novelPath = join(getWorkspaceDirPath(), 'reference-novels', `${refId}.txt`)
    try {
      const content = await readFile(novelPath, 'utf-8')
      return { success: true, content }
    } catch {
      return { success: false, error: '未找到该参考作品的原文存档，可能是旧版本导入的作品' }
    }
  })

  ipcMain.handle('characterarc:import-reference-novel-analysis', async (_event, payload: ReferenceNovelImportRequest) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '导入参考小说',
      properties: ['openFile'],
      filters: [{ name: '小说文本', extensions: ['txt', 'md', 'docx'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const request = (payload ?? {}) as ReferenceNovelImportRequest
      deps.emitReferenceImportProgress(window, {
        phase: 'extracting',
        message: '正在读取小说正文并提取基础统计...',
        current: 0,
        total: 1,
        percent: 8
      })
      const importedFilePath = result.filePaths[0]
      const localContext = await extractReferenceNovelContext(importedFilePath)
      const resolvedTitle = request.preferredTitle?.trim() || localContext.title
      const resolvedSource = request.preferredSource?.trim() || localContext.fileType.toUpperCase()
      deps.emitReferenceImportProgress(window, {
        phase: 'chunking',
        message: `已拆出 ${localContext.analysisChunks.length} 个分析分块，准备逐块提炼风格...`,
        current: 0,
        total: Math.max(localContext.analysisChunks.length, 1),
        percent: 16,
        sourceTitle: resolvedTitle
      })
      const chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }> = []
      for (const [index, chunk] of localContext.analysisChunks.entries()) {
        deps.emitReferenceImportProgress(window, {
          phase: 'chunk-analysis',
          message: `正在分析第 ${index + 1} / ${localContext.analysisChunks.length} 个分块：${chunk.label}`,
          current: index + 1,
          total: localContext.analysisChunks.length,
          percent: Math.min(82, 16 + Math.round(((index + 1) / Math.max(localContext.analysisChunks.length, 1)) * 58)),
          sourceTitle: resolvedTitle
        })
        chunkResults.push({
          label: chunk.label,
          characterCount: chunk.characterCount,
          result: (await runAiTask({
            task: 'reference-style-chunk',
            settings: request.settings,
            context: {
              projectId: request.projectId ?? '',
              projectTitle: request.projectTitle ?? '',
              projectGenre: request.projectGenre ?? '',
              projectPlatform: request.projectPlatform ?? '',
              projectSkills: request.projectSkills ?? [],
              sourceTitle: resolvedTitle,
              chunkLabel: chunk.label,
              chunkIndex: index + 1,
              chunkTotal: localContext.analysisChunks.length,
              chunkCharacterCount: chunk.characterCount,
              chunkMetrics: chunk.metrics,
              chunkKeywords: chunk.topKeywords,
              chunkText: chunk.text
            }
          })).result as ReferenceStyleChunkResult
        })
      }
      deps.emitReferenceImportProgress(window, {
        phase: 'aggregating',
        message: '正在汇总所有分块结论，生成可复用仿写模板...',
        current: chunkResults.length,
        total: chunkResults.length,
        percent: 90,
        sourceTitle: resolvedTitle
      })
      const analysis = (await runAiTask({
        task: 'reference-style-analysis',
        settings: request.settings,
        context: {
          projectId: request.projectId ?? '',
          projectTitle: request.projectTitle ?? '',
          projectGenre: request.projectGenre ?? '',
          projectPlatform: request.projectPlatform ?? '',
          projectSkills: request.projectSkills ?? [],
          sourceTitle: resolvedTitle,
          sourceFileType: localContext.fileType,
          sourceCharacterCount: localContext.characterCount,
          sourceChapterCount: localContext.chapterCount,
          styleMetrics: localContext.metrics,
          topKeywords: localContext.topKeywords,
          sourceExcerpt: localContext.excerpt,
          analysisSample: localContext.analysisSample,
          chunkSummaries: deps.formatReferenceChunkSummaries(chunkResults)
        }
      })).result as ReferenceStyleAnalysisResult

      const importedAt = new Date().toISOString()
      const knowledgeDocuments = deps.buildImportedReferenceKnowledgeDocuments(resolvedTitle, localContext, analysis, chunkResults, importedAt)
      deps.emitReferenceImportProgress(window, {
        phase: 'saving',
        message: '正在整理结果并归档到拆书知识库...',
        current: 1,
        total: 1,
        percent: 96,
        sourceTitle: resolvedTitle
      })
      const refId = `ref-${Date.now()}`

      // 保存原文到本地，供后续风格指纹提取等功能直接读取
      const novelStorageDir = join(getWorkspaceDirPath(), 'reference-novels')
      await mkdir(novelStorageDir, { recursive: true })
      const rawNovelText = await readFile(importedFilePath, 'utf-8')
      await writeFile(join(novelStorageDir, `${refId}.txt`), rawNovelText, 'utf-8')

      // 异步为原文建立向量索引（不阻塞导入流程）
      if (request.projectId) {
        indexReferenceNovel(request.settings, request.projectId, refId, rawNovelText).catch(() => {})
      }

      const referenceWork = {
        id: refId,
        title: resolvedTitle,
        source: resolvedSource,
        notes: analysis.overview,
        fileName: localContext.fileName,
        analysis: {
          createdAt: importedAt,
          fileName: localContext.fileName,
          fileType: localContext.fileType,
          characterCount: localContext.characterCount,
          chapterCount: localContext.chapterCount,
          excerpt: localContext.excerpt,
          topKeywords: localContext.topKeywords,
          metrics: [
            ...localContext.metrics,
            { label: '分析分块数', value: `${localContext.analysisChunks.length} 块` }
          ],
          overview: analysis.overview,
          sentenceStyle: analysis.sentenceStyle,
          dialogueRatio: analysis.dialogueRatio,
          pacingControl: analysis.pacingControl,
          emotionExpression: analysis.emotionExpression,
          narrativePerspective: analysis.narrativePerspective,
          styleRules: analysis.styleRules,
          plotOutline: analysis.plotOutline,
          reusableStylePrompt: analysis.reusableStylePrompt,
          avoidRules: analysis.avoidRules
        }
      }
      deps.emitReferenceImportProgress(window, {
        phase: 'done',
        message: `《${resolvedTitle}》拆书完成，结果已归档到拆书知识库。`,
        current: 1,
        total: 1,
        percent: 100,
        sourceTitle: resolvedTitle
      })

      return {
        success: true,
        canceled: false,
        result: {
          referenceWork,
          suggestedWritingStylePrompt: deps.buildImportedReferenceStylePrompt(resolvedTitle, analysis),
          knowledgeDocuments
        }
      }
    } catch (error) {
      return {
        success: false,
        canceled: false,
        error: error instanceof Error ? error.message : '参考作品拆书失败'
      }
    }
  })

  // ── 选择参考小说文件（不立即开始拆书） ──
  ipcMain.handle('characterarc:pick-reference-novel-files', async () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const result = await dialog.showOpenDialog(window, {
      title: '选择参考小说',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '小说文本', extensions: ['txt', 'md', 'docx'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const files: Array<{ filePath: string; fileName: string; size: number }> = []
    for (const filePath of result.filePaths) {
      try {
        const stats = await stat(filePath)
        files.push({ filePath, fileName: basename(filePath), size: stats.size })
      } catch {
        files.push({ filePath, fileName: basename(filePath), size: 0 })
      }
    }
    return { success: true, canceled: false, files }
  })

  // ── 章节/分卷本地文件导入（支持 txt / md） ──
  ipcMain.handle('characterarc:pick-chapter-import-file', async () => {
    const window = deps.windowManager.getActiveWindow() ?? BrowserWindow.getFocusedWindow()
    const dialogOptions: Electron.OpenDialogOptions = {
      title: '选择要导入的章节/分卷文件',
      properties: ['openFile'],
      filters: [
        { name: '文本文件', extensions: ['txt', 'md', 'markdown'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || !result.filePaths[0]) {
      return { success: true, canceled: true }
    }

    const filePath = result.filePaths[0]
    try {
      const buffer = await readFile(filePath)
      const content = buffer.toString('utf8')
      const fileName = basename(filePath)
      // 标题优先取文件去掉扩展名的名字
      const title = fileName.replace(/\.[^.]+$/, '').trim() || fileName
      const charCount = content.replace(/\s/g, '').length
      return {
        success: true,
        canceled: false,
        file: { filePath, fileName, title, content, charCount }
      }
    } catch (error) {
      return { success: false, canceled: false, error: error instanceof Error ? error.message : '读取文件失败' }
    }
  })

  // ── 批量导入参考小说（支持多选、并发控制） ──
  ipcMain.handle('characterarc:import-reference-novel-batch', async (_event, payload: ReferenceNovelImportRequest & { filePaths?: string[]; concurrency?: number }) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return { success: false, canceled: true }
    }

    const request = (payload ?? {}) as ReferenceNovelImportRequest & { filePaths?: string[]; concurrency?: number }
    let filePaths = Array.isArray(request.filePaths) ? request.filePaths.filter((p): p is string => typeof p === 'string' && p.length > 0) : []

    // 兼容旧调用：如果未提供 filePaths，则回退到弹原生对话框
    if (filePaths.length === 0) {
      const result = await dialog.showOpenDialog(window, {
        title: '批量导入参考小说',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '小说文本', extensions: ['txt', 'md', 'docx'] }]
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }
      filePaths = result.filePaths
    }

    const bookTotal = filePaths.length
    const MAX_CONCURRENCY = Math.max(1, Math.min(8, Math.floor(request.concurrency ?? 3)))

    type BookResult = {
      bookId: string
      success: boolean
      result?: {
        referenceWork: unknown
        suggestedWritingStylePrompt: string
        knowledgeDocuments: unknown[]
      }
      error?: string
      fileName: string
    }

    const results: BookResult[] = []
    let completedCount = 0

    // 每本书一个 AbortController，支持单本停止
    const bookControllers = new Map<string, AbortController>()
    activeBatchBookControllers = bookControllers

    async function processOneBook(filePath: string, bookIndex: number, bookId: string): Promise<BookResult> {
      const fileName = basename(filePath)
      const controller = new AbortController()
      bookControllers.set(bookId, controller)

      const emit = (patch: Partial<ReferenceImportProgressPayload> & { phase: ReferenceImportProgressPayload['phase'] }) => {
        deps.emitReferenceImportProgress(window!, {
          message: '',
          current: 0,
          total: 1,
          percent: 0,
          sourceTitle: fileName,
          bookId,
          bookIndex,
          bookTotal,
          status: 'running',
          ...patch
        })
      }

      try {
        if (controller.signal.aborted) throw new Error('已取消')

        emit({ phase: 'extracting', message: '正在读取文件并提取基础信息…', percent: 5 })
        const localContext = await extractReferenceNovelContext(filePath)
        if (controller.signal.aborted) throw new Error('已取消')
        const resolvedTitle = request.preferredTitle?.trim() || localContext.title
        const resolvedSource = request.preferredSource?.trim() || localContext.fileType.toUpperCase()

        emit({
          phase: 'chunking',
          message: `已切分 ${localContext.analysisChunks.length} 个分块`,
          sourceTitle: resolvedTitle,
          percent: 16,
          chunkTotal: localContext.analysisChunks.length
        })

        const chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }> = []
        const chunkTotal = localContext.analysisChunks.length
        for (const [index, chunk] of localContext.analysisChunks.entries()) {
          if (controller.signal.aborted) throw new Error('已取消')
          emit({
            phase: 'chunk-analysis',
            message: `分析分块 ${index + 1}/${chunkTotal}：${chunk.label}`,
            sourceTitle: resolvedTitle,
            percent: Math.min(82, 16 + Math.round(((index + 1) / Math.max(chunkTotal, 1)) * 58)),
            chunkIndex: index + 1,
            chunkTotal,
            chunkLabel: chunk.label
          })
          chunkResults.push({
            label: chunk.label,
            characterCount: chunk.characterCount,
            result: (await runAiTask({
              task: 'reference-style-chunk',
              settings: request.settings,
              context: {
                projectId: request.projectId ?? '',
                projectTitle: request.projectTitle ?? '',
                projectGenre: request.projectGenre ?? '',
                projectPlatform: request.projectPlatform ?? '',
                projectSkills: request.projectSkills ?? [],
                sourceTitle: resolvedTitle,
                chunkLabel: chunk.label,
                chunkIndex: index + 1,
                chunkTotal,
                chunkCharacterCount: chunk.characterCount,
                chunkMetrics: chunk.metrics,
                chunkKeywords: chunk.topKeywords,
                chunkText: chunk.text
              }
            })).result as ReferenceStyleChunkResult
          })
        }

        if (controller.signal.aborted) throw new Error('已取消')
        emit({
          phase: 'aggregating',
          message: '正在汇总所有分块结论…',
          sourceTitle: resolvedTitle,
          percent: 90,
          chunkIndex: chunkTotal,
          chunkTotal
        })

        const analysis = (await runAiTask({
          task: 'reference-style-analysis',
          settings: request.settings,
          context: {
            projectId: request.projectId ?? '',
            projectTitle: request.projectTitle ?? '',
            projectGenre: request.projectGenre ?? '',
            projectPlatform: request.projectPlatform ?? '',
            projectSkills: request.projectSkills ?? [],
            sourceTitle: resolvedTitle,
            sourceFileType: localContext.fileType,
            sourceCharacterCount: localContext.characterCount,
            sourceChapterCount: localContext.chapterCount,
            styleMetrics: localContext.metrics,
            topKeywords: localContext.topKeywords,
            sourceExcerpt: localContext.excerpt,
            analysisSample: localContext.analysisSample,
            chunkSummaries: deps.formatReferenceChunkSummaries(chunkResults)
          }
        })).result as ReferenceStyleAnalysisResult

        if (controller.signal.aborted) throw new Error('已取消')
        emit({
          phase: 'saving',
          message: '正在归档到知识库…',
          sourceTitle: resolvedTitle,
          percent: 96
        })

        const importedAt = new Date().toISOString()
        const knowledgeDocuments = deps.buildImportedReferenceKnowledgeDocuments(resolvedTitle, localContext, analysis, chunkResults, importedAt)

        const refId = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const novelStorageDir = join(getWorkspaceDirPath(), 'reference-novels')
        await mkdir(novelStorageDir, { recursive: true })
        const rawNovelText = await readFile(filePath, 'utf-8')
        await writeFile(join(novelStorageDir, `${refId}.txt`), rawNovelText, 'utf-8')

        if (request.projectId) {
          indexReferenceNovel(request.settings, request.projectId, refId, rawNovelText).catch(() => {})
        }

        const referenceWork = {
          id: refId,
          title: resolvedTitle,
          source: resolvedSource,
          notes: analysis.overview,
          fileName: localContext.fileName,
          analysis: {
            createdAt: importedAt,
            fileName: localContext.fileName,
            fileType: localContext.fileType,
            characterCount: localContext.characterCount,
            chapterCount: localContext.chapterCount,
            excerpt: localContext.excerpt,
            topKeywords: localContext.topKeywords,
            metrics: [
              ...localContext.metrics,
              { label: '分析分块数', value: `${localContext.analysisChunks.length} 块` }
            ],
            overview: analysis.overview,
            sentenceStyle: analysis.sentenceStyle,
            dialogueRatio: analysis.dialogueRatio,
            pacingControl: analysis.pacingControl,
            emotionExpression: analysis.emotionExpression,
            narrativePerspective: analysis.narrativePerspective,
            styleRules: analysis.styleRules,
            plotOutline: analysis.plotOutline,
            reusableStylePrompt: analysis.reusableStylePrompt,
            avoidRules: analysis.avoidRules
          }
        }

        completedCount++
        emit({
          phase: 'done',
          message: `已归档 ${knowledgeDocuments.length} 篇知识文档 · 风格规则 ${analysis.styleRules?.length ?? 0} 条`,
          sourceTitle: resolvedTitle,
          percent: 100,
          status: 'success'
        })

        return {
          bookId,
          success: true,
          result: {
            referenceWork,
            suggestedWritingStylePrompt: deps.buildImportedReferenceStylePrompt(resolvedTitle, analysis),
            knowledgeDocuments
          },
          fileName
        }
      } catch (error) {
        completedCount++
        const message = error instanceof Error ? error.message : '拆书失败'
        const isCanceled = controller.signal.aborted || message.includes('已取消')
        emit({
          phase: 'done',
          message: isCanceled ? '已取消' : message,
          percent: 0,
          status: isCanceled ? 'canceled' : 'error'
        })
        return {
          bookId,
          success: false,
          error: isCanceled ? '已取消' : message,
          fileName
        }
      } finally {
        bookControllers.delete(bookId)
      }
    }

    const queue = filePaths.map((fp, i) => ({
      filePath: fp,
      bookIndex: i + 1,
      bookId: `book-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`
    }))

    // 上报排队态，让前端可以一次性渲染所有书的初始卡片
    for (const item of queue) {
      deps.emitReferenceImportProgress(window!, {
        phase: 'extracting',
        message: '排队中…',
        current: 0,
        total: 1,
        percent: 0,
        sourceTitle: basename(item.filePath),
        bookId: item.bookId,
        bookIndex: item.bookIndex,
        bookTotal,
        status: 'queued'
      })
    }

    const executing = new Set<Promise<void>>()
    for (const item of queue) {
      const p = processOneBook(item.filePath, item.bookIndex, item.bookId).then((r) => {
        results.push(r)
      })
      const wrapped = p.then(() => { executing.delete(wrapped) })
      executing.add(wrapped)
      if (executing.size >= MAX_CONCURRENCY) {
        await Promise.race(executing)
      }
    }
    await Promise.all(executing)

    activeBatchBookControllers = null

    results.sort((a, b) => {
      const ai = queue.findIndex((q) => q.bookId === a.bookId)
      const bi = queue.findIndex((q) => q.bookId === b.bookId)
      return ai - bi
    })

    return { success: true, canceled: false, results }
  })

  // ── 取消单本/全部批量拆书任务 ──
  ipcMain.handle('characterarc:cancel-reference-novel-book', async (_event, bookId: unknown) => {
    if (!activeBatchBookControllers) return { success: false, error: '没有正在进行的批量任务' }
    if (typeof bookId === 'string' && bookId) {
      const ctl = activeBatchBookControllers.get(bookId)
      if (!ctl) return { success: false, error: '未找到该任务' }
      ctl.abort()
      return { success: true }
    }
    // 不传 bookId 则全部取消
    for (const ctl of activeBatchBookControllers.values()) ctl.abort()
    return { success: true }
  })

  ipcMain.handle('characterarc:workspace-sync-publish', (event, payload: unknown) => {
    if (payload && typeof payload === 'object') {
      deps.setLatestWorkspaceSnapshot(deps.normalizeWorkspacePayload(payload))
    }
    deps.windowManager.broadcastWindowEvent('characterarc:workspace-sync-event', payload, event.sender.id)
    return { success: true }
  })

  ipcMain.handle('characterarc:load-workspace', async () => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const workspace = deps.readWorkspaceSnapshot(db)

      if (!workspace) {
        return { success: false, payload: null }
      }

      deps.setLatestWorkspaceSnapshot(workspace)
      nativeTheme.themeSource = (workspace as { appSettings?: { darkMode?: boolean } }).appSettings?.darkMode ? 'dark' : 'light'

      return {
        success: true,
        payload: workspace
      }
    } catch (error) {
      console.error('[workspace] loadWorkspace failed:', error)
      return {
        success: false,
        payload: null,
        error: error instanceof Error ? error.message : 'Unknown workspace load error'
      }
    }
  })

  ipcMain.handle('characterarc:get-zoom-factor', () => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return {
        success: false,
        error: 'No active window'
      }
    }

    return {
      success: true,
      factor: window.webContents.getZoomFactor()
    }
  })

  ipcMain.handle('characterarc:set-zoom-factor', (_event, factor: unknown) => {
    const window = deps.windowManager.getActiveWindow()
    if (!window) {
      return {
        success: false,
        error: 'No active window'
      }
    }

    const numericFactor = typeof factor === 'number' ? factor : Number(factor)
    const nextFactor = Number.isFinite(numericFactor) ? Math.min(1.75, Math.max(0.75, numericFactor)) : 1
    window.webContents.setZoomFactor(nextFactor)

    return {
      success: true,
      factor: nextFactor
    }
  })

  ipcMain.handle('characterarc:set-titlebar-overlay', (_event, options: unknown) => {
    const value = options as { color?: unknown; symbolColor?: unknown } | null
    const colors = value && typeof value.color === 'string' && typeof value.symbolColor === 'string'
      ? { color: value.color, symbolColor: value.symbolColor }
      : undefined
    deps.windowManager.updateTitleBarOverlayColors(colors)
  })

  ipcMain.handle('characterarc:save-workspace', async (_event, payload: unknown) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const normalized = deps.normalizeWorkspacePayload(payload)
      deps.writeWorkspaceSnapshot(db, normalized)
      deps.setLatestWorkspaceSnapshot(normalized)
      nativeTheme.themeSource = (normalized as { appSettings?: { darkMode?: boolean } }).appSettings?.darkMode ? 'dark' : 'light'

      cleanupOrphanReferenceNovelFiles(normalized).catch((error) => {
        console.warn('[workspace] reference-novels cleanup failed:', error)
      })

      return { success: true }
    } catch (error) {
      console.error('[workspace] saveWorkspace failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown workspace save error'
      }
    }
  })

  ipcMain.on('characterarc:save-workspace-sync', (event, payload: unknown) => {
    try {
      const db = deps.getWorkspaceDbIfInitialized()
      if (!db) {
        throw new Error('工作区数据库尚未初始化')
      }
      const normalized = deps.normalizeWorkspacePayload(payload)
      deps.writeWorkspaceSnapshot(db, normalized)
      deps.setLatestWorkspaceSnapshot(normalized)
      deps.windowManager.broadcastWindowEvent('characterarc:workspace-sync-event', normalized, event.sender.id)
      event.returnValue = { success: true }
    } catch (error) {
      console.error('[workspace] saveWorkspaceSync failed:', error)
      event.returnValue = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown workspace save error'
      }
    }
  })

  ipcMain.handle('characterarc:save-app-settings', async (_event, payload: unknown) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const record = (payload ?? {}) as {
        theme?: unknown
        selectedProjectId?: unknown
        appSettings?: unknown
      }
      const theme = typeof record.theme === 'string' ? record.theme : 'ocean'
      const selectedProjectId = typeof record.selectedProjectId === 'string' ? record.selectedProjectId : ''
      const metadata = { theme, selectedProjectId }
      deps.writeAppSettingsRow(db, record.appSettings, metadata)
      deps.setLatestAppSettings(record.appSettings, metadata)
      nativeTheme.themeSource = (record.appSettings as { darkMode?: boolean } | undefined)?.darkMode ? 'dark' : 'light'
      return { success: true }
    } catch (error) {
      console.error('[workspace] saveAppSettings failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown app settings save error'
      }
    }
  })

  // ── 内置 / 项目级 skills 目录的绝对路径 ──
  // 返回内置 skills 与项目级 skills 所在目录的完整绝对路径，供 UI 展示“每个电脑上都通用”的真实路径。
  ipcMain.handle('characterarc:project-skills-paths', async (_event, projectId: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim() || undefined
      return {
        success: true,
        builtinDir: getBuiltinSkillsDirPath(),
        projectDir: getSkillsDirPath(resolvedProjectId || undefined)
      }
    } catch {
      return { success: true, builtinDir: '', projectDir: '' }
    }
  })

  ipcMain.handle('characterarc:project-skills-scan', async (_event, projectId: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim() || undefined
      await refreshSkillRegistry(resolvedProjectId)
      return { success: true, skills: skillScanEntries(resolvedProjectId) }
    } catch {
      return { success: true, skills: [] }
    }
  })

  // ── 项目级 skills 分组管理 ──
  // 分组即 project-skills/<group>/ 下的一个子目录，用于对项目导入的 skills 分类归档。
  // 列出当前已有的分组（含分组内 skill 数量）。
  ipcMain.handle('characterarc:project-skills-groups', async (_event, projectId: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim() || undefined
      const skillsRoot = getSkillsDirPath(resolvedProjectId || undefined)
      if (!existsSync(skillsRoot)) {
        return { success: true, groups: [] }
      }
      const entries = await readdir(skillsRoot, { withFileTypes: true })
      const groups: Array<{ name: string; count: number }> = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dirPath = join(skillsRoot, entry.name)
        // 顶层即 skill（根级），跳过；仅收集作为分组容器的子目录
        if (existsSync(join(dirPath, 'SKILL.md'))) continue
        const subEntries = await readdir(dirPath, { withFileTypes: true }).catch(() => [] as Array<import('node:fs').Dirent>)
        const count = subEntries.filter((sub) => sub.isDirectory() && existsSync(join(dirPath, sub.name, 'SKILL.md'))).length
        groups.push({ name: entry.name, count })
      }
      return { success: true, groups: groups.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) }
    } catch {
      return { success: true, groups: [] }
    }
  })

  // 创建新的 skills 分组：在项目 skills 根目录下新建一个分组目录。
  ipcMain.handle('characterarc:project-skills-create-group', async (_event, projectId: unknown, groupName: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim() || undefined
      const name = String(groupName ?? '').trim().replace(/[\\/]/g, '').replace(/[^A-Za-z0-9\u4e00-\u9fa5-]/g, '')
      if (!name || name === '.' || name === '..') {
        return { success: false, error: '分组名称不能为空或非法' }
      }
      const skillsRoot = getSkillsDirPath(resolvedProjectId || undefined)
      const groupDir = join(skillsRoot, name)
      await mkdir(groupDir, { recursive: true })
      return { success: true, name }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '创建分组失败' }
    }
  })

  // 删除一个 skills 分组：连同分组内所有 skills 一起删除（仅项目级分组，内置分组不可删）。
  ipcMain.handle('characterarc:project-skills-delete-group', async (_event, projectId: unknown, groupName: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim() || undefined
      const name = String(groupName ?? '')
        .split(/[\\/]+/)
        .map((seg) => seg.trim())
        .filter((seg) => seg && seg !== '.' && seg !== '..')
        .map((seg) => seg.replace(/[^A-Za-z0-9\u4e00-\u9fa5-]/g, ''))
        .filter(Boolean)
        .join('/')
      if (!name) {
        return { success: false, error: '分组名称不能为空或非法' }
      }
      const skillsRoot = getSkillsDirPath(resolvedProjectId || undefined)
      const groupDir = join(skillsRoot, name)
      // 安全校验：分组目录必须位于项目 skills 根目录之内，且确实是一个分组容器（非顶层 skill）
      if (!groupDir.startsWith(skillsRoot)) {
        return { success: false, error: '非法的分组路径' }
      }
      if (!existsSync(groupDir)) {
        return { success: false, error: '分组「' + name + '」不存在' }
      }
      if (existsSync(join(groupDir, 'SKILL.md'))) {
        return { success: false, error: '该目录是一个 skill 而非分组，无法作为分组删除' }
      }
      await rm(groupDir, { recursive: true, force: true })
      await refreshSkillRegistry(resolvedProjectId || undefined)
      return { success: true, deletedGroup: name }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '删除分组失败' }
    }
  })

  ipcMain.handle('characterarc:project-skills-import', async (_event, projectId: unknown, targetGroup: unknown, mode: unknown) => {
    // 记录本次导入过程中创建的所有解压临时目录，统一在导入完成后清理（复制完成后再删）。
    const pendingTempRoots: string[] = []
    try {
      const resolvedProjectId = String(projectId ?? '').trim() || undefined
      // 可选的目标分组名（导入到 project-skills/<group>/<skill>）。
      // 为空表示导入到根目录；仅允许安全的目录名，禁止路径穿越。
      const safeGroup = String(targetGroup ?? '')
        .split(/[\\/]+/)
        .map((seg) => seg.trim())
        .filter((seg) => seg && seg !== '.' && seg !== '..')
        .map((seg) => seg.replace(/[^A-Za-z0-9\u4e00-\u9fa5-]/g, ''))
        .filter(Boolean)
        .join('/')

      // 导入来源模式：'dir' 只选目录、'zip' 只选 .zip、'both' 兼容旧调用（目录与 .zip 都可选）。
      // 原因：Windows 上同时设置 openFile + openDirectory 时，原生文件管理器会退化为
      // “只显示文件夹”，导致用户选不到 .zip 压缩包。因此把目录导入与 .zip 导入拆成两个
      // 独立入口，各自只带对应的 property，从根上保证 .zip 压缩包一定能被选中。
      const importMode = String(mode ?? '').trim().toLowerCase()
      let dialogOptions: Electron.OpenDialogOptions
      if (importMode === 'zip') {
        dialogOptions = {
          title: '导入 Skill 压缩包（.zip，可多选）',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Skill 压缩包', extensions: ['zip'] }]
        }
      } else if (importMode === 'dir') {
        dialogOptions = {
          title: '导入 Skill 目录（可多选）',
          properties: ['openDirectory', 'multiSelections']
        }
      } else {
        // 旧入口（'both' / 缺省）：目录与 .zip 都可选。为避免 Windows 只显示文件夹，
        // 使用 openFile 与 openDirectory 组合，不设 filters 让两类条目都可见。
        dialogOptions = {
          title: '批量导入 Skill 包（可选择多个目录或 .zip 压缩包）',
          properties: ['openFile', 'openDirectory', 'multiSelections']
        }
      }
      const ownerWindow = deps.windowManager.getMainWindow() ?? BrowserWindow.getFocusedWindow()
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || !result.filePaths.length) {
        return { success: true, canceled: true, importedSkillIds: [] }
      }

      const skillsRoot = getSkillsDirPath(resolvedProjectId)
      await mkdir(skillsRoot, { recursive: true })

      // ── 递归收集 skill 目录 ──
      // 从任意根目录出发，沿目录树向下查找包含 SKILL.md 的目录，找到即收为一个 skill
      // 并停止向下展开（skill 目录自包含）。天然支持：根目录即 skill、skills/ 子目录、
      // 一层分组目录（group/skill/）、任意深度的嵌套结构，与磁盘扫描逻辑保持一致。
      const collectSkillDirs = async (root: string): Promise<string[]> => {
        const found: string[] = []
        if (!existsSync(root)) return found
        await walkSkillDirs(root, found)
        return found
      }

      // 深度优先遍历，收集包含 SKILL.md 的目录
      const walkSkillDirs = async (dir: string, out: string[]): Promise<void> => {
        if (existsSync(join(dir, 'SKILL.md'))) {
          out.push(dir)
          return
        }
        let entries: import('node:fs').Dirent[]
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          // 跳过隐藏目录（如 .git/.skills-extract 等），避免误入
          if (entry.name.startsWith('.')) continue
          await walkSkillDirs(join(dir, entry.name), out)
        }
      }

      // 校验 child 是否严格位于 parent 之内，防止 zip 路径穿越
      const isWithin = (parent: string, child: string): boolean => {
        const rel = relative(parent, child)
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
      }

      // 将 .zip 压缩包（含嵌套 .zip）安全解压到临时目录，返回解压后可见的 .zip 列表
      // 递归展开：zip 内若还有 .zip 也会一并解出，保证深层打包也能被识别。
      const extractZipRecursive = async (zipPath: string, tempRoot: string): Promise<string[]> => {
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(await readFile(zipPath))
        const nestedZips: string[] = []
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue
          // 规范化目标路径并阻止路径穿越（./、../、绝对路径一律拒绝）
          const cleanName = entry.name.replace(/^[./\\]+/, '').replace(/\\/g, '/')
          if (!cleanName) continue
          const safePath = join(tempRoot, cleanName)
          if (!isWithin(tempRoot, safePath)) continue
          await mkdir(join(safePath, '..'), { recursive: true })
          await writeFile(safePath, await entry.async('nodebuffer'))
          if (cleanName.toLowerCase().endsWith('.zip')) {
            nestedZips.push(safePath)
          }
        }
        return nestedZips
      }

      // 把单个 .zip 包解压到独立临时目录，返回其中所有可导入的 skill 目录
      const importFromZip = async (zipPath: string): Promise<string[]> => {
        const tempRoot = join(getWorkspaceDirPath(), '.skills-extract-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
        await mkdir(tempRoot, { recursive: true })
        pendingTempRoots.push(tempRoot)
        // 逐层解压嵌套 .zip，直到不再产生新的压缩包为止
        let pending = [zipPath]
        let guard = 0
        while (pending.length && guard < 20) {
          guard++
          const next: string[] = []
          for (const p of pending) {
            next.push(...(await extractZipRecursive(p, tempRoot)))
          }
          pending = next
        }
        return await collectSkillDirs(tempRoot)
      }

      // 从选中的目录里收集 skill 目录；若目录内还含 .zip 包，也一并解出后再收集
      const importFromDir = async (dirPath: string): Promise<string[]> => {
        const sourceDirs = await collectSkillDirs(dirPath)
        // 找出目录内所有 .zip（递归）
        const zips = await findZipsRecursive(dirPath)
        for (const zipPath of zips) {
          const extra = await importFromZip(zipPath)
          sourceDirs.push(...extra)
        }
        return sourceDirs
      }

      // 递归查找目录下所有 .zip 文件
      const findZipsRecursive = async (dir: string): Promise<string[]> => {
        const out: string[] = []
        if (!existsSync(dir)) return out
        let entries: import('node:fs').Dirent[]
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch {
          return out
        }
        for (const entry of entries) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue
            out.push(...(await findZipsRecursive(full)))
          } else if (entry.name.toLowerCase().endsWith('.zip')) {
            out.push(full)
          }
        }
        return out
      }

      const importedSkillIds: string[] = []
      const seenSkillIds = new Set<string>()
      let failedCount = 0
      for (const selectedPath of result.filePaths) {
        const lower = selectedPath.toLowerCase()
        let sourceDirs: string[] = []
        if (lower.endsWith('.zip')) {
          sourceDirs = await importFromZip(selectedPath)
        } else if (existsSync(selectedPath)) {
          sourceDirs = await importFromDir(selectedPath)
        }
        if (!sourceDirs.length) {
          failedCount++
          continue
        }
        for (const sourceDir of sourceDirs) {
          const skillId = basename(sourceDir)
          // 去重：同名 skill 只导入一次，避免重复覆盖
          if (seenSkillIds.has(skillId)) continue
          seenSkillIds.add(skillId)
          // 若指定了目标分组，则导入到 project-skills/<group>/<skill>
          const targetDir = safeGroup ? join(skillsRoot, safeGroup, skillId) : join(skillsRoot, skillId)
          await mkdir(join(targetDir, '..'), { recursive: true })
          await cp(sourceDir, targetDir, { recursive: true, force: true })
          importedSkillIds.push(skillId)
        }
      }

      if (!importedSkillIds.length) {
        return {
          success: false,
          canceled: false,
          error: '所选内容中没有识别到可导入的 SKILL.md。请选择包含 SKILL.md 的目录或 .zip 压缩包。'
        }
      }

      await refreshSkillRegistry(resolvedProjectId)
      return {
        success: true,
        canceled: false,
        importedSkillIds: importedSkillIds.sort((a, b) => a.localeCompare(b, 'zh-CN')),
        error: failedCount ? `${failedCount} 个所选内容未识别到 SKILL.md，已跳过。` : undefined
      }
    } catch (error) {
      return { success: false, canceled: false, error: error instanceof Error ? error.message : '项目技能导入失败' }
    } finally {
      // 所有 sourceDir 复制完成后，再统一删除解压产生的临时目录
      await Promise.all(
        pendingTempRoots.map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined))
      )
    }
  })

  ipcMain.handle('characterarc:project-skills-context', async (_event, projectId: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim()
      if (!resolvedProjectId) {
        return { success: true, skills: [] }
      }

      await refreshSkillRegistry(resolvedProjectId)
      return { success: true, skills: skillContextEntries(resolvedProjectId) }
    } catch {
      return { success: true, skills: [] }
    }
  })

  // ── 批量删除项目级 skills ──
  // 仅允许删除「项目导入」的 skills（project scope），内置 skills 不可删除。
  // 入参：projectId 与要删除的 skill path 列表（形如 project-skills/xxx 或 project-skills/group/xxx）。
  ipcMain.handle('characterarc:project-skills-delete', async (_event, projectId: unknown, paths: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim()
      const skillsRoot = getSkillsDirPath(resolvedProjectId || undefined)
      const targets = Array.isArray(paths) ? paths.map((p) => String(p ?? '').trim()).filter(Boolean) : []
      if (!targets.length) {
        return { success: false, error: '未选择要删除的 skills' }
      }

      const deleted: string[] = []
      for (const skillPath of targets) {
        // 只允许删除项目级（project-skills/ 前缀）路径，内置（skills/）不可删
        if (!skillPath.startsWith('project-skills/')) continue
        const rel = skillPath.slice('project-skills/'.length)
        if (!rel || rel.includes('..')) continue
        const targetDir = join(skillsRoot, rel)
        // 安全校验：必须位于项目 skills 根目录之内，且确实是 SKILL.md 目录
        if (!targetDir.startsWith(skillsRoot)) continue
        if (!existsSync(join(targetDir, 'SKILL.md'))) continue
        await rm(targetDir, { recursive: true, force: true })
        deleted.push(skillPath)
      }

      // 刷新技能注册表，反映删除结果
      if (deleted.length) {
        await refreshSkillRegistry(resolvedProjectId || undefined)
      }

      return {
        success: deleted.length > 0,
        deleted,
        error: deleted.length === targets.length
          ? undefined
          : (deleted.length ? '部分 skills 删除失败（内置或路径不合法）' : '所选 skills 均为内置或路径不合法，无法删除')
      }
    } catch (error) {
      return { success: false, deleted: [], error: error instanceof Error ? error.message : 'skills 删除失败' }
    }
  })

  // ── 批量导出 skills（内置 + 项目导入）为 zip 压缩包 ──
  // 入参：要导出的 skill path 列表（形如 skills/xxx、skills/group/xxx、project-skills/xxx …），
  // 按 SKILL.md 目录结构打包成 .zip 并弹出保存对话框。
  ipcMain.handle('characterarc:project-skills-export', async (_event, projectId: unknown, paths: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim()
      const targets = Array.isArray(paths) ? paths.map((p) => String(p ?? '').trim()).filter(Boolean) : []
      if (!targets.length) {
        return { success: false, error: '未选择要导出的 skills' }
      }

      const builtinRoot = getBuiltinSkillsDirPath()
      const projectRoot = getSkillsDirPath(resolvedProjectId || undefined)

      // 将 skill path 解析为磁盘目录，并计算 zip 内的相对目录名
      const resolveSourceDir = (skillPath: string): { abs: string; zipDir: string } | null => {
        if (skillPath.startsWith('skills/')) {
          const rel = skillPath.slice('skills/'.length)
          if (!rel || rel.includes('..')) return null
          const abs = join(builtinRoot, rel)
          return existsSync(join(abs, 'SKILL.md')) ? { abs, zipDir: basename(rel) } : null
        }
        if (skillPath.startsWith('project-skills/')) {
          const rel = skillPath.slice('project-skills/'.length)
          if (!rel || rel.includes('..')) return null
          const abs = join(projectRoot, rel)
          return existsSync(join(abs, 'SKILL.md')) ? { abs, zipDir: basename(rel) } : null
        }
        return null
      }

      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      let count = 0
      for (const skillPath of targets) {
        const resolved = resolveSourceDir(skillPath)
        if (!resolved) continue
        // 递归收集 skill 目录下所有文件（相对目录），含 references/ 等
        const collectFiles = async (dir: string, prefix: string, out: string[]): Promise<void> => {
          const entries = await readdir(dir, { withFileTypes: true })
          for (const entry of entries) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name
            const abs = join(dir, entry.name)
            if (entry.isDirectory()) {
              await collectFiles(abs, rel, out)
            } else {
              out.push(rel)
            }
          }
        }
        const files: string[] = []
        await collectFiles(resolved.abs, '', files)
        for (const file of files.sort()) {
          // 统一复制为独立的 Uint8Array 再写入 zip。
          // 注意：不能用 new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) 做视图引用，
          // 因为小文件 Buffer 底层可能来自 Node 内部共享内存池，JSZip 对其做 structured clone
          // 时仍会报 “An object could not be cloned”。这里用 new Uint8Array(raw) 拷贝成全新
          // ArrayBuffer，彻底避免跨进程序列化不兼容。
          const raw = await readFile(join(resolved.abs, file))
          zip.file(`${resolved.zipDir}/${file}`, new Uint8Array(raw))
        }
        count++
      }

      if (!count) {
        return { success: false, error: '未找到可导出的 skill 目录' }
      }

      const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
      const ownerWindow = deps.windowManager.getMainWindow() ?? BrowserWindow.getFocusedWindow()
      const saveResult = ownerWindow
        ? await dialog.showSaveDialog(ownerWindow, {
            title: '导出 Skills',
            defaultPath: `skills-${Date.now()}.zip`,
            filters: [{ name: 'Skill 压缩包', extensions: ['zip'] }]
          })
        : { canceled: true, filePath: '' }
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: true, canceled: true, exportedCount: count }
      }
      await writeFile(saveResult.filePath, buffer)
      return { success: true, exportedCount: count, filePath: saveResult.filePath }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error ?? '')
      // 过滤掉 Electron 结构化克隆的干扰报错，给出更友好的提示
      return {
        success: false,
        error: msg && /could not be cloned|structured.?clone/i.test(msg) ? 'skills 导出失败：存在无法序列化的文件内容，已转换为安全格式后重试' : (msg || 'skills 导出失败')
      }
    }
  })

  // ── 从 CC Switch 导入 AI 接口配置 ──
  // CC Switch（https://github.com/farion1231/cc-switch）的配置用于管理多供应商接入。
  // 新版 CC Switch 将供应商配置保存在 SQLite 数据库 ~/.cc-switch/cc-switch.db（providers 表），
  // 旧版则以 JSON 保存（config.json）。两者都可能在常见路径下，因此这里按优先级依次探测：
  // 优先读取 cc-switch.db，找不到时回退到 config.json；仍找不到则允许用户手动选择文件。
  // 注意：skills 的导入已改由「内置 Skills 与项目扩展」页面负责，这里只导入 AI 接口配置。
  ipcMain.handle('characterarc:cc-switch-import', async () => {
    const home = homedir()
    // 依次探测 CC Switch 配置文件的常见位置
    const candidatePaths = [
      join(home, '.cc-switch', 'cc-switch.db'),
      join(home, '.cc-switch', 'config.json'),
      join(home, '.cc-switch', 'cc-switch', 'config.json'),
      join(home, '.cc-switch', 'config', 'config.json'),
      join(home, '.config', 'cc-switch', 'config.json'),
      join(home, 'AppData', 'Roaming', 'cc-switch', 'config.json')
    ]
    let ccSwitchConfigPath = candidatePaths.find((p) => existsSync(p)) ?? ''

    // 若常见位置都找不到，弹出文件选择框让用户手动指定 cc-switch.db / config.json
    if (!ccSwitchConfigPath) {
      const ownerWindow = deps.windowManager.getMainWindow() ?? BrowserWindow.getFocusedWindow()
      const pick = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, {
            title: '请选择 CC Switch 的 cc-switch.db / config.json 配置文件',
            properties: ['openFile'],
            filters: [{ name: '配置文件', extensions: ['db', 'json'] }]
          })
        : await dialog.showOpenDialog({
            title: '请选择 CC Switch 的 cc-switch.db / config.json 配置文件',
            properties: ['openFile'],
            filters: [{ name: '配置文件', extensions: ['db', 'json'] }]
          })
      if (pick.canceled || !pick.filePaths[0]) {
        return { success: true, aiProfiles: [], importedSkills: [], configPath: '', configError: '已取消选择配置文件' }
      }
      ccSwitchConfigPath = pick.filePaths[0]
    }

    // 1. 解析 AI 接口配置
    let aiProfiles: Array<{
      name: string
      type: string
      baseUrl: string
      apiKey: string
      model: string
      isCurrent: boolean
    }> = []
    let configError = ''

    // 字段名统一小写并去掉 -/_/空格 后再匹配，兼容 baseURL、APIKey、base_url 等大小写变体。
    const normalizeKey = (k: string): string => String(k).toLowerCase().replace(/[\s_-]/g, '')
    const pickField = (e: Record<string, unknown>, names: string[]): unknown => {
      for (const n of names) {
        const key = normalizeKey(n)
        for (const k of Object.keys(e)) {
          if (normalizeKey(k) === key && e[k] != null && e[k] !== '') return e[k]
        }
      }
      return undefined
    }

    // 从一条供应商配置对象中提取通用字段（兼容顶层 / env 子对象嵌套，兼容各类环境变量命名）。
    const extractProfileFromEntry = (e: Record<string, unknown>, group: string): {
      name: string
      type: string
      baseUrl: string
      apiKey: string
      model: string
      isCurrent: boolean
    } => {
      // 将嵌套的 env / settings / auth 等子对象拍平到同一层，便于用通用 key 匹配到
      // ANTHROPIC_BASE_URL、OPENAI_API_KEY、GEMINI_API_KEY 等各类环境变量命名。
      const flat: Record<string, unknown> = { ...e }
      for (const key of Object.keys(e)) {
        const val = e[key]
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const obj = val as Record<string, unknown>
          // 只合并像 env / environment / settings / config / auth 这类“容器”子对象，避免误合并供应商分组
          const nk = normalizeKey(key)
          if (['env', 'environment', 'settings', 'config', 'auth'].includes(nk)) {
            for (const subKey of Object.keys(obj)) {
              flat[subKey] = obj[subKey]
            }
          }
        }
      }
      const baseUrl = String(
        pickField(flat, [
          'baseUrl', 'base_url', 'baseURL', 'endpoint', 'host', 'api_base', 'apiBase', 'url',
          'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_API_BASE_URL',
          'GOOGLE_GEMINI_BASE_URL', 'GEMINI_BASE_URL', 'BASE_URL'
        ]) ?? ''
      ).trim()
      const apiKey = String(
        pickField(flat, [
          'apiKey', 'api_key', 'APIKey', 'token', 'secret', 'api_keys',
          'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
          'GEMINI_API_KEY', 'GOOGLE_API_KEY'
        ]) ?? ''
      ).trim()
      const name = String(pickField(e, ['name', 'label', 'title', 'remark']) ?? group ?? '').trim() || group || 'CC Switch'
      const type = String(pickField(e, ['provider', 'type', 'vendor', 'platform']) ?? group ?? '').trim().toLowerCase()
      const model = String(
        pickField(flat, ['model', 'modelId', 'defaultModel', 'default_model', 'modelName', 'ANTHROPIC_MODEL', 'OPENAI_MODEL']) ?? ''
      ).trim()
      const isCurrent = Boolean(pickField(e, ['isCurrent', 'is_active', 'iscurrent', 'active']) ?? false)
      return { name, type, baseUrl, apiKey, model, isCurrent }
    }

    if (ccSwitchConfigPath) {
      const isDbFile = ccSwitchConfigPath.toLowerCase().endsWith('.db')
      try {
        if (isDbFile) {
          // ── 从 SQLite 数据库（cc-switch.db）解析 ──
          // CC Switch 新版将供应商配置存入 SQLite 的 providers 表：
          //   id, app_type(claude/codex/gemini/...), name, settings_config(JSON),
          //   is_current(0/1), category 等。settings_config 内通常为 { "env": {...} }。
          const { DatabaseSync } = await import('node:sqlite')
          const db = new DatabaseSync(ccSwitchConfigPath, { readOnly: true })
          try {
            const stmt = db.prepare(
              'SELECT id, app_type, name, settings_config, is_current FROM providers'
            )
            const rows = stmt.all() as Array<{
              id?: string
              app_type?: string
              name?: string
              settings_config?: unknown
              is_current?: number | boolean
            }>
            const seen = new Set<string>()
            for (const row of rows) {
              let config: Record<string, unknown> = {}
              if (typeof row.settings_config === 'string') {
                try {
                  const parsed = JSON.parse(row.settings_config)
                  if (parsed && typeof parsed === 'object') config = parsed as Record<string, unknown>
                } catch {
                  // 单条 settings_config 解析失败时跳过该条
                  continue
                }
              } else if (row.settings_config && typeof row.settings_config === 'object') {
                config = row.settings_config as Record<string, unknown>
              }
              const appType = String(row.app_type ?? '').trim()
              // 组名取 app_type，同时作为 type 兜底（如 claude / codex / gemini）
              const entry: Record<string, unknown> = {
                ...config,
                name: row.name ?? '',
                type: appType || (config['type'] as string) || (config['provider'] as string) || '',
                isCurrent: Boolean(row.is_current) || config['isCurrent'] === true
              }
              const profile = extractProfileFromEntry(entry, appType || 'CC Switch')
              const dedupeKey = [profile.baseUrl, profile.apiKey, profile.name, profile.type].join('|').toLowerCase()
              if (!dedupeKey || seen.has(dedupeKey)) continue
              seen.add(dedupeKey)
              aiProfiles.push(profile)
            }
          } finally {
            db.close()
          }
        } else {
          // ── 从 config.json 解析 ──
          const raw = await readFile(ccSwitchConfigPath, 'utf-8')
          const parsed = JSON.parse(raw)
          // CC Switch 的 config.json 存在多种版本结构，需兼容解析：
          //   ① { "Claude": [...], "Codex": [...] }   —— 旧版按分组数组
          //   ② { "current": {...}, "providers": { "Claude": [...], ... } }  —— 新版 providers 对象
          //   ③ { "current": "...", "providers": [ {...} ] }                  —— 新版 providers 数组
          //   ④ [ {...}, {...} ]                        —— 直接为数组
          //   ⑤ { "provider": { "Claude": [...] } }   —— provider 作为分组容器
          //   ⑥ { "name":..., "baseUrl":... }         —— 顶层直接是单条配置
          //   ⑦ { "current": { "name":..., "baseUrl":... } }  —— current 直接为配置对象
          // 统一展开为「供应商条目数组」后逐条映射。
          // 判断一个对象是否像「配置条目」（包含地址、凭据、供应商等特征字段）
          const isEntryLike = (o: unknown): boolean => {
            if (!o || typeof o !== 'object' || Array.isArray(o)) return false
            const kset = Object.keys(o as Record<string, unknown>).map(normalizeKey)
            const hasEndpoint = ['baseurl', 'apiurl', 'apibase', 'apibaseurl', 'endpoint', 'host', 'base'].some((k) => kset.includes(k))
            const hasCred = ['apikey', 'token', 'secret', 'apikeys'].some((k) => kset.includes(k))
            const hasProvider = ['provider', 'type', 'vendor', 'platform', 'service'].some((k) => kset.includes(k))
            const hasName = kset.includes('name')
            return hasEndpoint || (hasCred && (hasProvider || hasName))
          }

          const collected: Array<{ entry: Record<string, unknown>; group: string }> = []
          const seen = new Set<string>()
          const pushEntry = (entry: unknown, group: string): void => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
            const e = entry as Record<string, unknown>
            const baseUrl = String(pickField(e, ['baseUrl', 'base_url', 'baseURL', 'endpoint', 'host', 'api_base', 'apiBase', 'url']) ?? '')
            const apiKey = String(pickField(e, ['apiKey', 'api_key', 'APIKey', 'token', 'secret']) ?? '')
            const name = String(pickField(e, ['name', 'label', 'title', 'remark']) ?? '')
            const type = String(pickField(e, ['provider', 'type', 'vendor', 'platform']) ?? '')
            const dedupeKey = [baseUrl, apiKey, name, type].join('|').toLowerCase()
            if (!dedupeKey || seen.has(dedupeKey)) return
            seen.add(dedupeKey)
            collected.push({ entry: e, group })
          }

          const collectEntries = (node: unknown, group: string): void => {
            if (!node || typeof node !== 'object') return
            if (Array.isArray(node)) {
              for (const item of node) {
                if (!item || typeof item !== 'object') continue
                if (Array.isArray(item)) {
                  collectEntries(item, group)
                  continue
                }
                if (isEntryLike(item)) pushEntry(item, group)
                else collectEntries(item, group)
              }
              return
            }
            const obj = node as Record<string, unknown>
            // 当前对象本身可能就是一条配置（顶层 / current / 分组值）
            if (isEntryLike(obj)) {
              pushEntry(obj, group)
              return
            }
            // providers 字段（对象或数组）
            const providerHolder = obj['providers'] ?? obj['providerList'] ?? obj['Provider']
            if (providerHolder !== undefined && providerHolder !== null) {
              collectEntries(providerHolder, group)
            }
            // current 字段：可能是指向供应商的 id/名称字符串，也可能是直接内嵌的配置对象
            const current = obj['current']
            if (current && typeof current === 'object' && !Array.isArray(current)) {
              if (isEntryLike(current)) pushEntry(current, group)
              else collectEntries(current, group)
            }
            // 按「分组名 -> 数组 / 对象」的旧版结构展开
            for (const key of Object.keys(obj)) {
              const nk = normalizeKey(key)
              if (['providers', 'providerlist', 'current', 'version', 'settings', 'isactive'].includes(nk)) continue
              const value = obj[key]
              if (Array.isArray(value)) {
                for (const item of value) {
                  if (!item || typeof item !== 'object') continue
                  if (Array.isArray(item)) {
                    collectEntries(item, key)
                    continue
                  }
                  if (isEntryLike(item)) pushEntry(item, key)
                  else collectEntries(item, key)
                }
              } else if (value && typeof value === 'object') {
                // 某些版本嵌套了一层分组（如 providers 下的 Claude / provider 下的分组）
                collectEntries(value, key)
              }
            }
          }

          collectEntries(parsed, '')
          for (const { entry, group } of collected) {
            aiProfiles.push(extractProfileFromEntry(entry, group))
          }
        }
      } catch (error) {
        configError = error instanceof Error ? error.message : 'CC Switch 配置文件解析失败'
      }
      // 解析成功但未识别到任何配置条目时，给出诊断提示
      if (!configError && aiProfiles.length === 0) {
        configError = isDbFile
          ? '已读取数据库，但未能从 providers 表中识别到 AI 接口配置。请确认所选文件为 CC Switch 的 cc-switch.db（SQLite 数据库）。'
          : '已读取配置文件，但未能从中识别到 AI 接口配置（可导入 name/baseUrl/apiKey/model 等字段）。若为 CC Switch 配置文件，请确认其为 config.json 导出的标准格式。'
      }
    } else {
      configError = `未找到 CC Switch 配置文件：${ccSwitchConfigPath}`
    }

    return {
      success: true,
      aiProfiles: aiProfiles
        .map((profile, index) => ({ ...profile, index }))
        .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.index - b.index)
        .map(({ index, ...profile }) => profile),
      configPath: ccSwitchConfigPath,
      configError
    }
  })

  // ── 从 CC Switch 导入 Skills（内置 Skills 与项目扩展页面） ──
  // CC Switch 及其底层的 Claude Code / Codex 会把 skills 存放到以下常见目录，
  // 这里递归收集其中包含 SKILL.md 的目录并拷贝到当前项目的 skills 目录（可选归入指定分组）。
  ipcMain.handle('characterarc:cc-switch-import-skills', async (_event, projectId: unknown, targetGroup: unknown) => {
    try {
      const resolvedProjectId = String(projectId ?? '').trim() || undefined
      const safeGroup = String(targetGroup ?? '')
        .split(/[\\/]+/)
        .map((seg) => seg.trim())
        .filter((seg) => seg && seg !== '.' && seg !== '..')
        .map((seg) => seg.replace(/[^A-Za-z0-9\u4e00-\u9fa5-]/g, ''))
        .filter(Boolean)
        .join('/')

      const home = homedir()
      const skillSourceRoots = [
        join(home, '.claude', 'skills'),
        join(home, '.claude', 'custom-skills'),
        join(home, '.cc-switch', 'skills'),
        join(home, '.cc-switch', 'claude', 'skills')
      ]

      const skillsRoot = getSkillsDirPath(resolvedProjectId || undefined)
      await mkdir(skillsRoot, { recursive: true })

      const importedSkillIds: string[] = []
      const seenSkillIds = new Set<string>()
      for (const sourceRoot of skillSourceRoots) {
        if (!existsSync(sourceRoot)) continue
        const entries = await readdir(sourceRoot, { withFileTypes: true }).catch(() => [] as Array<import('node:fs').Dirent>)
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const dirPath = join(sourceRoot, entry.name)
          // 兼容一层分组目录（group/skill/）
          let skillDirs: string[] = []
          if (existsSync(join(dirPath, 'SKILL.md'))) {
            skillDirs = [dirPath]
          } else {
            const subEntries = await readdir(dirPath, { withFileTypes: true }).catch(() => [] as Array<import('node:fs').Dirent>)
            for (const subEntry of subEntries) {
              if (subEntry.isDirectory() && existsSync(join(dirPath, subEntry.name, 'SKILL.md'))) {
                skillDirs.push(join(dirPath, subEntry.name))
              }
            }
          }
          for (const skillDir of skillDirs) {
            const skillId = basename(skillDir)
            if (seenSkillIds.has(skillId)) continue
            seenSkillIds.add(skillId)
            const targetDir = safeGroup
              ? join(skillsRoot, safeGroup, skillId)
              : join(skillsRoot, skillId)
            await mkdir(join(targetDir, '..'), { recursive: true })
            await cp(skillDir, targetDir, { recursive: true, force: true })
            importedSkillIds.push(skillId)
          }
        }
      }

      // 刷新技能注册表
      await refreshSkillRegistry(resolvedProjectId)

      return { success: true, importedSkillIds }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '从 CC Switch 导入 skills 失败' }
    }
  })

  // ── 提交章节编辑提案 ──
  ipcMain.handle('characterarc:commit-chapter-edit', async (_event, payload: unknown) => {
    try {
      const { projectId, chapterId, oldContent, newContent } = payload as {
        projectId: string
        chapterId: string
        oldContent: string
        newContent: string
      }
      const { commitChapterEdit } = await import('./ai/agent/tools/chapter-data-access')
      const result = await commitChapterEdit(projectId, chapterId, oldContent, newContent)
      return { success: true, versionId: result.versionId }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '写回失败' }
    }
  })

  // ── 检查更新（GitHub Release API） ──
  ipcMain.handle('characterarc:check-update', async () => {
    try {
      const { app } = await import('electron')
      const currentVersion = app.getVersion()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      let response: Response
      try {
        response = await fetch('https://api.github.com/repos/uu201/character-arc/releases/latest', {
          headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'CharacterArc-Desktop' },
          signal: controller.signal
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) {
        return { success: false, error: `GitHub API 请求失败 (${response.status})` }
      }
      const release = await response.json() as {
        tag_name?: string
        name?: string
        body?: string
        html_url?: string
        published_at?: string
        assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
      }
      const latestTag = (release.tag_name ?? '').replace(/^v\.?/, '')
      const hasUpdate = latestTag && latestTag !== currentVersion && compareVersions(latestTag, currentVersion) > 0
      return {
        success: true,
        result: {
          hasUpdate,
          currentVersion,
          latestVersion: latestTag,
          releaseTitle: release.name ?? '',
          releaseNotes: release.body ?? '',
          releaseUrl: release.html_url ?? '',
          publishedAt: release.published_at ?? '',
          assets: (release.assets ?? []).map(a => ({
            name: a.name ?? '',
            downloadUrl: a.browser_download_url ?? '',
            size: a.size ?? 0
          }))
        }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '检查更新失败' }
    }
  })

  ipcMain.handle('characterarc:fetch-announcements', async () => {
    return fetchWithCache({
      repo: 'uu201/character-arc',
      branch: 'main',
      filePath: 'announcements.json',
      cacheDir: 'announcements-cache',
      ttlMs: 0,
      timeoutMs: 8000,
      preferActiveMirror: false,
      allowStaleFallback: false,
    })
  })

  ipcMain.handle('characterarc:fetch-tutorial', async () => {
    return fetchWithCache({
      repo: 'uu201/character-arc',
      branch: 'main',
      filePath: 'tutorial.json',
      cacheDir: 'tutorial-cache',
      ttlMs: 6 * 60 * 60 * 1000,
      timeoutMs: 8000,
      preferActiveMirror: true,
      allowStaleFallback: true
    })
  })

  ipcMain.handle('characterarc:open-external-url', (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url)
    }
  })

  // ── 番茄风向标：抓取榜单数据（主进程缓存，避免每次请求） ──
  ipcMain.handle('characterarc:fanqie-trends-fetch', async (_event, payload: { path?: string; force?: boolean }) => {
    const remotePath = typeof payload?.path === 'string' ? payload.path : ''
    const force = payload?.force === true
    return fetchFanqieTrends(remotePath, force)
  })

  // ── AI 助手会话持久化 ──

  ipcMain.handle('characterarc:session-list', async (_event, projectId: string) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const rows = db.prepare(
        'SELECT id, title, created_at, updated_at FROM assistant_sessions WHERE project_id = ? ORDER BY updated_at DESC'
      ).all(projectId) as Array<{ id: string; title: string; created_at: string; updated_at: string }>
      return { success: true, result: rows }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取会话列表失败' }
    }
  })

  ipcMain.handle('characterarc:session-load', async (_event, sessionId: string) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const row = db.prepare(
        'SELECT id, project_id, title, messages_json, created_at, updated_at FROM assistant_sessions WHERE id = ?'
      ).get(sessionId) as { id: string; project_id: string; title: string; messages_json: string; created_at: string; updated_at: string } | undefined
      if (!row) return { success: false, error: '会话不存在' }
      const parsed = JSON.parse(row.messages_json)
      const messages = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.messages) ? parsed.messages : []
      return { success: true, result: { ...row, ...(!Array.isArray(parsed) && parsed && typeof parsed === 'object' ? parsed : {}), messages } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '加载会话失败' }
    }
  })

  ipcMain.handle('characterarc:session-save', async (_event, payload: {
    id: string
    projectId: string
    title: string
    messages: unknown[]
    proposal?: unknown | null
    lastProposalPrompt?: string
    lastAssistantReply?: string
  }) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const now = new Date().toISOString()
      const messagesJson = JSON.stringify({
        messages: payload.messages,
        proposal: payload.proposal ?? null,
        lastProposalPrompt: payload.lastProposalPrompt ?? '',
        lastAssistantReply: payload.lastAssistantReply ?? ''
      })
      db.prepare(
        `INSERT INTO assistant_sessions (id, project_id, title, messages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, messages_json = excluded.messages_json, updated_at = excluded.updated_at`
      ).run(payload.id, payload.projectId, payload.title, messagesJson, now, now)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '保存会话失败' }
    }
  })

  ipcMain.handle('characterarc:session-delete', async (_event, sessionId: string) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      db.prepare('DELETE FROM assistant_sessions WHERE id = ?').run(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '删除会话失败' }
    }
  })
}
