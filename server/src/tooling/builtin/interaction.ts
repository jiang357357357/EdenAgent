import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import { text, type MonToolOptions } from "./shared"

export function createInteractionTools(options: MonToolOptions = {}): AgentTool[] {
  return [
    {
      name: "ask_user",
      label: "询问用户",
      description:
        "当缺少关键信息、需要用户选择方案或继续执行前需要确认边界时，向用户展示问题卡片并等待回答。需要用户回答时应调用此工具，不要只在正文里提问。",
      parameters: Type.Object({
        question: Type.String({ description: "要询问用户的问题。" }),
        header: Type.Optional(Type.String({ description: "问题分组标题，建议 12 个字以内。" })),
        options: Type.Optional(
          Type.Array(
            Type.Object({
              label: Type.String({ description: "选项标题。" }),
              description: Type.Optional(Type.String({ description: "选项说明。" })),
            }),
          ),
        ),
        multiple: Type.Optional(Type.Boolean({ description: "是否允许多选。" })),
        allow_custom: Type.Optional(Type.Boolean({ description: "是否允许用户输入自定义回答，默认允许。" })),
      }),
      executionMode: "sequential",
      async execute(toolCallID, rawInput) {
        const input = rawInput as {
          question: string
          header?: string
          options?: Array<{ label: string; description?: string }>
          multiple?: boolean
          allow_custom?: boolean
        }
        if (!options.questions || !options.sessionID) {
          throw new Error("ask_user 需要在会话运行时中调用。")
        }

        const messageID = options.getMessageID?.()
        const answers = await options.questions.ask({
          sessionID: options.sessionID,
          questions: [
            {
              header: input.header || "需要确认",
              question: input.question,
              options: (input.options ?? []).map((option) => ({
                label: option.label,
                description: option.description ?? option.label,
              })),
              multiple: Boolean(input.multiple),
              custom: input.allow_custom ?? true,
            },
          ],
          tool: messageID
            ? {
                messageID,
                callID: toolCallID,
              }
            : undefined,
        })

        if (!answers) {
          throw new Error("用户暂不处理该问题。")
        }
        const flattened = answers.flat().filter(Boolean)
        return text(flattened.join("\n") || "用户未提供回答。", {
          answers,
        })
      },
    },
  ]
}
