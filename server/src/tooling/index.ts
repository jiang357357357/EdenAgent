import type { AgentTool } from "@earendil-works/pi-agent-core"
import { createBuiltinTools } from "./builtin"
import { loadConfiguredToolExtensions } from "./extension"
import { loadMcpToolProviders } from "./mcp"
import { skillsForProfile, type ToolProfileName } from "./profiles"
import { createToolRegistry } from "./registry"
import { toolBelongsToSkill } from "./skills"
import type { ToolRuntimeContext } from "./types"

function visibleLoadedToolsTool(tool: AgentTool, visibleTools: AgentTool[], profile: ToolProfileName): AgentTool {
  return {
    ...tool,
    async execute() {
      const lines = visibleTools.map((item, index) =>
        [
          `${index + 1}. ${item.name}`,
          `   名称: ${item.label}`,
          `   用途: ${item.description}`,
          item.executionMode ? `   执行: ${item.executionMode}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
      return {
        content: [{ type: "text" as const, text: lines.join("\n\n") }],
        details: {
          profile,
          count: visibleTools.length,
          tools: visibleTools.map((item) => ({
            name: item.name,
            label: item.label,
            description: item.description,
            executionMode: item.executionMode,
          })),
        },
      }
    },
  }
}

export function createMonAgentTools(
  workspaceRoot: string,
  context: ToolRuntimeContext = {},
  profile: ToolProfileName = "user_chat",
): AgentTool[] {
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

  const allowedSkills = skillsForProfile(profile)
  const visibleEntries = registry.describe().filter((entry) => toolBelongsToSkill(entry, allowedSkills))
  const visibleTools = visibleEntries.map((entry) => entry.tool)
  return visibleTools.map((tool) => (tool.name === "loaded_tools" ? visibleLoadedToolsTool(tool, visibleTools, profile) : tool))
}

export type { ToolProfileName } from "./profiles"
export type { ToolSkillName } from "./skills"
export type { ToolProvider, ToolRuntimeContext, ToolSourceDescriptor, ToolSourceKind } from "./types"
