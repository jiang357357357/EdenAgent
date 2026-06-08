import boxen from "boxen"
import chalk from "chalk"
import Table from "cli-table3"
import wrapAnsi from "wrap-ansi"

type PanelLevel = "info" | "warn" | "error" | "debug"

interface PanelOptions {
  title?: string
  level?: PanelLevel
  width?: number
}

interface TableOptions extends PanelOptions {
  columns?: [string, string]
}

const sensitiveKeys =
  /api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|(^|[_-])token($|[_-])|password|authorization|secret|credential/i

function panelEnabled() {
  const value = process.env.MON_AGENT_PANEL_LOG
  if (value === undefined) return true
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase())
}

function terminalWidth() {
  const columns = process.stdout.columns || 100
  return Math.max(56, Math.min(columns - 8, 118))
}

function colorFor(level: PanelLevel) {
  switch (level) {
    case "warn":
      return chalk.yellow
    case "error":
      return chalk.red
    case "debug":
      return chalk.gray
    default:
      return chalk.cyan
  }
}

function borderColorFor(level: PanelLevel) {
  switch (level) {
    case "warn":
      return "yellow"
    case "error":
      return "red"
    case "debug":
      return "gray"
    default:
      return "cyan"
  }
}

function clip(value: string, maxLength = 180) {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function stringifyValue(value: unknown, maxLength = 180): string {
  if (value === undefined || value === null) return "-"
  if (typeof value === "string") return clip(value, maxLength)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return clip(JSON.stringify(value), maxLength)
  } catch {
    return clip(String(value), maxLength)
  }
}

export function maskSensitive(value: unknown, key = ""): unknown {
  const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()
  if (sensitiveKeys.test(normalizedKey)) {
    const text = String(value ?? "")
    if (!text) return ""
    if (text.length <= 8) return "********"
    return `${text.slice(0, 4)}********${text.slice(-4)}`
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskSensitive(item))
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = maskSensitive(childValue, childKey)
    }
    return result
  }

  return value
}

export function printPanel(content: string | string[], options: PanelOptions = {}) {
  if (!panelEnabled()) return
  const level = options.level ?? "info"
  const width = options.width ?? terminalWidth()
  const color = colorFor(level)
  const body = Array.isArray(content) ? content.join("\n") : content
  console.log(
    boxen(body, {
      title: options.title ? color(` ${options.title} `) : undefined,
      titleAlignment: "left",
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 0, bottom: 0 },
      width,
      borderStyle: "round",
      borderColor: borderColorFor(level),
    }),
  )
}

export function printKeyValuePanel(rows: Array<[string, unknown]>, options: TableOptions = {}) {
  if (!panelEnabled()) return
  const width = options.width ?? terminalWidth()
  const valueWidth = Math.max(24, width - 28)
  const table = new Table({
    head: (options.columns ?? ["字段", "值"]).map((item) => chalk.bold(item)),
    style: { "padding-left": 1, "padding-right": 1, head: [], border: [] },
    colWidths: [18, valueWidth],
    wordWrap: true,
  })

  for (const [key, value] of rows) {
    table.push([chalk.cyan(key), wrapAnsi(stringifyValue(value), valueWidth, { hard: false })])
  }

  printPanel(table.toString(), options)
}

export function printRowsPanel(
  columns: string[],
  rows: Array<Array<unknown>>,
  options: PanelOptions & { colWidths?: number[] } = {},
) {
  if (!panelEnabled()) return
  const width = options.width ?? terminalWidth()
  const usableWidth = width - columns.length * 4
  const colWidths =
    options.colWidths ??
    columns.map((_, index) =>
      index === columns.length - 1
        ? Math.max(20, Math.floor(usableWidth * 0.5))
        : Math.max(10, Math.floor(usableWidth * 0.5 / Math.max(1, columns.length - 1))),
    )
  const table = new Table({
    head: columns.map((item) => chalk.bold(item)),
    style: { "padding-left": 1, "padding-right": 1, head: [], border: [] },
    colWidths,
    wordWrap: true,
  })

  for (const row of rows) {
    table.push(row.map((value, index) => wrapAnsi(stringifyValue(value), colWidths[index] ?? 20, { hard: false })))
  }

  printPanel(table.toString(), options)
}

export function printJsonPanel(title: string, data: unknown, options: PanelOptions = {}) {
  const width = options.width ?? terminalWidth()
  const safe = maskSensitive(data)
  const json = JSON.stringify(safe, null, 2) ?? ""
  printPanel(wrapAnsi(json, Math.max(40, width - 8), { hard: false }), {
    ...options,
    title,
    width,
  })
}
