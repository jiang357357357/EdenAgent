import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { CoreClient, CoreMemo, CoreVisionConfig } from "../../core"
import type { PermissionBroker, QuestionBroker } from "../../interaction"
import { formatLocalDateTimeWithZone, localTimeZoneLabel, toStorageIso } from "../../shared/time"

export interface MonToolOptions {
  sessionID?: string
  coreClient?: CoreClient
  coreToken?: string | null
  permissions?: PermissionBroker
  questions?: QuestionBroker
  currentModelSupportsImages?: boolean
  visionConfig?: CoreVisionConfig | null
  getMessageID?: () => string | undefined
  getCurrentFiles?: () => Array<{ url: string; filename?: string; mime: string; size?: number }>
}

export function text(content: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text: content }],
    details,
  }
}

export function truncate(content: string, max = 24_000) {
  if (content.length <= max) return content
  return `${content.slice(0, max)}\n\n[输出已截断，原始长度 ${content.length}]`
}

export function resolvePathInfo(workspaceRoot: string, target: string) {
  const resolved = path.resolve(workspaceRoot, target)
  const relative = path.relative(workspaceRoot, resolved)
  return {
    resolved,
    insideWorkspace: relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
  }
}

export function resolveInsideWorkspace(workspaceRoot: string, target: string) {
  const info = resolvePathInfo(workspaceRoot, target)
  if (info.insideWorkspace) return info.resolved
  throw new Error(`Path escapes workspace: ${target}`)
}

export async function resolveReadablePath(
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

export function normalizeOutput(stdout: string, stderr: string) {
  const parts = []
  if (stdout.trim()) parts.push(stdout.trimEnd())
  if (stderr.trim()) parts.push(`[stderr]\n${stderr.trimEnd()}`)
  return parts.join("\n\n") || "(no output)"
}

export function stringifyJson(value: unknown) {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

export function requireCoreMemoAccess(options: MonToolOptions) {
  if (!options.coreClient || !options.coreToken) {
    throw new Error("备忘录工具需要 Core 登录态。请确认本轮请求携带 Core Token。")
  }
  return {
    coreClient: options.coreClient,
    coreToken: options.coreToken,
  }
}

export function normalizeMemoDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string") throw new Error(`${field} 必须是日期时间字符串。`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`无法解析 ${field}: ${value}`)
  }
  return toStorageIso(date)
}

export function memoLine(memo: CoreMemo) {
  const trigger = formatLocalDateTimeWithZone(memo.trigger_at || memo.remind_at || memo.due_at)
  const content = memo.content ? `\n   ${memo.content}` : ""
  return [
    `#${memo.id} ${memo.title}`,
    `   类型: ${memo.kind} | 状态: ${memo.status} | 优先级: ${memo.priority}`,
    `   触发/截止（本地时间）: ${trigger}`,
    content,
  ]
    .filter(Boolean)
    .join("\n")
}

export function formatMemoList(title: string, memos: CoreMemo[]) {
  if (!memos.length) return `${title}\n暂无记录。`
  return `${title}\n\n${memos.map(memoLine).join("\n\n")}`
}

export function withLocalMemoTime<T extends Record<string, unknown>>(value: T) {
  return {
    ...value,
    time_display_timezone: localTimeZoneLabel(),
    time_display_note: "面向用户展示和回复时请使用 *_local 字段，不要直接复述 ISO/UTC 原始字段。",
  }
}

export function memoWithLocalTime(memo: CoreMemo) {
  return {
    ...memo,
    remind_at_local: formatLocalDateTimeWithZone(memo.remind_at),
    due_at_local: formatLocalDateTimeWithZone(memo.due_at),
    trigger_at_local: formatLocalDateTimeWithZone(memo.trigger_at || memo.remind_at || memo.due_at),
    snoozed_until_local: formatLocalDateTimeWithZone(memo.snoozed_until),
    last_triggered_at_local: formatLocalDateTimeWithZone(memo.last_triggered_at),
  }
}

export function memosWithLocalTime(memos: CoreMemo[]) {
  return memos.map(memoWithLocalTime)
}

export async function pathExists(target: string) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

export async function findMonRoot(workspaceRoot: string) {
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

export function readIniValue(content: string, section: string, key: string) {
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

export function parseConfigNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function resolveSelfAwakeStatePath(workspaceRoot: string) {
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

export function parseJsonRecord(raw: string) {
  if (!raw.trim()) return {}
  try {
    const data = JSON.parse(raw)
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function resolveWakeTime(input: { after_minutes?: number; at?: string }, minMinutes: number, maxMinutes: number) {
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

export function cleanSearchText(value: string) {
  return htmlToText(value).replace(/\s+/g, " ").trim()
}

export function normalizeDuckRegion(language?: string) {
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

export function normalizeDuckTimeRange(value?: string) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized || normalized === "all" || normalized === "any") return undefined
  if (normalized === "day" || normalized === "d") return "d"
  if (normalized === "week" || normalized === "w") return "w"
  if (normalized === "month" || normalized === "m") return "m"
  if (normalized === "year" || normalized === "y") return "y"
  return normalized
}

export function normalizeDuckSafeSearch(value?: number) {
  if (value === 0) return "-2"
  if (value === 2) return "1"
  return "-1"
}

export function searchTimeoutMs() {
  const parsed = Number(process.env.MON_AGENT_SEARCH_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.round(parsed) : 20_000
}

export function normalizeDuckUrl(rawUrl: string) {
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

export function parseDuckSearchResults(html: string, maxResults: number): DuckSearchResult[] {
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

export function formatDuckSearch(query: string, results: DuckSearchResult[]) {
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

export async function searchDuckDuckGo(input: {
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

export function decodeHtmlEntities(value: string) {
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

export function htmlToText(html: string) {
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

export function htmlTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ").trim()) : undefined
}

export async function fetchWebPage(urlText: string, signal?: AbortSignal) {
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

export function mimeFromPath(filePath: string) {
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

export function imageFromDataUrl(url: string, fallbackMime = "image/png") {
  const match = url.match(/^data:([^;,]+);base64,(.*)$/)
  if (!match) return undefined
  return {
    mimeType: match[1] || fallbackMime,
    data: match[2] || "",
  }
}
