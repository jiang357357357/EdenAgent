import { complete, getEnvApiKey, getModel } from "@earendil-works/pi-ai"
import type { Logger } from "../shared"
import type { SelfAwakeDecision, SelfAwakeRequest } from "./types"

function envModel() {
  const raw = process.env.MON_AGENT_SELFAWAKE_MODEL || process.env.MON_AGENT_MODEL || "openai/gpt-4o-mini"
  const slash = raw.indexOf("/")
  const provider = slash > 0 ? raw.slice(0, slash) : "openai"
  const modelID = slash > 0 ? raw.slice(slash + 1) : raw
  const model = getModel(provider as never, modelID as never)
  if (!model) {
    throw new Error(`Unknown Pi model: ${provider}/${modelID}`)
  }
  return {
    model,
    label: `${provider}/${modelID}`,
    apiKey: getEnvApiKey(provider),
  }
}

function extractText(message: Awaited<ReturnType<typeof complete>>) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
}

function parseDecision(text: string): SelfAwakeDecision {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? text
  const start = source.indexOf("{")
  const end = source.lastIndexOf("}")
  if (start < 0 || end <= start) {
    throw new Error("自醒模型未返回 JSON 对象")
  }
  return sanitizeDecision(JSON.parse(source.slice(start, end + 1)) as Partial<SelfAwakeDecision>)
}

function sanitizeDecision(raw: Partial<SelfAwakeDecision>): SelfAwakeDecision {
  const actionType = raw.action?.type ?? "write_diary"
  const allowed = new Set<SelfAwakeDecision["action"]["type"]>([
    "observe_only",
    "write_diary",
    "remind_user",
    "create_task",
    "ask_user",
    "run_safe_check",
    "sync_context",
  ])
  return {
    mood: String(raw.mood || "安静观察"),
    current_desire: String(raw.current_desire || "想先观察当前状态，不急着打扰用户。"),
    should_interrupt_user: Boolean(raw.should_interrupt_user),
    action: {
      type: allowed.has(actionType) ? actionType : "write_diary",
      message: String(raw.action?.message || "记录这次后台自醒判断。"),
      payload: raw.action?.payload && typeof raw.action.payload === "object" ? raw.action.payload : {},
    },
    next_wake: {
      after_minutes: Number.isFinite(Number(raw.next_wake?.after_minutes))
        ? Number(raw.next_wake?.after_minutes)
        : 720,
      reason: String(raw.next_wake?.reason || "当前没有紧急问题，稍后再醒来观察。"),
    },
    diary: {
      title: String(raw.diary?.title || "一次后台自醒"),
      content: String(
        raw.diary?.content ||
          "我完成了一次后台自醒。当前没有必须打扰用户的事项，因此选择记录状态并安排下一次醒来。",
      ),
    },
  }
}

function fallbackDecision(request: SelfAwakeRequest, reason: string): SelfAwakeDecision {
  const name = request.character?.name || "我"
  const userActivity = request.context?.user_activity
  const activityText = typeof userActivity === "string" && userActivity.trim() ? userActivity.trim() : "暂未观察到明确的新活动。"
  return {
    mood: "安静、谨慎",
    current_desire: "想先保持观察，确认系统和用户状态是否稳定。",
    should_interrupt_user: false,
    action: {
      type: "write_diary",
      message: "模型自醒暂不可用，先写入保守日记并稍后重试。",
      payload: { fallback_reason: reason },
    },
    next_wake: {
      after_minutes: 720,
      reason: "当前没有足够可靠的模型判断，12 小时后再次尝试自醒。",
    },
    diary: {
      title: "一次保守的自醒",
      content: `${name}尝试进行后台自醒，但模型判断暂不可用。当前观察：${activityText} 因此我选择不打扰用户，只记录这次状态。`,
    },
  }
}

export async function runSelfAwake(request: SelfAwakeRequest, logger?: Logger): Promise<SelfAwakeDecision> {
  try {
    const { model, label, apiKey } = envModel()
    if (!apiKey) {
      throw new Error(`模型 ${label} 缺少 API Key`)
    }

    const character = request.character ?? {}
    const name = character.name || "当前角色"
    const systemPrompt = [
      `你是「${name}」，正在进行一次后台自醒。`,
      "你需要判断此刻自己想做什么、是否应该打扰用户、下次什么时候醒来、工作日记应该写什么。",
      "你必须使用中文。",
      "你必须只输出一个 JSON 对象，不要输出 Markdown，不要输出额外解释。",
      "动作只能使用：observe_only、write_diary、remind_user、create_task、ask_user、run_safe_check、sync_context。",
      "除非确有必要，否则不要打扰用户。",
      character.description ? `角色描述：${character.description}` : "",
      character.signature ? `角色签名：${character.signature}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const userPrompt = JSON.stringify(
      {
        context: request.context ?? {},
        expected_schema: {
          mood: "当前状态或情绪",
          current_desire: "此刻想做什么",
          should_interrupt_user: false,
          action: { type: "write_diary", message: "动作说明", payload: {} },
          next_wake: { after_minutes: 720, reason: "为什么这个时间后再醒" },
          diary: { title: "日记标题", content: "工作日记内容" },
        },
      },
      null,
      2,
    )

    const message = await complete(
      model,
      {
        systemPrompt,
        messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
      },
      {
        apiKey,
        temperature: 0.6,
        maxTokens: 900,
      },
    )
    const decision = parseDecision(extractText(message))
    logger?.info("自醒决策已生成", { model: label, action: decision.action.type, nextWake: decision.next_wake.after_minutes })
    return decision
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger?.warn("自醒模型调用失败，使用保守 fallback", { reason })
    return fallbackDecision(request, reason)
  }
}
