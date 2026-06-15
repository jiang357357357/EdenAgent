import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core"
import { getEnvApiKey, getModel } from "@earendil-works/pi-ai"
import type { CoreClient, CoreRuntimeConfig } from "../core"
import { buildAgentSystemPrompt, buildAgentTaskPrompt, type CharacterPromptView } from "../prompting"
import { resolveCoreModel, type RuntimeModelConfig } from "../runtime/mon-agent-runtime"
import { createID, printKeyValuePanel, type Logger } from "../shared"
import { createMonAgentTools } from "../tooling"
import type { SelfAwakeDecision, SelfAwakeRequest } from "./types"

interface SelfAwakeRunOptions {
  coreToken?: string | null
  coreClient?: CoreClient
  resolveCoreConfig?: (token?: string | null) => Promise<CoreRuntimeConfig | undefined>
  workspaceRoot?: string
}

function envModel(): RuntimeModelConfig {
  const raw = process.env.MON_AGENT_SELFAWAKE_MODEL || process.env.MON_AGENT_MODEL || "openai/gpt-4o-mini"
  const slash = raw.indexOf("/")
  const provider = slash > 0 ? raw.slice(0, slash) : "openai"
  const modelID = slash > 0 ? raw.slice(slash + 1) : raw
  const model = getModel(provider as never, modelID as never)
  if (!model) {
    throw new Error(`Unknown Pi model: ${provider}/${modelID}`)
  }
  return {
    source: "env",
    model,
    label: `${provider}/${modelID}`,
    apiKey: getEnvApiKey(provider),
    thinkingLevel: "off",
    supportsImages: Array.isArray(model.input) && model.input.includes("image"),
  }
}

async function resolveSelfAwakeModel(
  options: SelfAwakeRunOptions | undefined,
  logger?: Logger,
): Promise<RuntimeModelConfig> {
  if (options?.coreToken && options.resolveCoreConfig) {
    const core = await options.resolveCoreConfig(options.coreToken)
    if (core) {
      const runtimeConfig = resolveCoreModel(core)
      logger?.info("自醒已使用 Core 默认助手配置", {
        assistantID: core.assistant.id,
        assistant: core.assistant.name,
        characterID: core.character.id,
        character: core.character.name,
        aiEntityID: core.aiEntity.id,
        aiEntity: core.aiEntity.ai_name,
        model: runtimeConfig.label,
      })
      return runtimeConfig
    }
  }

  logger?.warn("自醒未拿到 Core 默认助手配置，临时回退到环境模型")
  return envModel()
}

type AssistantAgentMessage = Extract<AgentMessage, { role: "assistant" }>

function isAssistantMessage(message: AgentMessage): message is AssistantAgentMessage {
  return "role" in message && message.role === "assistant"
}

function contentTypes(message: AssistantAgentMessage) {
  return message.content.map((part) => part.type)
}

function textFromToolResult(result: { content?: Array<{ type: string; text?: string }> }) {
  return (
    result.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n") ?? ""
  )
}

function contentPreviewRows(message: AssistantAgentMessage) {
  return message.content.map((part, index) => {
    if (part.type === "thinking") {
      return [`思考 ${index + 1}`, textPreview(part.thinking, 600)] satisfies [string, unknown]
    }
    if (part.type === "text") {
      return [`文本 ${index + 1}`, textPreview(part.text, 600)] satisfies [string, unknown]
    }
    if (part.type === "toolCall") {
      return [
        `工具调用 ${index + 1}`,
        `${part.name} ${textPreview(JSON.stringify(part.arguments ?? {}), 260)}`,
      ] satisfies [string, unknown]
    }
    return [`内容 ${index + 1}`, textPreview(JSON.stringify(part), 260)] satisfies [string, unknown]
  })
}

function finalAssistantMessage(messages: AgentMessage[]) {
  return [...messages].reverse().find(isAssistantMessage)
}

function finalAssistantText(messages: AgentMessage[]) {
  const textBlocks = [...messages]
    .filter(isAssistantMessage)
    .flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text.trim()))
    .filter(Boolean)
  return textBlocks.at(-1) ?? ""
}

