import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { RegisteredTool, ToolSourceDescriptor } from "./types"

export class ToolRegistry {
  private readonly entries = new Map<string, RegisteredTool>()

  register(tool: AgentTool, source: ToolSourceDescriptor) {
    const existed = this.entries.get(tool.name)
    if (existed) {
      throw new Error(
        `工具名称重复: ${tool.name}，已由 ${existed.source.kind}:${existed.source.name} 注册，不能再由 ${source.kind}:${source.name} 注册。`,
      )
    }
    this.entries.set(tool.name, { tool, source })
  }

  registerMany(tools: AgentTool[], source: ToolSourceDescriptor) {
    for (const tool of tools) {
      this.register(tool, source)
    }
  }

  list(): AgentTool[] {
    return [...this.entries.values()].map((entry) => entry.tool)
  }

  describe(): RegisteredTool[] {
    return [...this.entries.values()]
  }
}

export function createToolRegistry() {
  return new ToolRegistry()
}
