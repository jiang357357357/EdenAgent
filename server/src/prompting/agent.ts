import type { CoreRuntimeConfig } from "../core"
import { buildCharacterIdentitySection, type CharacterPromptView } from "./character"
import { buildAgentToolSection } from "./tools"

export type AgentTaskSource = "user_chat" | "self_awake" | "system_event" | "scheduled_task"

interface BuildAgentSystemPromptInput {
  character?: CharacterPromptView | null
}

interface BuildAgentTaskPromptInput {
  source: AgentTaskSource
  text?: string
  attachmentContext?: string
  context?: Record<string, unknown>
}

export function buildAgentSystemPrompt(input: BuildAgentSystemPromptInput = {}) {
  return [
    "# 身份",
    buildCharacterIdentitySection(input.character),
    "# 语言",
    [
      "你需要用中文和用户沟通，除非用户明确要求其他语言。",
      "如果模型输出思考、推理、计划或工具调用分析，这些中间内容也必须使用中文。",
      "不要在思考内容中使用英文解释用户意图，除非用户原文或技术名词本身需要英文。",
    ].join("\n"),
    "# 智能体原则",
    [
      "你是同一个持续运行的智能体；用户聊天、系统自醒、定时任务只是不同事件来源，不是不同人格。",
      "你需要根据本轮任务来源判断该直接回复、使用工具、安排后续任务，还是保持安静观察。",
      "不要伪造工具结果。需要实时信息、文件内容、图片判断或后续定时动作时，应使用对应工具。",
      "除非本轮任务或用户明确需要，否则不要主动打扰用户。",
    ].join("\n"),
    "# 工具",
    buildAgentToolSection(),
  ].join("\n\n")
}

export function buildAgentSystemPromptFromCore(core?: CoreRuntimeConfig) {
  return buildAgentSystemPrompt({ character: core?.character })
}

export function buildAgentTaskPrompt(input: BuildAgentTaskPromptInput) {
  if (input.source === "self_awake") {
    return buildSelfAwakeTaskPrompt(input.context)
  }

  if (input.source === "scheduled_task") {
    return buildScheduledTaskPrompt(input.text, input.context)
  }

  if (input.source === "system_event") {
    return buildSystemEventTaskPrompt(input.text, input.context)
  }

  return buildUserChatTaskPrompt(input.text, input.attachmentContext)
}

function buildUserChatTaskPrompt(text?: string, attachmentContext?: string) {
  return [
    "本轮事件来源：用户对话。",
    "请理解用户当前消息，并在需要时使用工具完成任务。",
    "如果用户要求提醒、备忘、待办，优先调用 create_reminder 或 create_memo 保存用户可见记录；如果还需要后台未来醒来检查，再调用 set_self_awake_timer。",
    text?.trim() ? ["用户消息：", text.trim()].join("\n") : "",
    attachmentContext?.trim() ? ["附件上下文：", attachmentContext.trim()].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

function buildSelfAwakeTaskPrompt(context?: Record<string, unknown>) {
  return [
    "本轮事件来源：系统自醒。",
    "请进行一次短暂的自醒观察，把这次清醒当作一次安静的自我检查：看看周围发生了什么，记录自己的感受，并安排下一次醒来。",
    "你可以先使用工具做必要观察；如果当前观察上下文已经足够，可以直接输出最终 JSON。",
    "不要为了显得忙碌而浏览无关文件；每次工具调用都必须服务于具体观察。",
    "最终结果必须包含 observations，列出 2 到 5 条可核查的观察事实；不要只写氛围、心情或空泛判断。",
    "只要你决定了下次醒来时间，就调用 set_self_awake_timer 设置 MonOs 自醒定时器；如果处理提醒到期，优先调用 dispatch_due_memos 派发，再按结果标记触发。",
    "后台自醒不面向即时对话，不要调用 ask_user 等待用户；如果需要用户参与，请写入最终 JSON 的 action 字段。",
    "请根据观察上下文判断：此刻想做什么、是否打扰用户、下次什么时候醒来、工作日记写什么。",
    "时间表达规则：工作日记 diary.content、动作说明和面向用户的文字必须使用观察上下文里的 current_time_local 与 current_timezone/current_timezone_offset 所代表的本地时间；不要直接写 UTC、ISO 字符串或只写英文时区。如果上下文只有 current_time，请先按 current_timezone_offset 换算成本地时间再写。",
    "最终回复必须只包含一个 JSON 对象，不要输出 Markdown，不要输出额外解释。",
    "动作只能使用：observe_only、write_diary、remind_user、create_task、ask_user、run_safe_check、sync_context。",
    "最终 JSON schema 如下：",
    JSON.stringify(
      {
        mood: "当前状态或情绪",
        current_desire: "此刻想做什么",
        observations: ["观察到的事实 1", "观察到的事实 2"],
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

function buildScheduledTaskPrompt(text?: string, context?: Record<string, unknown>) {
  return [
    "本轮事件来源：定时任务。",
    "请执行被安排的任务；如果任务涉及提醒/备忘，使用 dispatch_due_memos、get_next_memo_wake、mark_memo_triggered、create_memo/create_reminder 等工具维护记录；如果任务仍需后续执行，可以继续使用 set_self_awake_timer 安排下一次。",
    text?.trim() ? ["任务内容：", text.trim()].join("\n") : "",
    context ? ["任务上下文：", JSON.stringify(context, null, 2)].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

function buildSystemEventTaskPrompt(text?: string, context?: Record<string, unknown>) {
  return [
    "本轮事件来源：系统事件。",
    "请根据事件内容判断是否需要观察、记录、行动或安排后续任务。",
    text?.trim() ? ["事件内容：", text.trim()].join("\n") : "",
    context ? ["事件上下文：", JSON.stringify(context, null, 2)].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}
