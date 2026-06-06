export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SILENT"

export interface Logger {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

const order: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  SILENT: 100,
}

const ansi = {
  reset: "\x1b[0m",
  dim: "\x1b[90m",
  scope: "\x1b[36m",
  DEBUG: "\x1b[90m",
  INFO: "\x1b[32m",
  WARN: "\x1b[33m",
  ERROR: "\x1b[31m",
}

function normalizeLevel(level?: string): LogLevel {
  const normalized = (level || "INFO").trim().toUpperCase()
  if (normalized in order) return normalized as LogLevel
  return "INFO"
}

function timeLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(new Date())
}

function stringify(meta: unknown) {
  if (meta === undefined) return ""
  if (meta instanceof Error) return ` ${meta.stack || meta.message}`
  if (typeof meta === "string") return ` ${meta}`

  try {
    return ` ${JSON.stringify(meta)}`
  } catch {
    return ` ${String(meta)}`
  }
}

export function createLogger(scope: string, configuredLevel?: string): Logger {
  const threshold = order[normalizeLevel(configuredLevel)]

  function write(level: Exclude<LogLevel, "SILENT">, message: string, meta?: unknown) {
    if (order[level] < threshold) return
    const line = `${ansi.dim}[${timeLabel()}]${ansi.reset}${ansi.scope}[MonAgent][${scope}]${ansi.reset}${ansi[level]}[${level}]${ansi.reset} ${message}${stringify(meta)}`
    if (level === "ERROR") {
      console.error(line)
      return
    }
    if (level === "WARN") {
      console.warn(line)
      return
    }
    console.log(line)
  }

  return {
    debug: (message, meta) => write("DEBUG", message, meta),
    info: (message, meta) => write("INFO", message, meta),
    warn: (message, meta) => write("WARN", message, meta),
    error: (message, meta) => write("ERROR", message, meta),
  }
}