function textPreview(text: string, maxLength = 800) {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function usageSummary(usage: unknown) {
  if (!usage || typeof usage !== "object") return "-"
  const data = usage as Record<string, unknown>
  const cost = data.cost && typeof data.cost === "object" ? (data.cost as Record<string, unknown>) : undefined
  const cacheRead = numericUsageField(data, ["cacheRead"])
  const cacheWrite = numericUsageField(data, ["cacheWrite"])
  const parts = [
    data.input !== undefined ? `输入 ${data.input}` : "",
    data.output !== undefined ? `输出 ${data.output}` : "",
    cacheRead ? `缓存读 ${cacheRead}` : "",
    cacheWrite ? `缓存写 ${cacheWrite}` : "",
    data.totalTokens !== undefined ? `总计 ${data.totalTokens}` : "",
    cost?.total !== undefined ? `费用 ${cost.total}` : "",
  ].filter(Boolean)
  return parts.length ? parts.join(" / ") : "-"
}

function numericUsageField(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return 0
}

function aggregateUsage(messages: AgentMessage[]) {
  const usages = messages
    .filter(isAssistantMessage)
    .map((message) =>
      "usage" in message && message.usage && typeof message.usage === "object"
        ? (message.usage as unknown as Record<string, unknown>)
        : undefined,
    )
    .filter((usage): usage is Record<string, unknown> => Boolean(usage))

  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let total = 0
  let costTotal = 0
  let hasCost = false

  for (const usage of usages) {
    input += numericUsageField(usage, ["input", "inputTokens", "promptTokens"])
    output += numericUsageField(usage, ["output", "outputTokens", "completionTokens"])
    cacheRead += numericUsageField(usage, ["cacheRead"])
    cacheWrite += numericUsageField(usage, ["cacheWrite"])
    total += numericUsageField(usage, ["totalTokens", "total", "tokens"])
    const cost = usage.cost && typeof usage.cost === "object" ? (usage.cost as Record<string, unknown>) : undefined
    const costValue = cost?.total
    if (typeof costValue === "number" && Number.isFinite(costValue)) {
      costTotal += costValue
      hasCost = true
    }
  }

  const knownTotal = input + output + cacheRead + cacheWrite
  if (!total && knownTotal) total = knownTotal
  const other = Math.max(0, total - knownTotal)

  return {
    calls: usages.length,
    input,
    output,
    cacheRead,
    cacheWrite,
    other,
    total,
    costTotal: hasCost ? costTotal : undefined,
  }
}

function printSelfAwakeTokenUsage(messages: AgentMessage[]) {
  const usage = aggregateUsage(messages)
  printKeyValuePanel(
    [
      ["本次模型调用", usage.calls || "-"],
      ["本次全部 Token", usage.total || "-"],
      ["未缓存输入 Token", usage.input || "-"],
      ["输出 Token", usage.output || "-"],
      ["缓存读 Token", usage.cacheRead || "-"],
      ["缓存写 Token", usage.cacheWrite || "-"],
      ["其它 Token", usage.other || "-"],
      ["费用", usage.costTotal === undefined ? "-" : usage.costTotal],
    ],
    { title: "MonAgent 自醒 Token 用量", level: "info" },
  )
}

function summarizeDiary(value: unknown) {
  if (!value) return "-"
  if (typeof value === "string") return textPreview(value, 220)
  if (typeof value === "object") {
    const data = value as Record<string, unknown>
    const title = typeof data.title === "string" ? data.title : ""
    const content = typeof data.content === "string" ? data.content : ""
    const text = [title, content].filter(Boolean).join("：")
    if (text) return textPreview(text, 220)
  }
  try {
    return textPreview(JSON.stringify(value), 220)
  } catch {
    return textPreview(String(value), 220)
  }
}

function contextSummary(context: Record<string, unknown> | undefined) {
  const data = context ?? {}
  const keys = Object.keys(data)
  const userActivity = data.user_activity
  return {
    keys,
    userActivity:
      typeof userActivity === "string" && userActivity.trim()
        ? textPreview(userActivity.trim(), 160)
        : undefined,
  }
}

function summarizeSelfAwakeContext(context: Record<string, unknown> | undefined) {
  const data = context ?? {}
  const lastState = data.last_state && typeof data.last_state === "object" ? (data.last_state as Record<string, unknown>) : {}
  const modules = Array.isArray(data.module_status) ? data.module_status : []
  return [
    ["当前时间", data.current_time_local ?? data.current_time],
    ["用户活动", data.user_activity],
    ["模块数量", modules.length],
    ["上次自醒", lastState.last_run_at],
    ["下次计划", lastState.next_wake_at],
    ["上次来源", (lastState.last_decision as Record<string, unknown> | undefined)?.source],
    ["日记摘要", summarizeDiary(data.last_diary)],
  ] satisfies Array<[string, unknown]>
}

function printSelfAwakeConfig(runtimeConfig: RuntimeModelConfig, characterName: string) {
  printKeyValuePanel(
    [
      ["助手", runtimeConfig.core?.assistant.name ?? "环境配置"],
      ["角色", characterName],
      ["AI 实体", runtimeConfig.core?.aiEntity.ai_name ?? "-"],
      ["模型", runtimeConfig.label],
      ["来源", runtimeConfig.source === "core" ? "Core 默认助手配置" : "环境变量"],
      ["思考", runtimeConfig.model.reasoning && runtimeConfig.thinkingLevel !== "off" ? runtimeConfig.thinkingLevel : "关闭"],
    ],
    { title: "MonAgent 自醒配置", level: "info" },
  )
}

function printSelfAwakeDecision(decision: SelfAwakeDecision, model: string, durationMs: number) {
  const observations = Array.isArray(decision.observations) ? decision.observations.filter(Boolean) : []
  printKeyValuePanel(
    [
      ["模型", model],
      ["心情", decision.mood],
      ["想做", decision.current_desire],
      ["观察事实", observations.length ? observations.join("\n") : "-"],
      ["动作", decision.action.type],
      ["通知用户", decision.should_interrupt_user ? "需要" : "不需要"],
      ["下次唤醒", `${decision.next_wake.after_minutes} 分钟后`],
      ["原因", decision.next_wake.reason],
      ["日记标题", decision.diary.title],
      ["日记内容", textPreview(decision.diary.content, 420)],
      ["耗时", `${durationMs}ms`],
    ],
    { title: "MonAgent 自醒决策", level: decision.should_interrupt_user ? "warn" : "info" },
  )
}

function printSelfAwakeModelReturn(
  model: string,
  durationMs: number,
  message: AssistantAgentMessage | undefined,
  text: string,
) {
  printKeyValuePanel(
    [
      ["模型", model],
      ["耗时", `${durationMs}ms`],
      ["内容类型", message ? contentTypes(message).join(", ") || "-" : "-"],
      ["文本长度", text.length],
      ["用量", usageSummary(message && "usage" in message ? message.usage : undefined)],
      ["预览", textPreview(text, 360)],
    ],
    { title: "MonAgent 自醒 Agent 返回", level: "debug" },
  )
}

const selfAwakeAllowedTools = new Set([
  "loaded_tools",
  "web_search",
  "web_fetch",
  "analyze_image",
  "create_memo",
  "create_reminder",
  "list_memos",
  "list_due_memos",
  "dispatch_due_memos",
  "get_next_memo_wake",
  "complete_memo",
  "snooze_memo",
  "mark_memo_triggered",
  "set_self_awake_timer",
])

const selfAwakeFileTools = new Set(["read", "ls", "grep"])

function hasMeaningfulArray(value: unknown) {
  return Array.isArray(value) && value.some((item) => String(item ?? "").trim())
}

function selfAwakeCanUseFileTool(context: Record<string, unknown> | undefined, toolName: string, args: unknown) {
  if (!selfAwakeFileTools.has(toolName)) return false

  const data = context ?? {}
  if (data.debug_target || data.debugTarget) return true
  if (hasMeaningfulArray(data.recent_incidents) || hasMeaningfulArray(data.recent_logs)) return true
  const policy = data.policy && typeof data.policy === "object" ? (data.policy as Record<string, unknown>) : {}
  if (policy.allow_workspace_file_tools === true) return true

  if (typeof args === "object" && args) {
    const record = args as Record<string, unknown>
    const pathValue = typeof record.path === "string" ? record.path : ""
    const patternValue = typeof record.pattern === "string" ? record.pattern : ""
    if (pathValue && pathValue !== "." && pathValue !== "./" && patternValue) return true
  }

  return false
}

function toolPattern(toolName: string, args: unknown) {
  if (typeof args === "object" && args) {
    const record = args as Record<string, unknown>
    if (typeof record.path === "string") return record.path
    if (typeof record.url === "string") return record.url
    if (typeof record.query === "string") return record.query
    if (typeof record.command === "string") return record.command
  }
  return toolName
}

function handleSelfAwakeAgentEvent(logger: Logger | undefined, sessionID: string, event: AgentEvent) {
  if (event.type === "message_start" && event.message.role === "assistant") {
    logger?.info("自醒 Agent 助手消息开始", {
      sessionID,
      model: event.message.model,
      provider: event.message.provider,
    })
    return
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    logger?.info("自醒 Agent 助手消息结束", {
      sessionID,
      model: event.message.model,
      provider: event.message.provider,
      contentTypes: contentTypes(event.message),
      error: event.message.errorMessage,
    })
    const previewRows = contentPreviewRows(event.message).filter(([, value]) => String(value || "").trim())
    if (previewRows.length) {
      printKeyValuePanel(previewRows, {
        title: "MonAgent 自醒消息内容预览",
        level: "debug",
      })
    }
    return
  }
  if (event.type === "tool_execution_start") {
    logger?.info("自醒 Agent 工具开始执行", {
      sessionID,
      tool: event.toolName,
      callID: event.toolCallId,
    })
    return
  }
  if (event.type === "tool_execution_end") {
    const output = textFromToolResult(event.result)
    logger?.[event.isError ? "warn" : "info"](event.isError ? "自醒 Agent 工具执行失败" : "自醒 Agent 工具执行完成", {
      sessionID,
      tool: event.toolName,
      callID: event.toolCallId,
      isError: event.isError,
      outputPreview: textPreview(output || "-", 600),
    })
    printKeyValuePanel(
      [
        ["工具", event.toolName],
        ["调用 ID", event.toolCallId],
        ["状态", event.isError ? "失败" : "完成"],
        ["输出", textPreview(output || "-", 700)],
      ],
      { title: event.isError ? "MonAgent 自醒工具失败" : "MonAgent 自醒工具结果", level: event.isError ? "warn" : "debug" },
    )
  }
}

async function runSelfAwakeAgent(input: {
  request: SelfAwakeRequest
  runtimeConfig: RuntimeModelConfig
  character: CharacterPromptView
  logger?: Logger
  options?: SelfAwakeRunOptions
}) {
  const { request, runtimeConfig, character, logger, options } = input
  const { model, label, apiKey, thinkingLevel } = runtimeConfig
  if (!apiKey) {
    throw new Error(`模型 ${label} 缺少 API Key`)
  }

  const workspaceRoot = options?.workspaceRoot ?? process.cwd()
  const sessionID = createID("selfawake")
  const tools = createMonAgentTools(
    workspaceRoot,
    {
      sessionID,
      coreClient: options?.coreClient,
      coreToken: options?.coreToken,
      currentModelSupportsImages: runtimeConfig.supportsImages,
      visionConfig: runtimeConfig.core?.visionConfig,
      getCurrentFiles: () => [],
    },
    "self_awake",
  )
  const systemPrompt = buildAgentSystemPrompt({ character, source: "self_awake" })
  const userPrompt = buildAgentTaskPrompt({
    source: "self_awake",
    context: request.context,
  })

  logger?.info("自醒 Agent 调用开始", {
    sessionID,
    model: label,
    workspaceRoot,
    tools: tools.map((tool) => tool.name),
    contextKeys: Object.keys(request.context ?? {}),
  })
  logger?.debug("自醒 Agent 提示词已准备", {
    sessionID,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
  })
  printKeyValuePanel(
    [
      ["内部会话", sessionID],
      ["模型", label],
      ["工具数量", tools.length],
      ["工具", tools.map((tool) => tool.name).join("、")],
      ["任务来源", "系统自醒"],
      ["策略", "统一智能体提示词；本轮任务协议为后台非交互，运行时拦截高风险工具。"],
    ],
    { title: "MonAgent 自醒 Agent 运行", level: "info" },
  )

  const agent = new Agent({
    sessionId: sessionID,
    toolExecution: "sequential",
    initialState: {
      model,
      thinkingLevel,
      systemPrompt,
      tools,
      messages: [],
    },
    getApiKey: (provider) => apiKey ?? getEnvApiKey(provider),
    beforeToolCall: async ({ toolCall, args }) => {
      const pattern = toolPattern(toolCall.name, args)
      if (selfAwakeCanUseFileTool(request.context, toolCall.name, args)) {
        logger?.info("自醒 Agent 文件工具已按上下文放行", { sessionID, tool: toolCall.name, pattern })
        return undefined
      }

      if (selfAwakeFileTools.has(toolCall.name)) {
        logger?.warn("自醒 Agent 文件工具已拦截", { sessionID, tool: toolCall.name, pattern })
        return {
          block: true,
          reason:
            "当前自醒上下文已提供工作区与工作日记摘要，后台自醒不能无目的浏览文件。只有存在 debug_target、recent_incidents 或明确错误日志时才可读取具体文件。",
        }
      }

      if (selfAwakeAllowedTools.has(toolCall.name)) {
        logger?.info("自醒 Agent 工具已允许", { sessionID, tool: toolCall.name, pattern })
        return undefined
      }

      logger?.warn("自醒 Agent 后台工具已拦截", { sessionID, tool: toolCall.name, pattern })
      return {
        block: true,
        reason:
          "当前轮次是后台非交互观察，不能直接执行需要用户确认或可能产生副作用的工具。请在最终 JSON 的 action 字段中说明需要的动作。",
      }
    },
  })

  agent.subscribe(async (event) => {
    handleSelfAwakeAgentEvent(logger, sessionID, event)
  })

  await agent.prompt({
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text: userPrompt }],
  })

  const messages = agent.state.messages
  const assistant = finalAssistantMessage(messages)
  const text = finalAssistantText(messages)
  return {
    sessionID,
    messages,
    assistant,
    text,
  }
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
    current_desire: String(raw.current_desire || "想先观察当前状态，不急着通知用户。"),
    observations: Array.isArray(raw.observations)
      ? raw.observations.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
      : [],
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
          "我完成了一次后台自醒。当前没有必须通知用户的事项，因此选择记录状态并安排下一次醒来。",
      ),
    },
    source: raw.source === "fallback" ? "fallback" : "agent",
    error: typeof raw.error === "string" ? raw.error : "",
  }
}

