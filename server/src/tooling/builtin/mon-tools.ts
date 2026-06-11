import { Buffer } from "node:buffer"
import { readdir, readFile, stat, writeFile, mkdir, rename } from "node:fs/promises"
import path from "node:path"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import type { CoreClient, CoreMemo } from "../../core"
import type { PermissionBroker, QuestionBroker } from "../../interaction"

interface MonToolOptions {
  sessionID?: string
  coreClient?: CoreClient
  coreToken?: string | null
  permissions?: PermissionBroker
  questions?: QuestionBroker
  getMessageID?: () => string | undefined
  getCurrentFiles?: () => Array<{ url: string; filename?: string; mime: string; size?: number }>
}

function text(content: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text: content }],
    details,
  }
}

function truncate(content: string, max = 24_000) {
  if (content.length <= max) return content
  return `${content.slice(0, max)}\n\n[输出已截断，原始长度 ${content.length}]`
}

function resolvePathInfo(workspaceRoot: string, target: string) {
  const resolved = path.resolve(workspaceRoot, target)
  const relative = path.relative(workspaceRoot, resolved)
  return {
    resolved,
    insideWorkspace: relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
  }
}

function resolveInsideWorkspace(workspaceRoot: string, target: string) {
  const info = resolvePathInfo(workspaceRoot, target)
  if (info.insideWorkspace) return info.resolved
  throw new Error(`Path escapes workspace: ${target}`)
}

async function resolveReadablePath(
  workspaceRoot: string,
  target: string,
  options: MonToolOptions | undefined,
  input: { toolName: string; toolCallID: string; action: string },
) {
  const info = resolvePathInfo(workspaceRoot, target)
  if (info.insideWorkspace) return info.resolved

  const permission = "访问工作区外路径"
  const pattern = info.resolved
  if (options?.permissions?.isAlwaysAllowed(permission, pattern)) {
    return info.resolved
  }

  if (!options?.permissions || !options.sessionID) {
    throw new Error(`读取工作区外路径需要授权: ${target}`)
  }

  const messageID = options.getMessageID?.()
  const reply = await options.permissions.ask({
    sessionID: options.sessionID,
    permission,
    patterns: [pattern],
    metadata: {
      action: input.action,
      toolName: input.toolName,
      path: info.resolved,
      workspaceRoot,
      reason: "模型请求访问当前 MonAgent 工作区之外的路径，需要你确认。",
    },
    tool: messageID
      ? {
          messageID,
          callID: input.toolCallID,
        }
      : undefined,
  })

  if (reply === "reject") {
    throw new Error(`用户拒绝访问工作区外路径: ${target}`)
  }

  return info.resolved
}

function normalizeOutput(stdout: string, stderr: string) {
  const parts = []
  if (stdout.trim()) parts.push(stdout.trimEnd())
  if (stderr.trim()) parts.push(`[stderr]\n${stderr.trimEnd()}`)
  return parts.join("\n\n") || "(no output)"
}

function stringifyJson(value: unknown) {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function requireCoreMemoAccess(options: MonToolOptions) {
  if (!options.coreClient || !options.coreToken) {
    throw new Error("备忘录工具需要 Core 登录态。请确认本轮请求携带 Core Token。")
  }
  return {
    coreClient: options.coreClient,
    coreToken: options.coreToken,
  }
}

function normalizeMemoDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string") throw new Error(`${field} 必须是日期时间字符串。`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`无法解析 ${field}: ${value}`)
  }
  return date.toISOString()
}

function memoLine(memo: CoreMemo) {
  const trigger = memo.trigger_at || memo.remind_at || memo.due_at || "-"
  const content = memo.content ? `\n   ${memo.content}` : ""
  return [
    `#${memo.id} ${memo.title}`,
    `   类型: ${memo.kind} | 状态: ${memo.status} | 优先级: ${memo.priority}`,
    `   触发/截止: ${trigger}`,
    content,
  ]
    .filter(Boolean)
    .join("\n")
}

function formatMemoList(title: string, memos: CoreMemo[]) {
  if (!memos.length) return `${title}\n暂无记录。`
  return `${title}\n\n${memos.map(memoLine).join("\n\n")}`
}

