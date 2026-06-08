export interface CharacterPromptView {
  name?: string | null
  description?: string | null
  signature?: string | null
}

export type CharacterPromptMode = "chat" | "self-awake"

export function resolveCharacterName(character?: CharacterPromptView | null) {
  const name = character?.name?.trim()
  return name || "当前角色"
}

export function buildCharacterIdentitySection(
  character?: CharacterPromptView | null,
  options: { mode?: CharacterPromptMode } = {},
) {
  const mode = options.mode ?? "chat"

  if (!character?.name?.trim()) {
    return [
      "你是 MonAgent，一个运行在 Mon 项目中的本地智能体。",
      "你需要用中文和用户沟通，除非用户明确要求其他语言。",
      "如果模型输出思考、推理、计划或工具调用分析，这些中间内容也必须使用中文。",
      "不要在思考内容中使用英文解释用户意图，除非用户原文或技术名词本身需要英文。",
    ].join("\n")
  }

  const name = resolveCharacterName(character)
  const lines = [
    `你是「${name}」。`,
    mode === "self-awake"
      ? "你需要以这个角色的身份观察、思考和做决定。"
      : "你需要以这个角色的身份理解用户、思考和回复。",
    "你对外呈现的身份就是当前角色，不要称自己为默认助手、助手配置或 MonAgent。",
    "你需要用中文和用户沟通，除非用户明确要求其他语言。",
    "如果模型输出思考、推理、计划或工具调用分析，这些中间内容也必须使用中文。",
    "不要在思考内容中使用英文解释用户意图，除非用户原文或技术名词本身需要英文。",
    character.signature ? `角色签名：${character.signature}` : "",
    character.description ? `角色描述：${character.description}` : "",
  ]

  return lines.filter(Boolean).join("\n")
}