function fallbackDecision(request: SelfAwakeRequest, reason: string, fallbackName?: string): SelfAwakeDecision {
  const name = fallbackName || request.character?.name || "我"
  const userActivity = request.context?.user_activity
  const activityText = typeof userActivity === "string" && userActivity.trim() ? userActivity.trim() : "暂未观察到明确的新活动。"
  return {
    mood: "安静、谨慎",
    current_desire: "想先保持观察，确认系统和用户状态是否稳定。",
    observations: [
      "本轮自醒 Agent 调用失败，已进入保守 fallback。",
      activityText,
    ],
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
      content: `${name}尝试进行后台自醒，但模型判断暂不可用。当前观察：${activityText} 因此我选择不通知用户，只记录这次状态。`,
    },
    source: "fallback",
    error: reason,
  }
}

export async function runSelfAwake(
  request: SelfAwakeRequest,
  logger?: Logger,
  options?: SelfAwakeRunOptions,
): Promise<SelfAwakeDecision> {
  const startedAt = Date.now()
  let runtimeConfig: RuntimeModelConfig | undefined
  try {
    runtimeConfig = await resolveSelfAwakeModel(options, logger)
  } catch (error) {
    logger?.warn("解析 Core 默认助手配置失败，自醒将使用环境模型", {
      reason: error instanceof Error ? error.message : String(error),
    })
    runtimeConfig = envModel()
  }

  const coreCharacter = runtimeConfig.core?.character
  const character = coreCharacter ?? request.character ?? {}
  const name = character.name || "当前角色"
  logger?.info("自醒请求已收到", {
    character: name,
    context: contextSummary(request.context),
  })
  printSelfAwakeConfig(runtimeConfig, name)
  printKeyValuePanel(summarizeSelfAwakeContext(request.context), {
    title: "MonAgent 自醒上下文",
    level: "debug",
  })

  try {
    const agentResult = await runSelfAwakeAgent({
      request,
      runtimeConfig,
      character,
      logger,
      options,
    })
    const text = agentResult.text
    const durationMs = Date.now() - startedAt
    logger?.info("自醒 Agent 返回已收到", {
      sessionID: agentResult.sessionID,
      model: runtimeConfig.label,
      durationMs,
      textLength: text.length,
      contentTypes: agentResult.assistant ? contentTypes(agentResult.assistant) : [],
      agentMessages: agentResult.messages.length,
    })
    logger?.debug("自醒 Agent 返回预览", {
      preview: textPreview(text, 500),
    })
    printSelfAwakeModelReturn(runtimeConfig.label, durationMs, agentResult.assistant, text)

    let decision: SelfAwakeDecision
    try {
      decision = parseDecision(text)
    } catch (parseError) {
      logger?.warn("自醒 Agent 返回解析失败", {
        reason: parseError instanceof Error ? parseError.message : String(parseError),
        textLength: text.length,
        preview: textPreview(text, 1200),
      })
      throw parseError
    }

    logger?.info("自醒决策已生成", {
      model: runtimeConfig.label,
      action: decision.action.type,
      nextWake: decision.next_wake.after_minutes,
      shouldNotifyUser: decision.should_interrupt_user,
      durationMs: Date.now() - startedAt,
    })
    printSelfAwakeDecision(decision, runtimeConfig.label, Date.now() - startedAt)
    printSelfAwakeTokenUsage(agentResult.messages)
    return decision
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger?.warn("自醒 Agent 调用失败，使用保守 fallback", { reason })
    const decision = fallbackDecision(request, reason, name)
    logger?.info("自醒 fallback 已生成", {
      action: decision.action.type,
      nextWake: decision.next_wake.after_minutes,
      shouldNotifyUser: decision.should_interrupt_user,
      durationMs: Date.now() - startedAt,
    })
    printSelfAwakeDecision(decision, "fallback", Date.now() - startedAt)
    return decision
  }
}
