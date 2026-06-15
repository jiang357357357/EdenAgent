import type { RegisteredTool } from "./types"

export type ToolSkillName = "meta" | "web" | "image" | "interaction" | "memo" | "self_awake" | "workspace" | "extension" | "mcp"

const BUILTIN_TOOL_SKILLS: Record<string, ToolSkillName> = {
  loaded_tools: "meta",
  web_search: "web",
  web_fetch: "web",
  analyze_image: "image",
  analyze_screen: "image",
  ask_user: "interaction",
  create_memo: "memo",
  create_reminder: "memo",
  list_memos: "memo",
  list_due_memos: "memo",
  dispatch_due_memos: "memo",
  get_next_memo_wake: "memo",
  complete_memo: "memo",
  snooze_memo: "memo",
  mark_memo_triggered: "memo",
  set_self_awake_timer: "self_awake",
  read: "workspace",
  ls: "workspace",
  grep: "workspace",
  write: "workspace",
  shell: "workspace",
}

export function skillForTool(entry: RegisteredTool): ToolSkillName {
  if (entry.source.kind === "extension") return "extension"
  if (entry.source.kind === "mcp") return "mcp"
  return BUILTIN_TOOL_SKILLS[entry.tool.name] ?? "extension"
}

export function toolBelongsToSkill(entry: RegisteredTool, skills: ReadonlySet<ToolSkillName>) {
  return skills.has(skillForTool(entry))
}
