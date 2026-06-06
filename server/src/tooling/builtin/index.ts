import type { AgentTool } from "@earendil-works/pi-agent-core"
import { createMonTools } from "./mon-tools"
import type { ToolRuntimeContext } from "../types"

export function createBuiltinTools(workspaceRoot: string, context: ToolRuntimeContext): AgentTool[] {
  return createMonTools(workspaceRoot, context)
}
