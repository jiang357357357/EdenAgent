import path from "node:path"
import { Buffer } from "node:buffer"
import { Agent, type AgentEvent, type AgentMessage, type ThinkingLevel } from "@earendil-works/pi-agent-core"
import { getEnvApiKey, getModel, type ImageContent, type Model } from "@earendil-works/pi-ai"
import { CoreAuthenticationExpiredError, type CoreAIEntity, type CoreClient, type CoreRuntimeConfig } from "../core"
import { PermissionBroker, QuestionBroker } from "../interaction"
import { buildAgentSystemPromptFromCore, buildAgentTaskPrompt } from "../prompting"
import { SessionStore } from "../sessions"
import { createID, createLogger, type EventBus, type Logger } from "../shared"
import { createMonAgentTools } from "../tooling"
import type { ApiMessage, ApiMessageInfo, ApiPart, ApiToolPart, PromptPart } from "../types"

interface RuntimeOptions {
  workspaceRoot: string
  store: SessionStore
  events: EventBus
  permissions: PermissionBroker
  questions: QuestionBroker
  logger?: Logger
  coreClient?: CoreClient
  resolveCoreConfig?: (token?: string | null) => Promise<CoreRuntimeConfig | undefined>
  syncCoreSession?: (token: string, sessionID: string, core?: CoreRuntimeConfig) => Promise<void>
  syncCoreMessage?: (token: string, sessionID: string, message: ApiMessage, core?: CoreRuntimeConfig) => Promise<void>
}

export interface RuntimeModelConfig {
  source: "core" | "env"
  model: Model<any>
  apiKey?: string
  label: string
  thinkingLevel: ThinkingLevel
  supportsImages: boolean
  core?: CoreRuntimeConfig
}

interface RunState {
  assistantMessageID?: string
  assistantCreatedAt?: number
  assistantCurrentSegmentIndex?: number
  assistantNextSegmentIndex: number
  runtimeThinkingLines: string[]
  toolInputs: Map<string, unknown>
  toolStarts: Map<string, number>
  finishedToolCalls: Set<string>
  textPartSnapshots: Map<string, string>
}

function getEnvRuntimeModel(): RuntimeModelConfig {
  const raw = process.env.MON_AGENT_MODEL || "openai/gpt-4o-mini"
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
    thinkingLevel: normalizeThinkingLevel(process.env.MON_AGENT_THINKING_LEVEL) ?? "off",
    supportsImages: Array.isArray(model.input) && model.input.includes("image"),
  }
}

function normalizeThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (typeof value === "boolean") return value ? "medium" : "off"
  if (typeof value === "number") return value > 0 ? "medium" : "off"
  if (typeof value !== "string") return undefined

  const normalized = value.trim().toLowerCase().replace(/_/g, "-")
  if (!normalized) return undefined
  if (normalized === "true" || normalized === "on" || normalized === "enabled" || normalized === "enable")
    return "medium"
  if (normalized === "false" || normalized === "off" || normalized === "disabled" || normalized === "disable")
    return "off"
  if (normalized === "x-high" || normalized === "extra-high") return "xhigh"
  if (
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized
  }
  return undefined
}

function readAIParam(aiEntity: CoreAIEntity, keys: string[]) {
  const sources = [aiEntity.default_params, aiEntity.vendor_params]
  for (const source of sources) {
    if (!source || typeof source !== "object") continue
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        return source[key]
      }
    }
  }
  return undefined
}

function resolveCoreThinkingLevel(aiEntity: CoreAIEntity): ThinkingLevel {
  const configuredLevel = normalizeThinkingLevel(
    readAIParam(aiEntity, ["thinking_level", "thinkingLevel"]),
  )
  if (configuredLevel) return configuredLevel

  return "off"
}

function normalizeVendor(vendor: string) {
  const normalized = vendor.trim().toLowerCase().replace(/_/g, "-")
  if (normalized === "custom" || normalized === "monsystem") return "openai"
  if (normalized === "mimo") return "xiaomi"
  return normalized || "openai"
}

function trimEndpointToBase(endpoint?: string | null) {
  const raw = endpoint?.trim()
  if (!raw) return undefined

  try {
    const url = new URL(raw)
    url.pathname = url.pathname
      .replace(/\/chat\/completions\/?$/i, "")
      .replace(/\/responses\/?$/i, "")
      .replace(/\/messages\/?$/i, "")
      .replace(/\/+$/g, "")
    return url.toString().replace(/\/$/, "")
  } catch {
    return raw
      .replace(/\/chat\/completions\/?$/i, "")
      .replace(/\/messages\/?$/i, "")
      .replace(/\/$/, "")
  }
}

