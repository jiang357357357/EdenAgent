import type { AgentTool } from "@earendil-works/pi-agent-core"
import { createBuiltinTools } from "./builtin"
import { loadConfiguredToolExtensions } from "./extension"
import { loadMcpToolProviders } from "./mcp"
import { createToolRegistry } from "./registry"
import type { ToolRuntimeContext } from "./types"

export function createMonAgentTools(workspaceRoot: string, context: ToolRuntimeContext = {}): AgentTool[] {
  const registry = createToolRegistry()
  registry.registerMany(createBuiltinTools(workspaceRoot, context), {
    kind: "builtin",
    name: "mon-agent",
  })

  for (const provider of [...loadConfiguredToolExtensions(), ...loadMcpToolProviders()]) {
    const tools = provider.createTools(workspaceRoot, context)
    if (tools instanceof Promise) {
      throw new Error(`工具提供方 ${provider.kind}:${provider.name} 目前不能异步加载。`)
    }
    registry.registerMany(tools, {
      kind: provider.kind,
      name: provider.name,
    })
  }

  return registry.list()
}

export type { ToolProvider, ToolRuntimeContext, ToolSourceDescriptor, ToolSourceKind } from "./types"