async function pathExists(target: string) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function findMonRoot(workspaceRoot: string) {
  let current = path.resolve(workspaceRoot)
  for (let index = 0; index < 8; index += 1) {
    if (await pathExists(path.join(current, "Backend", "BaseOs", ".monconfig"))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`无法从工作区定位 Mon 根目录: ${workspaceRoot}`)
}

function readIniValue(content: string, section: string, key: string) {
  let currentSection = ""
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || line.startsWith(";")) continue
    const sectionMatch = line.match(/^\[([^\]]+)]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]?.trim() ?? ""
      continue
    }
    if (currentSection !== section) continue
    const eqIndex = line.indexOf("=")
    if (eqIndex < 0) continue
    const itemKey = line.slice(0, eqIndex).trim()
    if (itemKey !== key) continue
    return line.slice(eqIndex + 1).trim()
  }
  return undefined
}

function parseConfigNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function resolveSelfAwakeStatePath(workspaceRoot: string) {
  const monRoot = await findMonRoot(workspaceRoot)
  const baseOsRoot = path.join(monRoot, "Backend", "BaseOs")
  const monConfigPath = path.join(baseOsRoot, ".monconfig")
  const config = await readFile(monConfigPath, "utf8").catch(() => "")
  const dataDir = readIniValue(config, "self_awake", "DATA_DIR") || "Data/SelfAwake"
  const statePath = path.join(path.isAbsolute(dataDir) ? dataDir : path.join(baseOsRoot, dataDir), "state.json")
  return {
    monRoot,
    baseOsRoot,
    statePath,
    minMinutes: parseConfigNumber(readIniValue(config, "self_awake", "MIN_WAKE_MINUTES"), 1),
    maxMinutes: parseConfigNumber(readIniValue(config, "self_awake", "MAX_WAKE_MINUTES"), 1440),
  }
}

function parseJsonRecord(raw: string) {
  if (!raw.trim()) return {}
  try {
    const data = JSON.parse(raw)
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function resolveWakeTime(input: { after_minutes?: number; at?: string }, minMinutes: number, maxMinutes: number) {
  const now = new Date()
  if (input.at?.trim()) {
    const at = new Date(input.at)
    if (!Number.isFinite(at.getTime())) {
      throw new Error(`无法解析自醒时间: ${input.at}`)
    }
    const afterMinutes = Math.ceil((at.getTime() - now.getTime()) / 60_000)
    if (afterMinutes < minMinutes) {
      throw new Error(`自醒时间过近，至少需要 ${minMinutes} 分钟后。`)
    }
    if (afterMinutes > maxMinutes) {
      throw new Error(`自醒时间过远，最多允许 ${maxMinutes} 分钟后。`)
    }
    return { nextWakeAt: at, afterMinutes }
  }

  const rawMinutes = Number(input.after_minutes ?? 720)
  if (!Number.isFinite(rawMinutes)) {
    throw new Error("after_minutes 必须是有效数字。")
  }
  const afterMinutes = Math.min(Math.max(Math.round(rawMinutes), minMinutes), maxMinutes)
  return {
    nextWakeAt: new Date(now.getTime() + afterMinutes * 60_000),
    afterMinutes,
  }
}

interface DuckSearchResult {
  title: string
  url: string
  snippet?: string
  hostname?: string
}

function cleanSearchText(value: string) {
  return htmlToText(value).replace(/\s+/g, " ").trim()
}

function normalizeDuckRegion(language?: string) {
  const value = language?.trim().toLowerCase()
  if (!value) return "cn-zh"
  if (value === "zh" || value === "zh-cn" || value === "zh_cn") return "cn-zh"
  if (value === "zh-tw" || value === "zh_tw") return "tw-zh"
  if (value === "en" || value === "en-us" || value === "en_us") return "us-en"
  if (/^[a-z]{2}-[a-z]{2}$/.test(value)) {
    const [languageCode, regionCode] = value.split("-")
    return `${regionCode}-${languageCode}`
  }
  return value
}

function normalizeDuckTimeRange(value?: string) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized || normalized === "all" || normalized === "any") return undefined
  if (normalized === "day" || normalized === "d") return "d"
  if (normalized === "week" || normalized === "w") return "w"
  if (normalized === "month" || normalized === "m") return "m"
  if (normalized === "year" || normalized === "y") return "y"
  return normalized
}

function normalizeDuckSafeSearch(value?: number) {
  if (value === 0) return "-2"
  if (value === 2) return "1"
  return "-1"
}