function endpointLooksAnthropic(endpoint?: string | null) {
  return /\/messages\/?$/i.test(endpoint?.trim() ?? "")
}

function endpointLooksOpenAICompletions(endpoint?: string | null) {
  return /\/chat\/completions\/?$/i.test(endpoint?.trim() ?? "")
}

function findKnownModel(provider: string, modelID: string) {
  try {
    return getModel(provider as never, modelID as never) as Model<any> | undefined
  } catch {
    return undefined
  }
}

function buildOpenAICompatibleModel(aiEntity: CoreAIEntity, provider: string, baseUrl?: string): Model<any> {
  const api =
    endpointLooksAnthropic(aiEntity.api_endpoint) || provider === "anthropic"
      ? "anthropic-messages"
      : "openai-completions"
  const thinkingLevel = resolveCoreThinkingLevel(aiEntity)
  const reasoning = thinkingLevel !== "off"
  return {
    id: aiEntity.ai_model,
    name: aiEntity.ai_name || aiEntity.ai_model,
    api,
    provider: provider as never,
    baseUrl: baseUrl || (api === "anthropic-messages" ? "https://api.anthropic.com" : "https://api.openai.com/v1"),
    reasoning,
    ...(reasoning && api === "openai-completions" && provider === "deepseek"
      ? { compat: { thinkingFormat: "deepseek" as const } }
      : {}),
    input: aiEntity.is_multimodal ? ["text", "image"] : ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 8_192,
  } as Model<any>
}

export function resolveCoreModel(core: CoreRuntimeConfig): RuntimeModelConfig {
  const aiEntity = core.aiEntity
  const provider = normalizeVendor(aiEntity.vendor)
  const baseUrl = trimEndpointToBase(aiEntity.api_endpoint)
  const known = findKnownModel(provider, aiEntity.ai_model)
  const thinkingLevel = resolveCoreThinkingLevel(aiEntity)
  const reasoning = thinkingLevel !== "off"
  const forceCompatible =
    endpointLooksOpenAICompletions(aiEntity.api_endpoint) || endpointLooksAnthropic(aiEntity.api_endpoint)
  const baseModel =
    known && !forceCompatible
      ? {
          ...known,
          ...(baseUrl ? { baseUrl } : {}),
        }
      : buildOpenAICompatibleModel(aiEntity, provider, baseUrl)
  const model =
    reasoning && baseModel.api === "openai-completions" && provider === "deepseek"
      ? {
          ...baseModel,
          reasoning: true,
          compat: {
            ...baseModel.compat,
            thinkingFormat: "deepseek" as const,
          },
        }
      : {
          ...baseModel,
          reasoning: reasoning || baseModel.reasoning,
        }

  const supportsImages =
    typeof aiEntity.is_multimodal === "boolean"
      ? aiEntity.is_multimodal
      : Array.isArray(model.input) && model.input.includes("image")

  return {
    source: "core",
    model,
    apiKey: aiEntity.api_key,
    label: `${provider}/${aiEntity.ai_model}`,
    thinkingLevel,
    supportsImages,
    core,
  }
}

function contentText(parts: PromptPart[]) {
  return parts
    .filter((part): part is Extract<PromptPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function promptFiles(parts: PromptPart[]) {
  return parts
    .filter((part): part is Extract<PromptPart, { type: "file" }> => part.type === "file")
    .map((part) => ({
      url: part.url,
      filename: part.filename,
      mime: part.mime ?? "application/octet-stream",
      size: part.size,
    }))
}

function toImages(parts: PromptPart[]): ImageContent[] {
  return parts.flatMap((part) => {
    if (part.type !== "file") return []
    const mime = part.mime ?? "image/png"
    if (!mime.startsWith("image/")) return []
    const match = part.url.match(/^data:([^;,]+);base64,(.*)$/)
    if (!match) return []
    return [{ type: "image", mimeType: match[1] || mime, data: match[2] || "" }]
  })
}

function isTextLikeFile(file: { mime: string; filename?: string }) {
  const mime = file.mime.toLowerCase()
  const filename = file.filename?.toLowerCase() ?? ""
  if (mime.startsWith("text/")) return true
  if (
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-yaml",
      "application/yaml",
      "application/toml",
      "application/csv",
      "application/sql",
    ].includes(mime)
  ) {
    return true
  }
  return /\.(txt|md|markdown|json|jsonc|csv|tsv|xml|html|css|js|jsx|ts|tsx|py|dart|java|c|cc|cpp|h|hpp|cs|go|rs|php|rb|sql|yaml|yml|toml|ini|conf|cfg|log|bat|cmd|ps1|sh)$/i.test(
    filename,
  )
}

function decodeDataUrl(url: string) {
  if (!url.startsWith("data:")) return undefined
  const commaIndex = url.indexOf(",")
  if (commaIndex < 0) return undefined

  const header = url.slice(5, commaIndex)
  const payload = url.slice(commaIndex + 1)
  const mime = header.split(";")[0] || "application/octet-stream"
  const isBase64 = /;base64(?:;|$)/i.test(header)
  const text = isBase64 ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload)
  return { mime, text }
}

