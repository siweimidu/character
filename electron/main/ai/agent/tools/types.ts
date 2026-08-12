export type ToolInputSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: ToolInputSchema
}

export type ToolContext = {
  signal: AbortSignal
  projectId: string
  /** 用户数据/工作区根目录（getWorkspaceDirPath()）。文件系统工具的可写根，防止越权。 */
  workspaceDir?: string
}

export type ToolHandlerResult = {
  content: string
  isError?: boolean
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolHandlerResult>

export type Tool = {
  definition: ToolDefinition
  handler: ToolHandler
}
