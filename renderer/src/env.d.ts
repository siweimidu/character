/// <reference types="vite/client" />

declare global {
  type CharacterArcExportRequest = {
    data: unknown
    title?: string
    defaultPath?: string
  }

  type CharacterArcImportMeta = {
    schemaVersion: string
    moduleType: import('@/types/app').ImportExportModuleType
    compatibilityNote: string
    isLegacy: boolean
  }

  type CharacterArcProjectArchiveModule =
    | 'project'
    | 'worldview'
    | 'characters'
    | 'relations'
    | 'inspiration'
    | 'outline'
    | 'plotThreads'
    | 'chapters'
    | 'chapterVersions'
    | 'workflowDocuments'
    | 'knowledgeDocuments'
    | 'referenceWorks'
    | 'aiRuns'
    | 'assistantSessions'
    | 'referenceNovelAssets'

  type CharacterArcProjectArchiveImportMode = 'new-project' | 'overwrite-project'

  type CharacterArcProjectArchivePreview = {
    filePath: string
    archiveVersion: string
    appVersion: string
    projectId: string
    projectTitle: string
    exportedAt: string
    modules: Record<string, { count: number }>
  }

  type CharacterArcAiStreamEvent =
    | {
        streamId: string
        type: 'chunk'
        delta: string
        /** 当前已生成的总字符数（用于显示字数进度） */
        charCount?: number
      }
    | {
        streamId: string
        type: 'done' | 'canceled'
        content?: string
        result?: unknown
      }
    | {
        streamId: string
        type: 'error'
        error: string
      }
    | {
        streamId: string
        type: 'tool_use_start'
        toolUseId: string
        toolName: string
        args: Record<string, unknown>
      }
    | {
        streamId: string
        type: 'reasoning'
        delta: string
      }
    | {
        streamId: string
        type: 'tool_result'
        toolUseId: string
        toolName: string
        content: string
        isError?: boolean
        durationMs: number
      }
    | {
        streamId: string
        type: 'agent_status'
        message: string
        iteration: number
        maxIterations: number
      }
    | {
        streamId: string
        type: 'edit_applied'
        chapterId: string
        editType: string
        preview: string
        versionId: string
      }
    | {
        streamId: string
        type: 'edit_proposed'
        chapterId: string
        proposalId: string
        editType: string
        preview: string
        oldContent: string
        newContent: string
      }

  type CharacterArcReferenceImportPayload = {
    settings: import('@/types/app').AppSettings
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

  type CharacterArcReferenceImportResult = {
    referenceWork: import('@/types/app').ReferenceWorkItem
    suggestedWritingStylePrompt: string
    knowledgeDocuments: import('@/types/app').KnowledgeDocument[]
  }

  type CharacterArcReferenceImportProgressPayload = {
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

  type CharacterArcProjectArchiveImportProgressPayload = {
    phase: 'preparing' | 'reading' | 'mapping' | 'merging' | 'writing' | 'assistant' | 'assets' | 'syncing' | 'done' | 'error'
    message: string
    percent: number
  }

  type CharacterArcAiRunEventPayload = {
    projectId: string
    meta: Omit<import('@/types/app').AiRunRecord, 'projectId'>
  }

  type CharacterArcChapterStateWarningsPayload = {
    projectId: string
    chapterId: string
    chapterIndex: number
    generatedAt: string
    violations: Array<{
      type: 'location_mismatch' | 'item_not_owned' | 'timeline_break' | 'rule_violation' | 'state_conflict'
      severity: 'error' | 'warning'
      message: string
    }>
  }

  type CharacterArcChapterPostGenerationIssuesPayload = {
    projectId: string
    chapterId: string
    chapterIndex: number
    generatedAt: string
    issues: Array<{
      stage: 'state-delta' | 'vector-index' | 'pipeline'
      severity: 'warning' | 'error'
      message: string
      detail?: string
    }>
  }

  type CharacterArcChapterPostGenerationTaskPayload = {
    taskKey: string
    runId: string
    projectId: string
    chapterId: string
    chapterIndex: number
    chapterTitle: string
    stage: 'running' | 'done' | 'error' | 'canceled'
    startedAt: number
    finishedAt?: number
    error?: string
  }

  type CharacterArcBackfillStateProgressPayload = {
    taskId: string
    projectId: string
    status: 'running' | 'pausing' | 'paused' | 'completed' | 'failed'
    current: number
    total: number
    chapterTitle: string
    phase: 'starting' | 'extracting' | 'applying' | 'skipped' | 'failed' | 'done'
    message?: string
    startedAt: string
    updatedAt: string
    result?: CharacterArcBackfillStateResult
    error?: string
  }

  type CharacterArcBackfillStateResult = {
    totalChapters: number
    processedChapters: number
    skipped: number
    failed: number
    errors: Array<{ chapterTitle: string; message: string }>
  }

  type CharacterArcBackfillChapterStatus = {
    chapterId: string
    chapterTitle: string
    chapterIndex: number
    chapterNumber: number
    contentHash: string
    status: 'running' | 'success' | 'skipped' | 'failed' | 'unscanned' | 'stale'
    attemptCount: number
    error: string
    updatedAt: string
  }

  interface Window {
    characterArc: {
      platform: string
      version: string
      loadWorkspace: () => Promise<{
        success: boolean
        payload?: unknown
        error?: string
      }>
      saveWorkspace: (payload: unknown) => Promise<{
        success: boolean
        error?: string
      }>
      saveWorkspaceSync: (payload: unknown) => {
        success: boolean
        error?: string
      }
      saveAppSettings: (
        payload: import('@shared/ipc-types').SaveAppSettingsRequest
      ) => Promise<import('@shared/ipc-types').IpcResult>
      pickCoverImage: () => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        dataUrl?: string
      }>
      pickContinuationNovel: () => Promise<{
        success: boolean
        canceled: boolean
        preview?: import('@shared/continuation-import').ContinuationNovelFilePreview & { sourceHash: string }
        error?: string
      }>
      pickAssistantTextFile: () => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        name?: string
        content?: string
        error?: string
      }>
      generateAi: (payload: unknown) => Promise<{
        success: boolean
        result?: unknown
        error?: string
      }>
      cancelAiTask: (clientTaskId: string) => Promise<{
        success: boolean
        error?: string
      }>
      startAiStream: (payload: unknown) => Promise<{
        success: boolean
        result?: {
          streamId: string
        }
        error?: string
      }>
      stopAiStream: (streamId: string) => Promise<{
        success: boolean
        error?: string
      }>
      startAiAgentStream: (payload: unknown) => Promise<{
        success: boolean
        result?: {
          streamId: string
        }
        error?: string
      }>
      readChapterFromDb: (projectId: string, chapterId: string) => Promise<{
        success: boolean
        result?: { id: string; title: string; summary: string; status: string; wordTarget: string; content: string }
        error?: string
      }>
      readChapterVersionFromDb: (projectId: string, versionId: string) => Promise<{
        success: boolean
        result?: { id: string; chapterId: string; title: string; summary: string; status: string; wordTarget: string; content: string; createdAt: string }
        error?: string
      }>
      commitChapterEdit: (projectId: string, chapterId: string, oldContent: string, newContent: string) => Promise<{
        success: boolean
        versionId?: string
        error?: string
      }>
      onAiStreamEvent: (callback: (payload: CharacterArcAiStreamEvent) => void) => () => void
      onAiRunEvent: (callback: (payload: CharacterArcAiRunEventPayload) => void) => () => void
      onChapterStateWarnings: (callback: (payload: CharacterArcChapterStateWarningsPayload) => void) => () => void
      onChapterPostGenerationIssues: (callback: (payload: CharacterArcChapterPostGenerationIssuesPayload) => void) => () => void
      onChapterPostGenerationTask: (callback: (payload: CharacterArcChapterPostGenerationTaskPayload) => void) => () => void
      spiralBootstrap: (payload: unknown) => Promise<{
        success: boolean
        result?: import('@/features/wizard/projectSeed').SpiralBootstrapResult
        error?: string
      }>
      cancelSpiralBootstrap: () => Promise<{
        success: boolean
        error?: string
      }>
      onSpiralProgress: (callback: (payload: { phase: 'seed' | 'expand' | 'validate'; status: 'running' | 'done' | 'error'; error?: string }) => void) => () => void
      backfillProjectState: (payload: {
        settings: import('@/types/app').AppSettings
        projectId: string
        selection?: {
          mode?: 'pending' | 'failed' | 'custom'
          chapterIds?: string[]
        }
      }) => Promise<{
        success: boolean
        result?: CharacterArcBackfillStateProgressPayload
        error?: string
      }>
      readBackfillStateStatus: (projectId: string) => Promise<{
        success: boolean
        result?: CharacterArcBackfillChapterStatus[]
        error?: string
      }>
      readBackfillTaskStatus: (projectId: string) => Promise<{
        success: boolean
        result?: CharacterArcBackfillStateProgressPayload | null
        error?: string
      }>
      pauseBackfillProjectState: (projectId: string) => Promise<{
        success: boolean
        result?: CharacterArcBackfillStateProgressPayload
        error?: string
      }>
      resumeBackfillProjectState: (projectId: string) => Promise<{
        success: boolean
        result?: CharacterArcBackfillStateProgressPayload
        error?: string
      }>
      onBackfillStateProgress: (callback: (payload: CharacterArcBackfillStateProgressPayload) => void) => () => void
      readStoryState: (projectId: string) => Promise<{
        success: boolean
        result?: {
          characterStates: Array<{
            characterId: string
            chapterIndex: number
            location: string
            physicalState: string
            mentalState: string
            arcStage: string
            powerLevel: string
            knowledge: string[]
            inventory: string[]
            goals: string[]
          }>
          activeForeshadowing: Array<{
            foreshadowingId: string
            type: string
            description: string
            status: 'active' | 'advanced' | 'resolved' | 'abandoned'
            plantedChapter: number
            plantedMethod: string
            payoffChapter: number | null
            resolvedChapter: number | null
            clues: Array<{ chapter: number; clue: string; method?: string }>
            connections: string[]
          }>
          relationships: Array<{
            relationshipId: string
            participantA: string
            participantB: string
            currentStatus: string
            tensionPoints: string[]
            trajectory: string
            lastInteractionChapter: number | null
          }>
          recentTimeline: Array<{
            chapterIndex: number
            storyDate: string
            events: string[]
            worldStateChanges: string[]
          }>
          worldRules: Array<{
            ruleId: string
            ruleContent: string
            establishedChapter: number
            exceptions: string[]
            mustComply: boolean
          }>
          activeClocks: Array<{
            clockId: string
            eventDescription: string
            deadlineChapter: number | null
            status: 'active' | 'expired' | 'resolved'
            urgency: string
          }>
        }
        error?: string
      }>
      deleteStoryState: (payload: { projectId: string; block: string }) => Promise<{
        success: boolean
        result?: {
          block: string
          count: number
          snapshot: Array<Record<string, unknown>>
        }
        error?: string
      }>
      restoreStoryState: (payload: { projectId: string; block: string; rows: Array<Record<string, unknown>> }) => Promise<{
        success: boolean
        result?: {
          block: string
          count: number
        }
        error?: string
      }>
      testAiConnection: (settings: unknown) => Promise<{
        success: boolean
        result?: unknown
        error?: string
      }>
      benchmarkModel: (settings: unknown) => Promise<{
        success: boolean
        result?: {
          latencyMs: number
          tokensPerSec: number
          completionTokens: number
          promptTokens: number
        }
        error?: string
      }>
      testProxyConnection: (proxyUrl: string) => Promise<{
        success: boolean
        result?: { ip: string }
        error?: string
      }>
      fetchModels: (settings: unknown) => Promise<{
        success: boolean
        result?: Array<{ id: string; ownedBy: string | null }>
        error?: string
      }>
      fetchImageModels: (settings: unknown) => Promise<{
        success: boolean
        result?: Array<{ id: string; ownedBy: string | null }>
        error?: string
      }>
      generateImage: (payload: { settings: import('@/types/app').AppSettings; prompt: string; projectId?: string }) => Promise<{
        success: boolean
        result?: {
          dataUrl: string
          revisedPrompt?: string
          usage?: import('@/types/app').AiRunUsage
        }
        error?: string
      }>
      recognizeImage: (payload: { settings: import('@/types/app').AppSettings; imageDataUrl: string }) => Promise<{
        success: boolean
        result?: {
          name: string
          role: string
          appearance: string
          personality: string
          background: string
          tags: string[]
          description: string
        }
        error?: string
      }>
      fetchVisionModels: (settings: unknown) => Promise<{
        success: boolean
        result?: Array<{ id: string; ownedBy: string | null }>
        error?: string
      }>
      testVisionConnection: (settings: unknown) => Promise<{
        success: boolean
        result?: { provider?: string; model?: string; protocol?: string }
        error?: string
      }>
      benchmarkVisionModel: (settings: unknown) => Promise<{
        success: boolean
        result?: unknown
        error?: string
      }>
      saveCoverImage: (payload: { dataUrl: string; defaultFileName?: string }) => Promise<{
        success: boolean
        canceled?: boolean
        filePath?: string
        error?: string
      }>
      exportJson: (payload: CharacterArcExportRequest | unknown) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
      }>
      exportProjectArchive: (payload: { projectId: string; projectTitle?: string }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      inspectProjectArchive: () => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        preview?: CharacterArcProjectArchivePreview
        files?: Array<{ filePath: string; preview: CharacterArcProjectArchivePreview }>
        singleFile?: { filePath: string; preview: CharacterArcProjectArchivePreview }
        error?: string
      }>
      importProjectArchive: (payload: {
        filePath?: string
        filePaths?: string[]
        mode: CharacterArcProjectArchiveImportMode
        targetProjectId?: string
        modules?: CharacterArcProjectArchiveModule[]
      }) => Promise<{
        success: boolean
        canceled: boolean
        selectedProjectId?: string
        error?: string
      }>
      exportText: (payload: CharacterArcExportRequest | unknown) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
      }>
      exportMarkdown: (payload: CharacterArcExportRequest | unknown) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
      }>
      exportExcel: (payload: CharacterArcExportRequest | unknown) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
      }>
      exportProvidersExcel: (payload: { data?: Array<{ provider?: string; homepage?: string }>; title?: string; defaultPath?: string } | unknown) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      exportChapterTxt: (payload: { title?: string; content?: string; defaultFileName?: string }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      exportChapterDocx: (payload: { title?: string; content?: string; defaultFileName?: string }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      setZoomFactor: (factor: number) => Promise<{
        success: boolean
        factor?: number
        error?: string
      }>
      getZoomFactor: () => Promise<{
        success: boolean
        factor?: number
        error?: string
      }>
      setTitleBarOverlay: (options: { color: string; symbolColor: string }) => Promise<void>
      exportPlotThreads: (payload: {
        data: unknown
        format?: 'md' | 'txt' | 'json'
        title?: string
        defaultPath?: string
      }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      importPlotThreads: () => Promise<{
        success: boolean
        canceled: boolean
        items?: Array<Record<string, unknown>>
        errors?: string[]
        error?: string
      }>
      importJson: () => Promise<{
        success: boolean
        canceled: boolean
        payload?: unknown
        meta?: CharacterArcImportMeta
        error?: string
      }>
      worldviewImport: () => Promise<{
        success: boolean
        canceled: boolean
        entries?: Array<{ type: string; title: string; content: string; tags: string[] }>
        fileCount?: number
        warning?: string
        error?: string
      }>
      worldviewExport: (payload: { format: 'txt' | 'md' | 'json' | 'excel'; entries?: Array<{ type: string; title: string; content: string; tags?: string[] }> }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      exportKnowledge: (payload: {
        format: 'txt' | 'md' | 'json' | 'excel'
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
      }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      exportReferenceAsset: (payload: {
        format: 'txt' | 'md' | 'json' | 'excel'
        asset?: {
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
        documents?: Array<{
          title?: string
          sourceType?: string
          sourceTypeLabel?: string
          sourceLabel?: string
          summary?: string
          content?: string
          keywords?: string[]
          updatedAtLabel?: string
        }>
      }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      exportRelationsData: (payload: {
        dataType: 'organization' | 'membership' | 'relationship'
        format: 'json' | 'txt' | 'markdown' | 'excel'
        organizations?: Array<{ id?: string; name?: string; type?: string; description?: string; motto?: string; color?: string }>
        memberships?: Array<{ id?: string; characterId?: string; organizationId?: string; role?: string; notes?: string; characterName?: string; organizationName?: string }>
        relationships?: Array<{ id?: string; fromCharacterId?: string; toCharacterId?: string; type?: string; description?: string; intensity?: number; fromCharacterName?: string; toCharacterName?: string }>
        projectTitle?: string
      }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      importRelationsData: (payload: {
        dataType: 'organization' | 'membership' | 'relationship'
      }) => Promise<{
        success: boolean
        canceled: boolean
        fileName?: string
        data?: unknown[]
        error?: string
      }>
      importOutlineSpreadsheet: () => Promise<{
        success: boolean
        canceled: boolean
        fileName?: string
        sheetName?: string
        rows?: string[][]
        error?: string
      }>
      exportOutlineTemplate: () => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      exportOutlineSpreadsheet: (payload: unknown) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      importReferenceNovelAnalysis: (payload: CharacterArcReferenceImportPayload) => Promise<{
        success: boolean
        canceled: boolean
        result?: CharacterArcReferenceImportResult
        error?: string
      }>
      importReferenceNovelBatch: (payload: CharacterArcReferenceImportPayload & { filePaths?: string[]; concurrency?: number }) => Promise<{
        success: boolean
        canceled: boolean
        results?: Array<{
          bookId: string
          success: boolean
          result?: CharacterArcReferenceImportResult
          error?: string
          fileName: string
        }>
        error?: string
      }>
      pickReferenceNovelFiles: () => Promise<{
        success: boolean
        canceled: boolean
        files?: Array<{ filePath: string; fileName: string; size: number }>
      }>
      cancelReferenceNovelBook: (bookId?: string) => Promise<{
        success: boolean
        error?: string
      }>
      readReferenceNovelText: (refId: string) => Promise<{
        success: boolean
        content?: string
        error?: string
      }>
      pickChapterImportFile: () => Promise<{
        success: boolean
        canceled: boolean
        file?: {
          filePath: string
          fileName: string
          title: string
          content: string
          charCount: number
        }
        error?: string
      }>
      pickCharacterCards: () => Promise<{
        success: boolean
        canceled: boolean
        cards?: Array<{
          name: string
          role: string
          description: string
          appearance: string
          personality: string
          background: string
          scenario: string
          greeting: string
          dialogueExamples: string
          tags: string[]
          avatar?: string
          sourceFile: string
        }>
        errors?: string[]
      }>
      exportCharacterCards: (payload: {
        cards: Array<Record<string, unknown>>
        format: 'png' | 'json'
      }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      batchExportCharacterCards: (payload: {
        cards: Array<Record<string, unknown>>
        format?: 'png' | 'json'
      }) => Promise<{
        success: boolean
        canceled: boolean
        exportedCount?: number
        failed?: string[]
        filePath?: string
        error?: string
      }>
      pickCharacterAvatar: () => Promise<{
        success: boolean
        canceled: boolean
        dataUrl?: string
        fileName?: string
        error?: string
      }>
      pickBackgroundImage: () => Promise<{
        success: boolean
        canceled: boolean
        dataUrl?: string
        fileName?: string
        error?: string
      }>
      getProjectSkillsPaths: (projectId: string) => Promise<{
        success: boolean
        builtinDir?: string
        projectDir?: string
      }>
      getLocalSqlPath: () => Promise<{
        success: boolean
        path?: string
        error?: string
      }>
      openLocalSqlDirectory: () => Promise<{
        success: boolean
        error?: string
      }>
      scanProjectSkills: (projectId: string) => Promise<{
        success: boolean
        skills?: Array<import('@/types/app').ProjectSkillItem>
        error?: string
      }>
      importProjectSkillsPackage: (projectId: string, targetGroup?: string, mode?: 'dir' | 'zip' | 'both') => Promise<{
        success: boolean
        canceled: boolean
        importedSkillIds?: string[]
        error?: string
      }>
      listProjectSkillGroups: (projectId: string) => Promise<{
        success: boolean
        groups?: Array<{ name: string; count: number }>
        error?: string
      }>
      createProjectSkillGroup: (projectId: string, groupName: string) => Promise<{
        success: boolean
        name?: string
        error?: string
      }>
      deleteProjectSkillGroup: (projectId: string, groupName: string) => Promise<{
        success: boolean
        deletedGroup?: string
        error?: string
      }>
      deleteProjectSkills: (projectId: string, paths: string[]) => Promise<{
        success: boolean
        deleted?: string[]
        error?: string
      }>
      exportProjectSkills: (projectId: string, paths: string[]) => Promise<{
        success: boolean
        canceled?: boolean
        exportedCount?: number
        filePath?: string
        error?: string
      }>
      getProjectSkillsContext: (projectId: string) => Promise<{
        success: boolean
        skills?: Array<{
          id: string
          name: string
          description: string
          content: string
        }>
        error?: string
      }>
      importFromCcSwitch: () => Promise<{
        success: boolean
        configPath?: string
        configError?: string
        aiProfiles?: Array<{
          name: string
          type: string
          baseUrl: string
          apiKey: string
          model: string
          isCurrent: boolean
        }>
        error?: string
      }>
      importCcSwitchSkills: (projectId: string, targetGroup?: string) => Promise<{
        success: boolean
        importedSkillIds?: string[]
        error?: string
      }>
      publishWorkspaceSync: (payload: unknown) => Promise<{
        success: boolean
        error?: string
      }>
      onWorkspaceSync: (callback: (payload: unknown) => void) => () => void
      onReferenceImportProgress: (callback: (payload: CharacterArcReferenceImportProgressPayload) => void) => () => void
      onProjectArchiveImportProgress: (callback: (payload: CharacterArcProjectArchiveImportProgressPayload) => void) => () => void
      checkUpdate: () => Promise<{
        success: boolean
        result?: {
          hasUpdate: boolean
          currentVersion: string
          latestVersion: string
          releaseTitle: string
          releaseNotes: string
          releaseUrl: string
          publishedAt: string
          assets: Array<{ name: string; downloadUrl: string; size: number }>
        }
        error?: string
      }>
      openExternalUrl: (url: string) => Promise<void>
      fetchAnnouncements: () => Promise<{
        success: boolean
        data?: Array<{ title: string; date: string; type: string; items: string[] }>
      }>
      fetchTutorial: () => Promise<{
        success: boolean
        data?: unknown
        error?: string
      }>
      listSessions: (projectId: string) => Promise<{
        success: boolean
        result?: Array<{ id: string; title: string; created_at: string; updated_at: string }>
        error?: string
      }>
      loadSession: (sessionId: string) => Promise<{
        success: boolean
        result?: {
          id: string
          project_id: string
          title: string
          messages: unknown[]
          proposal?: unknown | null
          lastProposalPrompt?: string
          lastAssistantReply?: string
          created_at: string
          updated_at: string
        }
        error?: string
      }>
      saveSession: (payload: {
        id: string
        projectId: string
        title: string
        messages: unknown[]
        proposal?: unknown | null
        lastProposalPrompt?: string
        lastAssistantReply?: string
      }) => Promise<{
        success: boolean
        error?: string
      }>
      deleteSession: (sessionId: string) => Promise<{
        success: boolean
        error?: string
      }>
      fetchFanqieTrends: (path: string, force?: boolean) => Promise<{
        success: boolean
        data?: unknown
        fromCache?: boolean
        fetchedAt?: number
        mirror?: string
        error?: string
      }>
      /** Assistant Runtime v2 IPC 通道。参数与返回值见 @shared/assistant-runtime。 */
      assistant: {
        sessionList: (payload: {
          projectId: string
          surfaceId?: string
          scopeRef?: string
          limit?: number
        }) => Promise<import('@shared/assistant-runtime').AssistantSession[]>
        sessionCreate: (payload: {
          projectId: string
          surfaceId: string
          scopeRef?: string
          title: string
        }) => Promise<import('@shared/assistant-runtime').AssistantSession>
        sessionDelete: (payload: { sessionId: string }) => Promise<{ ok: boolean }>
        sessionLoad: (payload: { sessionId: string; withReplay?: boolean }) => Promise<{
          session: import('@shared/assistant-runtime').AssistantSession | null
          turns: import('@shared/assistant-runtime').AssistantTurn[]
          events: import('@shared/assistant-runtime').PersistedTurnEvent[]
        }>
        sessionRename: (payload: { sessionId: string; title: string }) => Promise<{ ok: boolean }>
        sessionRestore: (payload: {
          id?: string
          projectId: string
          surfaceId: string
          scopeRef?: string
          title: string
          createdAt?: string
          updatedAt?: string
          turns?: unknown[]
          events?: unknown[]
        }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>
        turnSend: (payload: import('@shared/assistant-runtime').TurnSendRequest) =>
          Promise<{ turnId: string; finalText: string; status: string; error?: string }>
        turnCancel: (payload: import('@shared/assistant-runtime').TurnCancelRequest) =>
          Promise<{ ok: boolean; reason?: string }>
        turnDelete: (payload: import('@shared/assistant-runtime').TurnDeleteRequest) =>
          Promise<{ ok: boolean }>
        turnTruncate: (payload: import('@shared/assistant-runtime').TurnTruncateRequest) =>
          Promise<import('@shared/assistant-runtime').TurnTruncateResult>
        stageList: (payload: {
          sessionId?: string
          status?: readonly string[]
          kind?: readonly string[]
          turnId?: string
        }) => Promise<import('@shared/assistant-runtime').StagedChange[]>
        stageAccept: (payload: import('@shared/assistant-runtime').StageAcceptRequest) =>
          Promise<import('@shared/assistant-runtime').StagedChange[]>
        stageReject: (payload: import('@shared/assistant-runtime').StageRejectRequest) =>
          Promise<import('@shared/assistant-runtime').StagedChange[]>
        stageCommit: (payload: import('@shared/assistant-runtime').StageCommitRequest) =>
          Promise<import('@shared/assistant-runtime').StagedChangeCommitResult[]>
        stageBindTarget: (payload: import('@shared/assistant-runtime').StageBindTargetRequest) =>
          Promise<import('@shared/assistant-runtime').StagedChange | null>
        stageRemove: (payload: import('@shared/assistant-runtime').StageRemoveRequest) =>
          Promise<number>
        stageClearFinished: (payload: import('@shared/assistant-runtime').StageClearFinishedRequest) =>
          Promise<number>
        // Agent（智能体）
        agentList: (payload?: import('@shared/assistant-runtime').AgentListRequest) =>
          Promise<import('@shared/assistant-runtime').AgentProfile[]>
        agentGet: (payload: { id: string }) =>
          Promise<import('@shared/assistant-runtime').AgentProfile | null>
        agentCreate: (payload: import('@shared/assistant-runtime').AgentCreateRequest) =>
          Promise<import('@shared/assistant-runtime').AgentProfile>
        agentUpdate: (payload: import('@shared/assistant-runtime').AgentUpdateRequest) =>
          Promise<import('@shared/assistant-runtime').AgentProfile | null>
        agentDelete: (payload: { id: string }) => Promise<{ ok: boolean }>
        // 创作记忆（Agent Memory / 学习闭环）
        memoryList: (payload: import('@shared/assistant-runtime').MemoryListRequest) =>
          Promise<import('@shared/assistant-runtime').AgentMemory[]>
        memoryCreate: (payload: import('@shared/assistant-runtime').MemoryCreateRequest) =>
          Promise<import('@shared/assistant-runtime').AgentMemory>
        memoryDelete: (payload: import('@shared/assistant-runtime').MemoryDeleteRequest) =>
          Promise<{ ok: boolean }>
        onEvent: (
          callback: (payload: import('@shared/assistant-runtime').AssistantEventPush) => void
        ) => () => void
      }
    }
  }
}

export {}