function buildAttachmentContext(files: ReturnType<typeof promptFiles>, imagesProvidedToModel = true) {
  if (!files.length) return ""

  const maxPerFile = 20_000
  const maxTotal = 80_000
  let used = 0
  const sections: string[] = []

  for (const [index, file] of files.entries()) {
    const filename = file.filename || `附件-${index + 1}`
    const decoded = decodeDataUrl(file.url)
    const mime = file.mime || decoded?.mime || "application/octet-stream"
    const sizeText = typeof file.size === "number" ? `，大小 ${file.size} bytes` : ""

    if (mime.startsWith("image/")) {
      sections.push(
        `### 附件 ${index + 1}: ${filename}\n类型: ${mime}${sizeText}\n说明: 这是图片附件，${
          imagesProvidedToModel
            ? "已通过视觉通道提供给模型。"
            : "当前对话模型不支持直接看图；如需理解图片内容，请调用 analyze_image。"
        }`,
      )
      continue
    }

    if (decoded && isTextLikeFile({ mime, filename })) {
      const remaining = maxTotal - used
      if (remaining <= 0) {
        sections.push(`### 附件 ${index + 1}: ${filename}\n类型: ${mime}${sizeText}\n内容未注入：附件总文本已达到上限。`)
        continue
      }

      const limit = Math.min(maxPerFile, remaining)
      const body = decoded.text.length > limit ? `${decoded.text.slice(0, limit)}\n\n[附件内容已截断，原始长度 ${decoded.text.length}]` : decoded.text
      used += Math.min(decoded.text.length, limit)
      sections.push(`### 附件 ${index + 1}: ${filename}\n类型: ${mime}${sizeText}\n内容:\n\`\`\`\n${body}\n\`\`\``)
      continue
    }

    sections.push(
      `### 附件 ${index + 1}: ${filename}\n类型: ${mime}${sizeText}\n说明: 此附件不是可直接注入的文本格式，当前仅提供文件元信息。`,
    )
  }

  return `用户本轮上传了以下附件：\n\n${sections.join("\n\n")}`
}

function textFromToolResult(result: { content?: Array<{ type: string; text?: string }> }) {
  return (
    result.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n") ?? ""
  )
}

