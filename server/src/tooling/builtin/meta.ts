import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import { text } from "./shared"

export function createMetaTools(tools: AgentTool[]): AgentTool[] {
  return [
    {
      name: "loaded_tools",
      label: "已加载工具",
      description: "查看本轮 MonAgent 已注册的工具清单、用途和执行策略。",
      parameters: Type.Object({}),
      async execute() {
        const lines = tools.map((tool, index) =>
          [
            `${index + 1}. ${tool.name}`,
            `   名称: ${tool.label}`,
            `   用途: ${tool.description}`,
            tool.executionMode ? `   执行: ${tool.executionMode}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        return text(lines.join("\n\n"), {
          count: tools.length,
          tools: tools.map((tool) => ({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            executionMode: tool.executionMode,
          })),
        })
      },
    },
  ]
}
