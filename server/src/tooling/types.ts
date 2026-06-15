import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { CoreClient, CoreVisionConfig } from "../core"
import type { PermissionBroker, QuestionBroker } from "../interaction"

export interface ToolRuntimeContext {
  sessionID?: string
  coreClient?: CoreClient
  coreToken?: string | null
  permissions?: PermissionBroker
  questions?: QuestionBroker
  currentModelSupportsImages?: boolean
  visionConfig?: CoreVisionConfig | null
  getMessageID?: () => string | undefined
  getCurrentFiles?: () => Array<{ url: string; filename?: string; mime: string; size?: number }>
}

export type ToolSourceKind = "builtin" | "extension" | "mcp"

export interface ToolSourceDescriptor {
  kind: ToolSourceKind
  name: string
}

export interface RegisteredTool {
  tool: AgentTool
  source: ToolSourceDescriptor
}

export interface ToolProvider {
  name: string
  kind: ToolSourceKind
  createTools(workspaceRoot: string, context: ToolRuntimeContext): AgentTool[] | Promise<AgentTool[]>
}