function truncateText(value: string, max = 800) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}...（已截断，原始长度 ${value.length}）`
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return `[data URL，长度 ${value.length}]`
    return truncateText(value)
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(redactValue)
  if (!value || typeof value !== "object") return value

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/api[_-]?key|authorization|password|secret|token/i.test(key)) {
      output[key] = "[已脱敏]"
      continue
    }
    output[key] = redactValue(item)
  }
  return output
}

function summarizeBlock(block: unknown) {
  if (!block || typeof block !== "object") return { type: typeof block, value: redactValue(block) }
  const record = block as Record<string, unknown>
  const type = typeof record.type === "string" ? record.type : "unknown"

  if (type === "text") return { type, text: truncateText(String(record.text ?? "")) }
  if (type === "thinking") return { type, text: truncateText(String(record.thinking ?? "")) }
  if (type === "image") {
    return {
      type,
      mimeType: record.mimeType,
      data: typeof record.data === "string" ? `[image data，长度 ${record.data.length}]` : undefined,
    }
  }
  if (type === "toolCall") {
    return {
      type,
      name: record.name,
      arguments: redactValue(record.arguments),
    }
  }

  return {
    type,
    data: redactValue(record),
  }
}

function summarizeAgentMessages(messages: AgentMessage[], limit = 8) {
  const start = Math.max(messages.length - limit, 0)
  return messages.slice(start).map((message, index) => ({
    index: start + index,
    role: "role" in message ? message.role : undefined,
    timestamp: "timestamp" in message ? message.timestamp : undefined,
    model: "model" in message ? message.model : undefined,
    provider: "provider" in message ? message.provider : undefined,
    error: "errorMessage" in message ? message.errorMessage : undefined,
    content: "content" in message && Array.isArray(message.content) ? message.content.map(summarizeBlock) : undefined,
    data: "content" in message ? undefined : redactValue(message),
  }))
}

export class MonAgentRuntime {
  private readonly running = new Map<string, Promise<void>>()
  private readonly workspaceRoot: string
  private readonly logger: Logger

  constructor(private readonly options: RuntimeOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot)
    this.logger = options.logger ?? createLogger("Runtime")
  }

  async promptAsync(sessionID: string, parts: PromptPart[], authToken?: string | null) {
    if (this.running.has(sessionID)) {
      this.logger.warn("提示词已拒绝：当前 session 正在运行", { sessionID })
      throw new Error("Session is already running")
    }
    this.logger.info("提示词已入队", {
      sessionID,
      textLength: contentText(parts).length,
      files: promptFiles(parts).length,
    })
    const run = this.runPrompt(sessionID, parts, authToken).finally(() => {
      this.running.delete(sessionID)
    })
    this.running.set(sessionID, run)
    void run.catch((error) => this.emitSessionError(sessionID, error))
  }

  isRunning(sessionID: string) {
    return this.running.has(sessionID)
  }

  appendUserOnly(sessionID: string, parts: PromptPart[]) {
    const message = this.options.store.appendUserMessage(sessionID, contentText(parts), promptFiles(parts))
    this.logger.info("用户消息已追加", { sessionID, messageID: message.info.id, parts: message.parts.length })
    this.emitMessage(sessionID, message.info)
    for (const part of message.parts) {
      this.emitPart(sessionID, part)
    }
    this.emitSession(sessionID)
    return message
  }

  private async resolveRuntimeConfig(sessionID: string, authToken?: string | null): Promise<RuntimeModelConfig> {
    if (authToken && this.options.resolveCoreConfig) {
      const coreConfig = await this.options.resolveCoreConfig(authToken)
      if (coreConfig) {
        return resolveCoreModel(coreConfig)
      }
    }

    if (!authToken) {
      this.logger.warn("Core token 缺失，回退使用 MON_AGENT_MODEL", { sessionID })
    }
    return getEnvRuntimeModel()
  }

  private async runPrompt(sessionID: string, parts: PromptPart[], authToken?: string | null) {
    const session = this.options.store.requireSession(sessionID)
    const started = Date.now()
    this.options.events.emit({ type: "session.status", properties: { sessionID, status: { type: "busy" } } })

    const userMessage = this.options.store.appendUserMessage(sessionID, contentText(parts), promptFiles(parts))
    this.emitMessage(sessionID, userMessage.info)
    for (const part of userMessage.parts) {
      this.emitPart(sessionID, part)
    }
    this.emitSession(sessionID)

    const runState: RunState = {
      assistantNextSegmentIndex: 0,
      runtimeThinkingLines: [],
      toolInputs: new Map(),
      toolStarts: new Map(),
      finishedToolCalls: new Set(),
      textPartSnapshots: new Map(),
    }
    this.emitRuntimeThinking(sessionID, runState, "正在读取 Core 默认助手、角色与模型配置。")

    try {
      const runtimeConfig = await this.resolveRuntimeConfig(sessionID, authToken)
      const model = runtimeConfig.model
      await this.syncCoreSession(sessionID, authToken, runtimeConfig.core)
      await this.syncCoreMessage(sessionID, userMessage, authToken, runtimeConfig.core)
      this.logger.debug("运行模型已解析", {
        sessionID,
        workspaceRoot: this.workspaceRoot,
        source: runtimeConfig.source,
        model: runtimeConfig.label,
        modelReasoning: model.reasoning,
        thinkingLevel: runtimeConfig.thinkingLevel,
        supportsImages: runtimeConfig.supportsImages,
        visionConfig: runtimeConfig.core?.visionConfig
          ? `${runtimeConfig.core.visionConfig.vendor}/${runtimeConfig.core.visionConfig.vision_model}`
          : undefined,
        assistant: runtimeConfig.core?.assistant.name,
        character: runtimeConfig.core?.character.name,
        aiEntity: runtimeConfig.core?.aiEntity.ai_name,
      })
      this.emitRuntimeThinking(
        sessionID,
        runState,
        `已选择模型：${runtimeConfig.label}，配置来源：${
          runtimeConfig.source === "core" ? "Core" : "环境变量"
        }。思考通道：${model.reasoning && runtimeConfig.thinkingLevel !== "off" ? `已请求（${runtimeConfig.thinkingLevel}）` : "未请求"}。`,
      )
      const promptContent = contentText(parts)
      const files = promptFiles(parts)
      const tools = createMonAgentTools(this.workspaceRoot, {
        sessionID,
        coreClient: this.options.coreClient,
        coreToken: authToken,
        permissions: this.options.permissions,
        questions: this.options.questions,
        currentModelSupportsImages: runtimeConfig.supportsImages,
        visionConfig: runtimeConfig.core?.visionConfig,
        getMessageID: () => runState.assistantMessageID,
        getCurrentFiles: () => files,
      }, "user_chat")
      this.logger.info("本轮 Pi 工具已注册", {
        sessionID,
        count: tools.length,
        tools: tools.map((tool) => tool.name),
      })
      this.emitRuntimeThinking(
        sessionID,
        runState,
        `已注册 Pi 工具：${tools.length} 个（${tools.map((tool) => tool.name).join("、")}）。`,
      )
      const systemPrompt = this.buildSystemPrompt(runtimeConfig.core)
      const attachmentContext = buildAttachmentContext(files, runtimeConfig.supportsImages)
      const promptTextForModel = buildAgentTaskPrompt({
        source: "user_chat",
        text: promptContent,
        attachmentContext,
      })
      this.logger.info("本轮 Pi 上下文已准备", {
        sessionID,
        workspaceRoot: this.workspaceRoot,
        model: {
          source: runtimeConfig.source,
          label: runtimeConfig.label,
          id: model.id,
          provider: "provider" in model ? model.provider : undefined,
          api: "api" in model ? model.api : undefined,
          baseUrl: "baseUrl" in model ? model.baseUrl : undefined,
          reasoning: model.reasoning,
          thinkingLevel: runtimeConfig.thinkingLevel,
          supportsImages: runtimeConfig.supportsImages,
          hasApiKey: Boolean(runtimeConfig.apiKey),
        },
        core: runtimeConfig.core
          ? {
              assistantID: runtimeConfig.core.assistant.id,
              assistant: runtimeConfig.core.assistant.name,
              characterID: runtimeConfig.core.character.id,
              character: runtimeConfig.core.character.name,
              aiEntityID: runtimeConfig.core.aiEntity.id,
              aiEntity: runtimeConfig.core.aiEntity.ai_name,
              vendor: runtimeConfig.core.aiEntity.vendor,
              model: runtimeConfig.core.aiEntity.ai_model,
              isMultimodal: runtimeConfig.core.aiEntity.is_multimodal,
              visionConfig: runtimeConfig.core.visionConfig
                ? {
                    id: runtimeConfig.core.visionConfig.id,
                    name: runtimeConfig.core.visionConfig.vision_name,
                    vendor: runtimeConfig.core.visionConfig.vendor,
                    model: runtimeConfig.core.visionConfig.vision_model,
                    status: runtimeConfig.core.visionConfig.status,
                  }
                : undefined,
            }
          : undefined,
        systemPrompt,
        history: {
          total: session.agentMessages.length,
          shown: Math.min(session.agentMessages.length, 8),
          messages: summarizeAgentMessages(session.agentMessages),
        },
        currentPrompt: {
          text: truncateText(promptContent, 1200),
          files: files.map((file) => ({
            filename: file.filename,
            mime: file.mime,
            size: file.size,
            url: truncateText(file.url, 240),
          })),
          attachmentContext: truncateText(attachmentContext, 1200),
          taskPrompt: truncateText(promptTextForModel, 1200),
        },
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
      })
      const agent = new Agent({
        sessionId: sessionID,
        toolExecution: "sequential",
        initialState: {
          model,
          thinkingLevel: runtimeConfig.thinkingLevel,
          systemPrompt,
          tools,
          messages: session.agentMessages,
        },
        getApiKey: (provider) => runtimeConfig.apiKey ?? getEnvApiKey(provider),
        beforeToolCall: async ({ toolCall, args }) => {
          const pattern = this.permissionPattern(toolCall.name, args)
          if (this.isSafeTool(toolCall.name) || this.options.permissions.isAlwaysAllowed(toolCall.name, pattern)) {
            this.logger.info("工具已允许执行", { sessionID, tool: toolCall.name, pattern })
            return undefined
          }
          this.logger.warn("工具需要用户授权", { sessionID, tool: toolCall.name, pattern })
          const reply = await this.options.permissions.ask({
            sessionID,
            permission: toolCall.name,
            patterns: [pattern],
            always: this.permissionAlwaysPatterns(toolCall.name),
            metadata: {
              args,
              toolName: toolCall.name,
            },
            tool: runState.assistantMessageID
              ? {
                  messageID: runState.assistantMessageID,
                  callID: toolCall.id,
                }
              : undefined,
          })
          this.logger.info("工具授权已回复", { sessionID, tool: toolCall.name, pattern, reply })
          if (reply === "reject") {
            return { block: true, reason: "用户拒绝执行工具。" }
          }
          return undefined
        },
      })

      agent.subscribe(async (event) => {
        this.handleAgentEvent(sessionID, event, runState)
      })

      const content: AgentMessage = {
        role: "user",
        timestamp: userMessage.info.time.created,
        content: [
          ...(runtimeConfig.supportsImages ? toImages(parts) : []),
          ...(promptTextForModel ? [{ type: "text" as const, text: promptTextForModel }] : []),
        ],
      }

      this.emitRuntimeThinking(sessionID, runState, "正在发送给 Pi Agent，并等待模型回复。")
      await agent.prompt(content)
      this.options.store.setAgentMessages(sessionID, agent.state.messages)
      this.emitRuntimeThinking(sessionID, runState, "回复生成完成。", true)
      if (runState.assistantMessageID) {
        const assistantMessage = this.options.store
          .requireSession(sessionID)
          .messages.find((message) => message.info.id === runState.assistantMessageID)
        if (!assistantMessage) {
          throw new Error(`待同步消息不存在: ${runState.assistantMessageID}`)
        }
        await this.syncCoreMessage(sessionID, assistantMessage, authToken, runtimeConfig.core)
      }
      await this.syncCoreSession(sessionID, authToken, runtimeConfig.core)
      this.options.events.emit({ type: "session.status", properties: { sessionID, status: { type: "idle" } } })
      this.emitSession(sessionID)
      this.logger.info("提示词处理完成", { sessionID, durationMs: Date.now() - started })
    } catch (error) {
      this.emitRuntimeThinking(
        sessionID,
        runState,
        `运行失败：${error instanceof Error ? error.message : String(error)}`,
        true,
      )
      this.logger.error("提示词处理失败", error)
      this.emitSessionError(sessionID, error)
    }
  }

  private buildSystemPrompt(core?: CoreRuntimeConfig) {
    return buildAgentSystemPromptFromCore(core)
  }

  private async syncCoreSession(sessionID: string, authToken?: string | null, core?: CoreRuntimeConfig) {
    if (!authToken || !this.options.syncCoreSession) return
    try {
      await this.options.syncCoreSession(authToken, sessionID, core)
    } catch (error) {
      this.logger.error("同步 Agent 会话到 Core 失败", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async syncCoreMessage(
    sessionID: string,
    message: ApiMessage,
    authToken?: string | null,
    core?: CoreRuntimeConfig,
  ) {
    if (!authToken || !this.options.syncCoreMessage) return
    try {
      await this.options.syncCoreMessage(authToken, sessionID, message, core)
    } catch (error) {
      this.logger.error("同步 Agent 消息到 Core 失败", {
        sessionID,
        messageID: message.info.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private ensureAssistantMessage(sessionID: string, runState: RunState) {
    const messageID = runState.assistantMessageID ?? createID("msg")
    const created = runState.assistantCreatedAt ?? Date.now()
    runState.assistantMessageID = messageID
    runState.assistantCreatedAt = created

    const info: ApiMessageInfo = {
      id: messageID,
      role: "assistant",
      agent: "pi",
      time: {
        created,
      },
    }
    this.options.store.upsertMessage(sessionID, info)
    this.emitMessage(sessionID, info)
    return messageID
  }

  private emitRuntimeThinking(sessionID: string, runState: RunState, line: string, done = false) {
    const messageID = this.ensureAssistantMessage(sessionID, runState)
    const created = runState.assistantCreatedAt ?? Date.now()
    const text = line.trim()
    if (text) {
      runState.runtimeThinkingLines.push(text)
    }
    this.emitTextPart(sessionID, runState, {
      id: `${messageID}_runtime_thinking`,
      messageID,
      sessionID,
      type: "reasoning",
      text: runState.runtimeThinkingLines.join("\n"),
      source: "runtime",
      title: "运行过程",
      time: {
        start: created,
        end: done ? Date.now() : undefined,
      },
    })
  }

  private beginAssistantSegment(runState: RunState) {
    const index = runState.assistantNextSegmentIndex
    runState.assistantCurrentSegmentIndex = index
    runState.assistantNextSegmentIndex += 1
    return index
  }

  private ensureAssistantSegment(runState: RunState) {
    if (typeof runState.assistantCurrentSegmentIndex === "number") {
      return runState.assistantCurrentSegmentIndex
    }
    return this.beginAssistantSegment(runState)
  }

  private handleAgentEvent(sessionID: string, event: AgentEvent, runState: RunState) {
    if (event.type === "message_start" && event.message.role === "assistant") {
      runState.assistantMessageID = runState.assistantMessageID ?? createID("msg")
      runState.assistantCreatedAt = runState.assistantCreatedAt ?? event.message.timestamp ?? Date.now()
      const segmentIndex = this.beginAssistantSegment(runState)
      this.logger.info("助手消息开始", { sessionID, messageID: runState.assistantMessageID, segmentIndex })
      this.upsertAssistant(sessionID, event.message, runState, false)
      return
    }
    if (event.type === "message_update" && event.message.role === "assistant") {
      this.upsertAssistant(sessionID, event.message, runState, false)
      return
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      this.upsertAssistant(sessionID, event.message, runState, true)
      this.logger.info("助手消息结束", {
        sessionID,
        messageID: runState.assistantMessageID,
        segmentIndex: runState.assistantCurrentSegmentIndex,
      })
      if (event.message.errorMessage) {
        this.logger.error("助手消息发生错误", event.message.errorMessage)
        this.emitSessionError(sessionID, event.message.errorMessage)
      }
      return
    }
    if (event.type === "tool_execution_start") {
      runState.toolInputs.set(event.toolCallId, event.args)
      runState.toolStarts.set(event.toolCallId, Date.now())
      this.logger.info("工具开始执行", { sessionID, tool: event.toolName, callID: event.toolCallId })
      this.emitRuntimeThinking(sessionID, runState, `正在调用工具：${event.toolName}。`)
      if (runState.assistantMessageID) {
        this.emitToolPart(sessionID, runState.assistantMessageID, event.toolCallId, event.toolName, {
          status: "running",
          input: event.args,
          time: { start: runState.toolStarts.get(event.toolCallId) },
        })
      }
      return
    }
    if (event.type === "tool_execution_update") {
      if (runState.assistantMessageID) {
        this.emitToolPart(sessionID, runState.assistantMessageID, event.toolCallId, event.toolName, {
          status: "running",
          input: runState.toolInputs.get(event.toolCallId),
          time: { start: runState.toolStarts.get(event.toolCallId) },
        })
      }
      return
    }
    if (event.type === "tool_execution_end") {
      if (runState.assistantMessageID) {
        const started = runState.toolStarts.get(event.toolCallId)
        const body = textFromToolResult(event.result)
        const durationMs = started ? Date.now() - started : undefined
        const meta = { sessionID, tool: event.toolName, callID: event.toolCallId, durationMs }
        runState.finishedToolCalls.add(event.toolCallId)
        if (event.isError) {
          this.logger.error("工具执行失败", { ...meta, error: body || "工具执行失败。" })
          this.emitRuntimeThinking(sessionID, runState, `工具 ${event.toolName} 执行失败。`)
        } else {
          this.logger.info("工具执行完成", meta)
          this.emitRuntimeThinking(sessionID, runState, `工具 ${event.toolName} 执行完成。`)
        }
        this.emitToolPart(
          sessionID,
          runState.assistantMessageID,
          event.toolCallId,
          event.toolName,
          event.isError
            ? {
                status: "error",
                input: runState.toolInputs.get(event.toolCallId),
                error: body || "工具执行失败。",
                time: { start: started, end: Date.now() },
              }
            : {
                status: "completed",
                input: runState.toolInputs.get(event.toolCallId),
                output: body,
                time: { start: started, end: Date.now() },
              },
        )
      }
    }
  }

  private upsertAssistant(
    sessionID: string,
    message: Extract<AgentMessage, { role: "assistant" }>,
    runState: RunState,
    done: boolean,
  ) {
    const messageID = runState.assistantMessageID ?? createID("msg")
    runState.assistantMessageID = messageID
    const created = runState.assistantCreatedAt ?? message.timestamp ?? Date.now()
    runState.assistantCreatedAt = created
    const segmentIndex = this.ensureAssistantSegment(runState)
    const info: ApiMessageInfo = {
      id: messageID,
      role: "assistant",
      agent: "pi",
      modelID: message.model,
      providerID: message.provider,
      time: {
        created,
        completed: done ? Date.now() : undefined,
      },
      error: message.errorMessage ? { name: "AgentError", message: message.errorMessage } : undefined,
    }
    this.options.store.upsertMessage(sessionID, info)
    this.emitMessage(sessionID, info)
    for (const [index, block] of message.content.entries()) {
      if (block.type === "text") {
        this.emitTextPart(sessionID, runState, {
          id: `${messageID}_seg_${segmentIndex}_text_${index}`,
          messageID,
          sessionID,
          type: "text",
          text: block.text,
          time: { start: created, end: done ? Date.now() : undefined },
        })
      }
      if (block.type === "thinking") {
        this.emitTextPart(sessionID, runState, {
          id: `${messageID}_seg_${segmentIndex}_reasoning_${index}`,
          messageID,
          sessionID,
          type: "reasoning",
          text: block.thinking,
          source: "model",
          title: "思考",
          time: { start: created, end: done ? Date.now() : undefined },
        })
      }
      if (block.type === "toolCall") {
        if (runState.finishedToolCalls.has(block.id)) {
          continue
        }
        this.emitToolPart(sessionID, messageID, block.id, block.name, {
          status: "pending",
          input: block.arguments,
          time: { start: created },
        })
      }
    }
  }

  private emitToolPart(
    sessionID: string,
    messageID: string,
    toolCallID: string,
    toolName: string,
    state: ApiToolPart["state"],
  ) {
    this.emitPart(sessionID, {
      id: toolCallID,
      messageID,
      sessionID,
      type: "tool",
      tool: toolName,
      state,
    })
  }

  private emitMessage(sessionID: string, info: ApiMessageInfo) {
    this.options.events.emit({ type: "message.updated", properties: { sessionID, info } })
  }

  private emitPart(sessionID: string, part: ApiPart) {
    this.options.store.upsertPart(sessionID, part)
    this.options.events.emit({ type: "message.part.updated", properties: { sessionID, part, time: Date.now() } })
  }

  private emitTextPart(
    sessionID: string,
    runState: RunState,
    part: Extract<ApiPart, { type: "text" | "reasoning" }>,
  ) {
    this.options.store.upsertPart(sessionID, part)

    const previous = runState.textPartSnapshots.get(part.id)
    const done = Boolean(part.time?.end)
    runState.textPartSnapshots.set(part.id, part.text)

    if (!previous || done || !part.text.startsWith(previous)) {
      this.options.events.emit({ type: "message.part.updated", properties: { sessionID, part, time: Date.now() } })
      return
    }

    const delta = part.text.slice(previous.length)
    if (!delta) return

    this.options.events.emit({
      type: "message.part.delta",
      properties: {
        sessionID,
        messageID: part.messageID,
        partID: part.id,
        field: "text",
        delta,
        baseLength: previous.length,
        targetText: part.text,
        partType: part.type,
        source: part.type === "reasoning" ? part.source : undefined,
        title: part.type === "reasoning" ? part.title : undefined,
        time: part.time,
      },
    })
  }

  private emitSession(sessionID: string) {
    const session = this.options.store.requireSession(sessionID)
    this.options.events.emit({ type: "session.updated", properties: { sessionID, info: session.info } })
  }

  private emitSessionError(sessionID: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const authExpired = error instanceof CoreAuthenticationExpiredError
    this.logger.error("session 错误已发送", { sessionID, message })
    this.options.events.emit({
      type: "session.error",
      properties: {
        sessionID,
        error: {
          name: authExpired ? "CoreAuthenticationExpired" : "AgentError",
          message,
          data: {
            message,
            ...(authExpired
              ? {
                  code: "core_authentication_expired",
                  path: error.path,
                  status: error.status,
                }
              : {}),
          },
        },
      },
    })
    this.options.events.emit({ type: "session.status", properties: { sessionID, status: { type: "idle" } } })
  }

  private isSafeTool(toolName: string) {
    return (
      toolName === "read" ||
      toolName === "ls" ||
      toolName === "grep" ||
      toolName === "loaded_tools" ||
      toolName === "ask_user" ||
      toolName === "analyze_image"
    )
  }

  private permissionPattern(toolName: string, args: unknown) {
    if (typeof args === "object" && args) {
      const record = args as Record<string, unknown>
      if (typeof record.path === "string") return record.path
      if (typeof record.url === "string") return record.url
      if (typeof record.query === "string") return record.query
      if (typeof record.command === "string") return record.command
    }
    return toolName
  }

  private permissionAlwaysPatterns(toolName: string) {
    if (toolName === "web_search" || toolName === "web_fetch") {
      return ["*"]
    }
    return []
  }
}
