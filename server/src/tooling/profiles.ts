import type { AgentTaskSource } from "../prompting"
import type { ToolSkillName } from "./skills"

export type ToolProfileName = AgentTaskSource

const PROFILE_SKILLS: Record<ToolProfileName, ToolSkillName[]> = {
  user_chat: ["meta", "web", "image", "interaction", "memo", "self_awake", "workspace", "extension", "mcp"],
  system_event: ["meta", "web", "image", "memo", "self_awake", "workspace"],
  scheduled_task: ["meta", "web", "image", "memo", "self_awake"],
  self_awake: ["meta", "web", "image", "memo", "self_awake"],
}

export function skillsForProfile(profile: ToolProfileName = "user_chat") {
  return new Set(PROFILE_SKILLS[profile] ?? PROFILE_SKILLS.user_chat)
}

export function profileAllowsWorkspace(profile: ToolProfileName) {
  return skillsForProfile(profile).has("workspace")
}
