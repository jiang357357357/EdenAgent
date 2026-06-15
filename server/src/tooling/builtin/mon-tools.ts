import type { AgentTool } from "@earendil-works/pi-agent-core"
import { createImageTools } from "./image"
import { createInteractionTools } from "./interaction"
import { createMemoTools } from "./memo"
import { createMetaTools } from "./meta"
import { createSelfAwakeTools } from "./self-awake-tools"
import { type MonToolOptions } from "./shared"
import { createWebTools } from "./web"
import { createWorkspaceTools } from "./workspace"

export function createMonTools(workspaceRoot: string, options: MonToolOptions = {}): AgentTool[] {
  const tools: AgentTool[] = []
  tools.push(...createMetaTools(tools))
  tools.push(...createWebTools())
  tools.push(...createImageTools(workspaceRoot, options))
  tools.push(...createInteractionTools(options))
  tools.push(...createSelfAwakeTools(workspaceRoot, options))
  tools.push(...createMemoTools(options))
  tools.push(...createWorkspaceTools(workspaceRoot, options))
  return tools
}

export type { MonToolOptions } from "./shared"
