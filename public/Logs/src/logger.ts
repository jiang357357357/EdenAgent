import path from "node:path"
import { color, levelName, dimPath } from "./color"
import { format } from "node:util"

export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL"
const LEVEL_ORDER: Record<Level, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 }

export type LogWriter = (message: string) => void | Promise<void>

let configuredLevel: Level | undefined
let writer: LogWriter = (message) => {
  process.stderr.write(message)
}

export function configureLogger(options: { level?: Level; writer?: LogWriter }) {
  configuredLevel = options.level ?? configuredLevel
  writer = options.writer ?? writer
}

const currentLevel = (): Level => {
  if (configuredLevel) return configuredLevel
  const env = process.env.LOG_LEVEL?.toUpperCase() as Level | undefined
  if (env && env in LEVEL_ORDER) return env
  return "DEBUG"
}

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel()]
}

function timestamp(): string {
  const d = new Date()
  const h = d.getHours().toString().padStart(2, "0")
  const m = d.getMinutes().toString().padStart(2, "0")
  const s = d.getSeconds().toString().padStart(2, "0")
  const ms = d.getMilliseconds().toString().padStart(3, "0")
  return `${h}:${m}:${s}.${ms}`
}

function formatArgs(args: unknown[]): string {
  if (typeof args[0] === "string" && /%[sdifoOj%]/.test(args[0])) {
    return format(...args)
  }
  return args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`
      if (typeof arg === "object") {
        try {
          return color.dimGray(JSON.stringify(arg, null, 2))
        } catch {
          return String(arg)
        }
      }
      return String(arg)
    })
    .join(" ")
}

function callerLine(): string {
  const stack = new Error().stack ?? ""
  const lines = stack.split("\n")
  // Skip Error line, skip this function, skip the log method, find first non-logger line
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i]
    const normalized = line.replaceAll("\\", "/")
    if (normalized.includes("/logger.ts")) continue
    if (normalized.includes("/core/src/util/log.ts")) continue
    const match = line.match(/\((.*):(\d+):(\d+)\)/)
    if (match) return compactPath(match[1], match[2])
    const match2 = line.match(/at\s+(.*):(\d+):(\d+)/)
    if (match2) return compactPath(match2[1], match2[2])
  }
  return "<unknown>"
}

function compactPath(file: string, line: string): string {
  const normalized = file.replaceAll("\\", "/")
  const cwd = process.cwd().replaceAll("\\", "/")
  const relative = normalized.startsWith(cwd) ? path.relative(cwd, normalized).replaceAll("\\", "/") : normalized
  return `${relative}:${line}`
}

const moduleColors = [
  color.brightBlue,
  color.brightCyan,
  color.brightMagenta,
  color.cyan,
  color.magenta,
  color.blue,
]

function moduleLabel(module: string): string {
  let hash = 0
  for (const char of module) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const paint = moduleColors[hash % moduleColors.length]
  return paint(`[${module}]`)
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  fatal: (...args: unknown[]) => void
  child: (sub: string) => Logger
}

export function createLogger(main: string, sub?: string): Logger {
  const module = sub ? `${main}/${sub}` : main

  function log(level: Level, args: unknown[]) {
    if (!shouldLog(level)) return
    const parts = [
      color.dimGray(`[${timestamp()}]`),
      moduleLabel(module),
      levelName(level),
      dimPath(`[${callerLine()}]`),
      formatArgs(args),
    ]
    void writer(parts.join(" ") + "\n")
  }

  return {
    debug: (...args) => log("DEBUG", args),
    info: (...args) => log("INFO", args),
    warn: (...args) => log("WARN", args),
    error: (...args) => log("ERROR", args),
    fatal: (...args) => log("FATAL", args),
    child: (childSub: string) => createLogger(module, childSub),
  }
}
