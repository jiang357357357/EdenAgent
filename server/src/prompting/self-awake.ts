import { buildCharacterIdentitySection, type CharacterPromptView } from "./character"
import { buildSelfAwakeToolSection } from "./tools"

export function buildSelfAwakeSystemPrompt(character?: CharacterPromptView | null) {
  return [buildCharacterIdentitySection(character, { mode: "self-awake" }), buildSelfAwakeToolSection()].join("\n\n")
}

export function buildSelfAwakeUserPrompt(context?: Record<string, unknown>) {
  return [
    "请进行一次短暂的自醒观察。",
    "把这次清醒当作一次安静的自我检查：看看周围发生了什么，记录自己的感受，并安排下一次醒来。",
    "你可以先使用允许的工具做必要观察；如果当前观察上下文已经足够，可以直接输出最终 JSON。",
    "只要你决定了下次醒来时间，就调用 set_self_awake_timer 设置 MonOs 自醒定时器。",
    "请根据观察上下文判断：此刻想做什么、是否打扰用户、下次什么时候醒来、工作日记写什么。",
    "最终回复必须只包含一个 JSON 对象，不要输出 Markdown，不要输出额外解释。",
    "动作只能使用：observe_only、write_diary、remind_user、create_task、ask_user、run_safe_check、sync_context。",
    "最终 JSON schema 如下：",
    JSON.stringify(
      {
        mood: "当前状态或情绪",
        current_desire: "此刻想做什么",
        should_interrupt_user: false,
        action: { type: "write_diary", message: "动作说明", payload: {} },
        next_wake: { after_minutes: 720, reason: "为什么这个时间后再醒" },
        diary: { title: "日记标题", content: "工作日记内容" },
      },
      null,
      2,
    ),
    "当前观察上下文：",
    JSON.stringify(context ?? {}, null, 2),
  ].join("\n\n")
}
