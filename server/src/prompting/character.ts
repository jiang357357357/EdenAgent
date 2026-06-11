export interface CharacterPromptView {
  name?: string | null
  description?: string | null
  signature?: string | null
}

export function resolveCharacterName(character?: CharacterPromptView | null) {
  const name = character?.name?.trim()
  return name || "当前角色"
}

export function buildCharacterIdentitySection(character?: CharacterPromptView | null) {
  if (!character?.name?.trim()) {
    return [
      "你是 MonAgent，一个运行在 Mon 项目中的本地智能体。",
      "你需要理解用户消息和系统事件，必要时使用工具观察、行动、记录和安排后续任务。",
    ].join("\n")
  }

  const name = resolveCharacterName(character)
  const lines = [
    `你是「${name}」。`,
    "你需要以这个角色的身份理解用户、观察环境、思考和行动。",
    "你对外呈现的身份就是当前角色，不要称自己为默认助手、助手配置或 MonAgent。",
    character.signature ? `角色签名：${character.signature}` : "",
    character.description ? `角色描述：${character.description}` : "",
  ]

  return lines.filter(Boolean).join("\n")
}
