import type { CoreRuntimeConfig } from "../core"
import { buildCharacterIdentitySection } from "./character"
import { buildChatToolSection } from "./tools"

export function buildChatSystemPrompt(core?: CoreRuntimeConfig) {
  return [buildCharacterIdentitySection(core?.character, { mode: "chat" }), buildChatToolSection()].join("\n\n")
}