function searchTimeoutMs() {
  const parsed = Number(process.env.MON_AGENT_SEARCH_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.round(parsed) : 20_000
}

function normalizeDuckUrl(rawUrl: string) {
  const decoded = decodeHtmlEntities(rawUrl.trim())
  const urlText = decoded.startsWith("//") ? `https:${decoded}` : decoded
  try {
    const url = new URL(urlText)
    const redirected = url.searchParams.get("uddg")
    return redirected ? decodeURIComponent(redirected) : url.toString()
  } catch {
    return decoded
  }
}

function parseDuckSearchResults(html: string, maxResults: number): DuckSearchResult[] {
  const results: DuckSearchResult[] = []
  for (const block of html.split(/<div class="result results_links/i).slice(1)) {
    const titleMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue

    const title = cleanSearchText(titleMatch[2] ?? "")
    const url = normalizeDuckUrl(titleMatch[1] ?? "")
    if (!title || !url) continue

    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
    const hostMatch = block.match(/<a[^>]+class="result__url"[^>]*>([\s\S]*?)<\/a>/i)
    results.push({
      title,
      url,
      snippet: snippetMatch ? cleanSearchText(snippetMatch[1] ?? "") : undefined,
      hostname: hostMatch ? cleanSearchText(hostMatch[1] ?? "") : undefined,
    })
    if (results.length >= maxResults) break
  }
  return results
}

function formatDuckSearch(query: string, results: DuckSearchResult[]) {
  if (!results.length) {
    return `DuckDuckGo 未返回可解析的搜索结果。\n查询: ${query}`
  }

  return [
    `DuckDuckGo 搜索结果：${query}`,
    results
      .map((item, index) =>
        [
          `${index + 1}. ${item.title}`,
          `   URL: ${item.url}`,
          item.snippet ? `   摘要: ${item.snippet}` : "",
          item.hostname ? `   来源: ${item.hostname}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n"),
  ].join("\n\n")
}

async function searchDuckDuckGo(input: {
  query: string
  maxResults: number
  language?: string
  timeRange?: string
  safeSearch?: number
  signal?: AbortSignal
}) {
  const url = new URL("https://html.duckduckgo.com/html/")
  url.searchParams.set("q", input.query)
  url.searchParams.set("kl", normalizeDuckRegion(input.language))
  url.searchParams.set("kp", normalizeDuckSafeSearch(input.safeSearch))
  const timeRange = normalizeDuckTimeRange(input.timeRange)
  if (timeRange) url.searchParams.set("df", timeRange)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), searchTimeoutMs())
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true })

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": input.language || "zh-CN,zh;q=0.9,en;q=0.6",
        "user-agent": "Mozilla/5.0 MonAgent/1.0",
      },
      signal: controller.signal,
    })
  } catch (error) {
    throw new Error(`DuckDuckGo 搜索请求失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timeout)
  }
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(
      [
        `DuckDuckGo 搜索失败: ${response.status} ${response.statusText}`,
        `入口: ${url.toString()}`,
        raw ? `响应: ${truncate(raw, 1200)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  if (/anomalyDetectionBlock|detected an anomaly|机器人|captcha/i.test(raw)) {
    throw new Error("DuckDuckGo 拒绝了本次搜索请求，可能是短时间请求过多或网络出口被限制。")
  }

  return {
    endpoint: url.toString(),
    results: parseDuckSearchResults(raw, input.maxResults),
  }
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    const lowered = entity.toLowerCase()
    if (lowered.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lowered.slice(2), 16))
    if (lowered.startsWith("#")) return String.fromCodePoint(Number.parseInt(lowered.slice(1), 10))
    return named[lowered] ?? `&${entity};`
  })
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "\n")
      .replace(/<(br|p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  )
}

function htmlTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ").trim()) : undefined
}

async function fetchWebPage(urlText: string, signal?: AbortSignal) {
  const url = new URL(urlText)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`只支持 http/https URL: ${urlText}`)
  }
  const response = await fetch(url, {
    headers: {
      accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.2",
      "user-agent": "MonAgent/1.0",
    },
    signal,
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`网页抓取失败: ${response.status} ${response.statusText}\nURL: ${urlText}\n${truncate(raw, 1200)}`)
  }

  const contentType = response.headers.get("content-type") ?? ""
  const body = contentType.includes("html") ? htmlToText(raw) : raw
  return {
    url: response.url,
    contentType,
    title: contentType.includes("html") ? htmlTitle(raw) : undefined,
    body,
  }
}

function mimeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  const known: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
  }
  return known[ext] ?? "application/octet-stream"
}

function imageFromDataUrl(url: string, fallbackMime = "image/png") {
  const match = url.match(/^data:([^;,]+);base64,(.*)$/)
  if (!match) return undefined
  return {
    mimeType: match[1] || fallbackMime,
    data: match[2] || "",
  }
}

function createWebSearchTool(name: string, label: string, description: string): AgentTool {
  return {
    name,
    label,
    description,
    parameters: Type.Object({
      query: Type.String({ description: "搜索关键词。" }),
      max_results: Type.Optional(Type.Number({ description: "最多返回多少条结果，默认 5，最大 10。" })),
      language: Type.Optional(Type.String({ description: "搜索地区/语言，默认 zh-CN。" })),
      time_range: Type.Optional(Type.String({ description: "时间范围，例如 day、week、month、year。" })),
      safesearch: Type.Optional(Type.Number({ description: "安全搜索等级，0 关闭，1 中等，2 严格。" })),
    }),
    async execute(_toolCallID, rawInput, signal) {
      const input = rawInput as {
        query: string
        max_results?: number
        language?: string
        time_range?: string
        safesearch?: number
      }
      const maxResults = Math.min(Math.max(Math.round(input.max_results ?? 5), 1), 10)
      const result = await searchDuckDuckGo({
        query: input.query,
        maxResults,
        language: input.language,
        timeRange: input.time_range,
        safeSearch: input.safesearch,
        signal,
      })
      const body = truncate(formatDuckSearch(input.query, result.results), 20_000)
      return text(body, {
        provider: "duckduckgo",
        endpoint: result.endpoint,
        query: input.query,
        max_results: maxResults,
        results: result.results,
      })
    },
  }
}

export function createMonTools(workspaceRoot: string, options: MonToolOptions = {}): AgentTool[] {
  const tools: AgentTool[] = [
    {
      name: "loaded_tools",
      label: "已加载工具",
      description: "查看本轮 MonAgent 已注册的工具清单、用途和执行策略。",
      parameters: Type.Object({}),
      async execute() {
        const lines = tools.map((tool, index) =>
          [
            `${index + 1}. ${tool.name}`,
            `   名称: ${tool.label}`,
            `   用途: ${tool.description}`,
            tool.executionMode ? `   执行: ${tool.executionMode}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        return text(lines.join("\n\n"), {
          count: tools.length,
          tools: tools.map((tool) => ({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            executionMode: tool.executionMode,
          })),
        })
      },
    },
    createWebSearchTool("web_search", "网页搜索", "使用 DuckDuckGo 搜索实时网页信息，不需要本地搜索服务。"),
    {
      name: "web_fetch",
      label: "网页抓取",
      description: "直接抓取网页并提取正文文本。",
      parameters: Type.Object({
        url: Type.String({ description: "要抓取的网页 URL。" }),
        max_chars: Type.Optional(Type.Number({ description: "最多返回多少字符，默认 28000。" })),
      }),
      async execute(_toolCallID, rawInput, signal) {
        const input = rawInput as { url: string; max_chars?: number }
        const maxChars = Math.min(Math.max(Math.round(input.max_chars ?? 28_000), 2_000), 60_000)
        const result = await fetchWebPage(input.url, signal)
        const body = truncate(`${result.title ? `标题: ${result.title}\n\n` : ""}${result.body}`, maxChars)
        return text(body, {
          provider: "direct",
          url: input.url,
          final_url: result.url,
          content_type: result.contentType,
          max_chars: maxChars,
        })
      },
    },
    {
      name: "analyze_image",
      label: "图片分析",
      description: "把本轮附件图片或指定路径图片交给当前视觉模型分析。路径在工作区外时需要用户授权。",
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: "图片路径。可以是工作区相对路径，也可以是绝对路径。" })),
        attachment_index: Type.Optional(Type.Number({ description: "使用本轮上传附件中的第几张图片，序号从 1 开始。" })),
        question: Type.Optional(Type.String({ description: "希望模型重点观察的问题。" })),
      }),
      async execute(toolCallID, rawInput) {
        const input = rawInput as { path?: string; attachment_index?: number; question?: string }
        const question = input.question?.trim() || "请分析这张图片。"

        let mimeType = "image/png"
        let data = ""
        let source = ""

        if (input.path) {
          const filePath = await resolveReadablePath(workspaceRoot, input.path, options, {
            toolName: "analyze_image",
            toolCallID,
            action: "读取图片",
          })
          mimeType = mimeFromPath(filePath)
          if (!mimeType.startsWith("image/")) {
            throw new Error(`不是支持的图片类型: ${filePath}`)
          }
          data = Buffer.from(await readFile(filePath)).toString("base64")
          source = filePath
        } else {
          const files = options.getCurrentFiles?.() ?? []
          const imageFiles = files.filter((file) => file.mime.startsWith("image/"))
          const index = Math.max(Math.round(input.attachment_index ?? 1) - 1, 0)
          const file = imageFiles[index]
          if (!file) {
            throw new Error("本轮消息中没有可分析的图片附件。请先上传图片，或传入 path。")
          }
          const image = imageFromDataUrl(file.url, file.mime)
          if (!image) {
            throw new Error(`图片附件不是 data URL，暂时无法直接交给模型分析: ${file.filename ?? "未命名图片"}`)
          }
          mimeType = image.mimeType
          data = image.data
          source = file.filename ?? `附件图片 ${index + 1}`
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `请根据图片回答：${question}`,
            },
            {
              type: "image" as const,
              mimeType,
              data,
            },
          ],
          details: {
            source,
            mimeType,
            question,
          },
        }
      },
    },
    {
      name: "ask_user",
      label: "询问用户",
      description:
        "当缺少关键信息、需要用户选择方案或继续执行前需要确认边界时，向用户展示问题卡片并等待回答。需要用户回答时应调用此工具，不要只在正文里提问。",
      parameters: Type.Object({
        question: Type.String({ description: "要询问用户的问题。" }),
        header: Type.Optional(Type.String({ description: "问题分组标题，建议 12 个字以内。" })),
        options: Type.Optional(
          Type.Array(
            Type.Object({
              label: Type.String({ description: "选项标题。" }),
              description: Type.Optional(Type.String({ description: "选项说明。" })),
            }),
          ),
        ),
        multiple: Type.Optional(Type.Boolean({ description: "是否允许多选。" })),
        allow_custom: Type.Optional(Type.Boolean({ description: "是否允许用户输入自定义回答，默认允许。" })),
      }),
      executionMode: "sequential",
      async execute(toolCallID, rawInput) {
        const input = rawInput as {
          question: string
          header?: string
          options?: Array<{ label: string; description?: string }>
          multiple?: boolean
          allow_custom?: boolean
        }
        if (!options.questions || !options.sessionID) {
          throw new Error("ask_user 需要在会话运行时中调用。")
        }

        const messageID = options.getMessageID?.()
        const answers = await options.questions.ask({
          sessionID: options.sessionID,
          questions: [
            {
              header: input.header || "需要确认",
              question: input.question,
              options: (input.options ?? []).map((option) => ({
                label: option.label,
                description: option.description ?? option.label,
              })),
              multiple: Boolean(input.multiple),
              custom: input.allow_custom ?? true,
            },
          ],
          tool: messageID
            ? {
                messageID,
                callID: toolCallID,
              }
            : undefined,
        })

        if (!answers) {
          throw new Error("用户暂不处理该问题。")
        }
        const flattened = answers.flat().filter(Boolean)
        return text(flattened.join("\n") || "用户未提供回答。", {
          answers,
        })
      },
    },
    {
      name: "set_self_awake_timer",
      label: "设置自醒定时器",
      description:
        "调用 MonOs 自醒定时器，设置下一次后台自醒时间。可传 after_minutes 或 at；自醒任务应在决定下次醒来时调用此工具。",
      parameters: Type.Object({
        after_minutes: Type.Optional(Type.Number({ description: "多少分钟后再次自醒。默认 720，受 MonOs 最小/最大范围约束。" })),
        at: Type.Optional(Type.String({ description: "下一次自醒的 ISO 时间字符串。传入后优先于 after_minutes。" })),
        reason: Type.Optional(Type.String({ description: "设置这个自醒时间的原因。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { after_minutes?: number; at?: string; reason?: string }
        const timer = await resolveSelfAwakeStatePath(workspaceRoot)
        const wake = resolveWakeTime(input, timer.minMinutes, timer.maxMinutes)
        const now = new Date()
        const reason = input.reason?.trim() || "Agent 设置下一次自醒时间。"

        await mkdir(path.dirname(timer.statePath), { recursive: true })
        const state = parseJsonRecord(await readFile(timer.statePath, "utf8").catch(() => ""))
        state.enabled = true
        state.next_wake_at = wake.nextWakeAt.toISOString()
        state.next_wake_after_minutes = wake.afterMinutes
        state.next_wake_reason = reason
        state.last_timer_tool_at = now.toISOString()
        state.last_timer_tool_source = "monagent"

        const tmpPath = `${timer.statePath}.tmp`
        await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
        await rename(tmpPath, timer.statePath)

        return text(
          [
            "已调用 MonOs 自醒定时器。",
            `下次自醒: ${wake.nextWakeAt.toISOString()}`,
            `间隔: ${wake.afterMinutes} 分钟`,
            `原因: ${reason}`,
          ].join("\n"),
          {
            next_wake_at: wake.nextWakeAt.toISOString(),
            after_minutes: wake.afterMinutes,
            reason,
            state_path: timer.statePath,
          },
        )
      },
    },
    {
      name: "create_memo",
      label: "创建备忘录",
      description: "在 MonCore 创建一条用户备忘录、待办或提醒。普通记录用 note，需要未来触发时用 reminder 或 todo。",
      parameters: Type.Object({
        title: Type.String({ description: "简短标题。" }),
        content: Type.Optional(Type.String({ description: "详细内容。" })),
        kind: Type.Optional(Type.String({ description: "类型：note、reminder 或 todo，默认 note。" })),
        priority: Type.Optional(Type.String({ description: "优先级：low、normal 或 high，默认 normal。" })),
        remind_at: Type.Optional(Type.String({ description: "提醒时间，建议 ISO 字符串或可解析的本地时间字符串。" })),
        due_at: Type.Optional(Type.String({ description: "截止时间，建议 ISO 字符串或可解析的本地时间字符串。" })),
        repeat_rule: Type.Optional(Type.String({ description: "重复规则，MVP 阶段可留空。" })),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "扩展数据。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as {
          title: string
          content?: string
          kind?: CoreMemo["kind"]
          priority?: CoreMemo["priority"]
          remind_at?: string
          due_at?: string
          repeat_rule?: string
          metadata?: Record<string, unknown>
        }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.createMemo(coreToken, {
          title: input.title,
          content: input.content ?? "",
          kind: input.kind ?? "note",
          priority: input.priority ?? "normal",
          remind_at: normalizeMemoDate(input.remind_at, "remind_at"),
          due_at: normalizeMemoDate(input.due_at, "due_at"),
          repeat_rule: input.repeat_rule ?? "",
          source: "monagent",
          related_session_id: options.sessionID ?? "",
          metadata: input.metadata ?? {},
        })
        return text(`已创建备忘录。\n\n${memoLine(memo)}`, { memo })
      },
    },
    {
      name: "create_reminder",
      label: "创建提醒",
      description: "在 MonCore 创建一条会在指定时间触发的提醒。用户说“提醒我”时优先使用此工具。",
      parameters: Type.Object({
        title: Type.String({ description: "提醒标题。" }),
        remind_at: Type.String({ description: "提醒时间，建议 ISO 字符串。必须明确。" }),
        content: Type.Optional(Type.String({ description: "提醒详情。" })),
        priority: Type.Optional(Type.String({ description: "优先级：low、normal 或 high，默认 normal。" })),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "扩展数据。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as {
          title: string
          remind_at: string
          content?: string
          priority?: CoreMemo["priority"]
          metadata?: Record<string, unknown>
        }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.createMemo(coreToken, {
          title: input.title,
          content: input.content ?? "",
          kind: "reminder",
          priority: input.priority ?? "normal",
          remind_at: normalizeMemoDate(input.remind_at, "remind_at"),
          source: "monagent",
          related_session_id: options.sessionID ?? "",
          metadata: input.metadata ?? {},
        })
        return text(`已创建提醒。\n\n${memoLine(memo)}`, { memo })
      },
    },
    {
      name: "list_memos",
      label: "查询备忘录",
      description: "查询当前用户的备忘录、提醒和待办，可按状态、类型、关键词筛选。",
      parameters: Type.Object({
        kind: Type.Optional(Type.String({ description: "类型筛选：note、reminder 或 todo。" })),
        status: Type.Optional(Type.String({ description: "状态筛选：active、done、archived 或 cancelled。" })),
        priority: Type.Optional(Type.String({ description: "优先级筛选：low、normal 或 high。" })),
        q: Type.Optional(Type.String({ description: "标题或正文关键词。" })),
        limit: Type.Optional(Type.Number({ description: "最多返回多少条，默认 20。" })),
      }),
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { kind?: string; status?: string; priority?: string; q?: string; limit?: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memos = await coreClient.listMemos(coreToken, {
          ...input,
          limit: Math.min(Math.max(Math.round(input.limit ?? 20), 1), 100),
        })
        return text(formatMemoList("备忘录查询结果：", memos), { memos, count: memos.length })
      },
    },
    {
      name: "list_due_memos",
      label: "查询到期提醒",
      description: "兼容工具：查询当前时间之前应触发但尚未标记触发的提醒/待办。新的后台流程优先使用 dispatch_due_memos。",
      parameters: Type.Object({
        before: Type.Optional(Type.String({ description: "查询这个时间之前的到期项，默认当前时间。" })),
        limit: Type.Optional(Type.Number({ description: "最多返回多少条，默认 20。" })),
      }),
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { before?: string; limit?: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memos = await coreClient.listDueMemos(coreToken, {
          before: normalizeMemoDate(input.before, "before"),
          limit: Math.min(Math.max(Math.round(input.limit ?? 20), 1), 100),
        })
        return text(formatMemoList("到期提醒：", memos), { memos, count: memos.length })
      },
    },
    {
      name: "dispatch_due_memos",
      label: "派发到期提醒",
      description:
        "按时间索引取出已到期且尚未派发的提醒/待办，并返回下一次应唤醒时间。后台自醒到点后优先调用此工具。",
      parameters: Type.Object({
        before: Type.Optional(Type.String({ description: "派发这个时间之前的到期项，默认当前时间。" })),
        limit: Type.Optional(Type.Number({ description: "最多派发多少条，默认 20。" })),
        mark_dispatched: Type.Optional(Type.Boolean({ description: "是否立即标记为已派发，默认 false。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { before?: string; limit?: number; mark_dispatched?: boolean }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const result = await coreClient.dispatchDueMemos(coreToken, {
          before: normalizeMemoDate(input.before, "before"),
          limit: Math.min(Math.max(Math.round(input.limit ?? 20), 1), 100),
          mark_dispatched: Boolean(input.mark_dispatched),
        })
        const body = [
          formatMemoList("到期派发结果：", result.memos),
          `派发数量: ${result.dispatched_count}`,
          `已标记派发: ${result.mark_dispatched ? "是" : "否"}`,
          `下一次唤醒: ${result.next_wake_at || "-"}`,
        ].join("\n\n")
        return text(body, { ...result })
      },
    },
    {
      name: "get_next_memo_wake",
      label: "获取下一次提醒唤醒",
      description: "获取当前用户下一条未派发提醒/待办的触发时间，用于设置 MonOs 下一次自醒。",
      parameters: Type.Object({
        after: Type.Optional(Type.String({ description: "从这个时间之后查找，默认当前时间。" })),
      }),
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { after?: string }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const result = await coreClient.getNextMemoWake(coreToken, {
          after: normalizeMemoDate(input.after, "after"),
        })
        const body = result.memo
          ? [`下一次提醒唤醒: ${result.next_wake_at}`, "", memoLine(result.memo)].join("\n")
          : "当前没有需要安排唤醒的提醒/待办。"
        return text(body, result as unknown as Record<string, unknown>)
      },
    },
    {
      name: "complete_memo",
      label: "完成备忘录",
      description: "将一条备忘录或待办标记为已完成。",
      parameters: Type.Object({
        id: Type.Number({ description: "备忘录 ID。" }),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { id: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.completeMemo(coreToken, input.id)
        return text(`已完成备忘录。\n\n${memoLine(memo)}`, { memo })
      },
    },
    {
      name: "snooze_memo",
      label: "稍后提醒",
      description: "把一条备忘录/提醒推迟到稍后再次触发。",
      parameters: Type.Object({
        id: Type.Number({ description: "备忘录 ID。" }),
        until: Type.Optional(Type.String({ description: "推迟到的时间，优先于 minutes。" })),
        minutes: Type.Optional(Type.Number({ description: "从现在起推迟多少分钟。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { id: number; until?: string; minutes?: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.snoozeMemo(coreToken, input.id, {
          until: normalizeMemoDate(input.until, "until"),
          minutes: input.minutes,
        })
        return text(`已设置稍后提醒。\n\n${memoLine(memo)}`, { memo })
      },
    },
    {
      name: "mark_memo_triggered",
      label: "标记提醒已触发",
      description: "将一条到期提醒标记为已触发，避免后台重复提醒。",
      parameters: Type.Object({
        id: Type.Number({ description: "备忘录 ID。" }),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { id: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.markMemoTriggered(coreToken, input.id)
        return text(`已标记提醒触发。\n\n${memoLine(memo)}`, { memo })
      },
    },
    {
      name: "read",
      label: "read",
      description: "读取 UTF-8 文本文件。工作区内自动读取，工作区外路径需要用户授权。",
      parameters: Type.Object({
        path: Type.String({ description: "工作区内的相对路径或绝对路径。" }),
        offset: Type.Optional(Type.Number({ description: "从第几行开始读取，行号从 1 开始。" })),
        limit: Type.Optional(Type.Number({ description: "最多读取多少行。" })),
      }),
      async execute(toolCallID, rawInput) {
        const input = rawInput as { path: string; offset?: number; limit?: number }
        const filePath = await resolveReadablePath(workspaceRoot, input.path, options, {
          toolName: "read",
          toolCallID,
          action: "读取文件",
        })
        const raw = await readFile(filePath, "utf8")
        const lines = raw.split(/\r?\n/)
        const start = Math.max(0, (input.offset ?? 1) - 1)
        const end = input.limit ? start + input.limit : Math.min(lines.length, start + 300)
        const body = lines.slice(start, end).join("\n")
        const suffix = end < lines.length ? `\n\n[truncated: showing lines ${start + 1}-${end} of ${lines.length}]` : ""
        return text(body + suffix, { path: filePath, totalLines: lines.length })
      },
    },
    {
      name: "ls",
      label: "ls",
      description: "列出文件和目录。工作区内自动列出，工作区外路径需要用户授权。",
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: "工作区内的目录路径。" })),
      }),
      async execute(toolCallID, rawInput) {
        const input = rawInput as { path?: string }
        const dirPath = await resolveReadablePath(workspaceRoot, input.path ?? ".", options, {
          toolName: "ls",
          toolCallID,
          action: "列出目录",
        })
        const entries = await readdir(dirPath, { withFileTypes: true })
        const lines = await Promise.all(
          entries.map(async (entry) => {
            const entryPath = path.join(dirPath, entry.name)
            const info = await stat(entryPath).catch(() => undefined)
            const kind = entry.isDirectory() ? "dir " : "file"
            return `${kind} ${entry.name}${info && !entry.isDirectory() ? ` ${info.size}B` : ""}`
          }),
        )
        return text(lines.join("\n") || "(empty)", { path: dirPath })
      },
    },
    {
      name: "grep",
      label: "grep",
      description: "使用 ripgrep 搜索文本。工作区内自动搜索，工作区外路径需要用户授权。",
      parameters: Type.Object({
        pattern: Type.String({ description: "搜索关键词或正则表达式。" }),
        path: Type.Optional(Type.String({ description: "工作区内的搜索路径。" })),
        glob: Type.Optional(Type.String({ description: "可选的 glob 文件过滤条件。" })),
      }),
      async execute(toolCallID, rawInput, signal) {
        const input = rawInput as { pattern: string; path?: string; glob?: string }
        const searchPath = await resolveReadablePath(workspaceRoot, input.path ?? ".", options, {
          toolName: "grep",
          toolCallID,
          action: "搜索文本",
        })
        const args = ["--line-number", "--color", "never", "--max-count", "200"]
        if (input.glob) args.push("--glob", input.glob)
        args.push(input.pattern, searchPath)
        const proc = Bun.spawn(["rg", ...args], { stdout: "pipe", stderr: "pipe", signal })
        const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
        await proc.exited
        return text(normalizeOutput(stdout, stderr), { path: searchPath, pattern: input.pattern })
      },
    },
    {
      name: "write",
      label: "write",
      description: "在当前工作区内写入 UTF-8 文本文件。",
      parameters: Type.Object({
        path: Type.String({ description: "工作区内的相对路径或绝对路径。" }),
        content: Type.String({ description: "要写入的文件内容。" }),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, rawInput) {
        const input = rawInput as { path: string; content: string }
        const filePath = resolveInsideWorkspace(workspaceRoot, input.path)
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, input.content, "utf8")
        return text(`Wrote ${input.content.length} characters to ${filePath}`, { path: filePath })
      },
    },
    {
      name: "shell",
      label: "shell",
      description: "在当前工作区内运行 shell 命令。",
      parameters: Type.Object({
        command: Type.String({ description: "要运行的命令。" }),
        timeoutMs: Type.Optional(Type.Number({ description: "超时时间，单位毫秒。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, rawInput, signal) {
        const input = rawInput as { command: string; timeoutMs?: number }
        const timeout = Math.min(Math.max(input.timeoutMs ?? 30000, 1000), 120000)
        const command =
          process.platform === "win32"
            ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", input.command]
            : ["bash", "-lc", input.command]
        const controller = new AbortController()
        signal?.addEventListener("abort", () => controller.abort(), { once: true })
        const timer = setTimeout(() => controller.abort(), timeout)
        try {
          const proc = Bun.spawn(command, {
            cwd: workspaceRoot,
            stdout: "pipe",
            stderr: "pipe",
            signal: controller.signal,
          })
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ])
          const output = normalizeOutput(stdout, stderr)
          return text(output, { command: input.command, exitCode })
        } finally {
          clearTimeout(timer)
        }
      },
    },
  ]
  return tools
}
