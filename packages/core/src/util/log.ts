export * as Log from "./log"

import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import { configureLogger, createLogger, type Logger as ColorLogger } from "@opencode-ai/logs"
import * as Global from "../global"
import z from "zod"
import { Glob } from "./glob"

export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
export type Level = z.infer<typeof Level>

const levelPriority: Record<Level, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}
const keep = 10

let level: Level = "INFO"

function shouldLog(input: Level): boolean {
  return levelPriority[input] >= levelPriority[level]
}

export type Logger = {
  debug(message?: any, extra?: Record<string, any>): void
  info(message?: any, extra?: Record<string, any>): void
  error(message?: any, extra?: Record<string, any>): void
  warn(message?: any, extra?: Record<string, any>): void
  tag(key: string, value: string): Logger
  clone(): Logger
  time(
    message: string,
    extra?: Record<string, any>,
  ): {
    stop(): void
    [Symbol.dispose](): void
  }
}

const loggers = new Map<string, Logger>()
const colorLoggers = new Map<string, ColorLogger>()

function serviceLogger(service: string) {
  const cached = colorLoggers.get(service)
  if (cached) return cached
  const logger = createLogger("opencode", service)
  colorLoggers.set(service, logger)
  return logger
}

function formatExtra(extra?: Record<string, any>) {
  if (!extra) return undefined
  const result = Object.fromEntries(
    Object.entries(extra)
      .filter(([key, value]) => key !== "service" && value !== undefined && value !== null)
      .map(([key, value]) => {
        if (value instanceof Error) return [key, value.message]
        return [key, value]
      }),
  )
  return Object.keys(result).length ? result : undefined
}

export const Default = create({ service: "default" })

export interface Options {
  print: boolean
  dev?: boolean
  level?: Level
}

let logpath = ""
export function file() {
  return logpath
}
let write = (msg: string) => {
  process.stderr.write(msg)
}

export async function init(options: Options) {
  if (options.level) level = options.level
  void cleanup(Global.Path.log)
  configureLogger({
    level,
    writer: (message) => write(message),
  })
  if (options.print) return
  logpath = path.join(
    Global.Path.log,
    options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
  )
  await fs.truncate(logpath).catch(() => {})
  const stream = createWriteStream(logpath, { flags: "a" })
  write = async (msg: string) => {
    await new Promise<void>((resolve, reject) => {
      stream.write(msg, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
}

async function cleanup(dir: string) {
  const files = (
    await Glob.scan("????-??-??T??????.log", {
      cwd: dir,
      absolute: false,
      include: "file",
    }).catch(() => [])
  )
    .filter((file) => path.basename(file) === file)
    .sort()
  if (files.length <= keep) return

  const doomed = files.slice(0, -keep)
  await Promise.all(doomed.map((file) => fs.unlink(path.join(dir, file)).catch(() => {})))
}

export function create(tags?: Record<string, any>) {
  tags = tags || {}

  const service = tags["service"]
  if (service && typeof service === "string") {
    const cached = loggers.get(service)
    if (cached) {
      return cached
    }
  }

  const logger = service && typeof service === "string" ? serviceLogger(service) : createLogger("opencode")
  const details = (extra?: Record<string, any>) => formatExtra({ ...tags, ...extra })
  const args = (message?: any, extra?: Record<string, any>) => {
    const metadata = details(extra)
    return metadata === undefined ? [message] : [message, metadata]
  }
  const result: Logger = {
    debug(message?: any, extra?: Record<string, any>) {
      if (shouldLog("DEBUG")) {
        logger.debug(...args(message, extra))
      }
    },
    info(message?: any, extra?: Record<string, any>) {
      if (shouldLog("INFO")) {
        logger.info(...args(message, extra))
      }
    },
    error(message?: any, extra?: Record<string, any>) {
      if (shouldLog("ERROR")) {
        logger.error(...args(message, extra))
      }
    },
    warn(message?: any, extra?: Record<string, any>) {
      if (shouldLog("WARN")) {
        logger.warn(...args(message, extra))
      }
    },
    tag(key: string, value: string) {
      if (tags) tags[key] = value
      return result
    },
    clone() {
      return create({ ...tags })
    },
    time(message: string, extra?: Record<string, any>) {
      const now = Date.now()
      result.info(message, { status: "started", ...extra })
      function stop() {
        result.info(message, {
          status: "completed",
          duration: Date.now() - now,
          ...extra,
        })
      }
      return {
        stop,
        [Symbol.dispose]() {
          stop()
        },
      }
    },
  }

  if (service && typeof service === "string") {
    loggers.set(service, result)
  }

  return result
}
