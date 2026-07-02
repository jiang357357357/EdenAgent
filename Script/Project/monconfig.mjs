import path from "node:path"
import { existsSync, readFileSync } from "node:fs"

const MAX_DEPTH = 10

function findFiles(start) {
  const files = []
  let current = path.resolve(start)

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const file = path.join(current, ".monconfig")
    if (existsSync(file)) files.push(file)

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return files
}

function parse(file) {
  const data = {}
  let section = "default"

  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase()
      data[section] ??= {}
      continue
    }

    const equals = line.indexOf("=")
    if (equals === -1) continue

    const key = line.slice(0, equals).trim().toUpperCase()
    const value = line.slice(equals + 1).trim()
    data[section] ??= {}
    data[section][key] = value
  }

  return data
}

export function loadMonConfig(start = process.cwd()) {
  const files = findFiles(start)
  const data = {}

  for (const file of files.slice().reverse()) {
    const parsed = parse(file)
    for (const [section, values] of Object.entries(parsed)) {
      data[section] = { ...(data[section] ?? {}), ...values }
    }
  }

  const workspaceRoot = files[0] ? path.dirname(files[0]) : path.resolve(start)
  const config = {
    data,
    workspaceRoot,
    files,
    get(section, key, fallback) {
      const normalizedSection = section.toLowerCase()
      const normalizedKey = key.toUpperCase()
      return data[normalizedSection]?.[normalizedKey] ?? process.env[`${normalizedSection.toUpperCase()}_${normalizedKey}`] ?? fallback
    },
    number(section, key, fallback) {
      const value = config.get(section, key)
      if (!value) return fallback
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : fallback
    },
    path(section, key, fallback) {
      const value = config.get(section, key, fallback) ?? fallback
      return path.isAbsolute(value) ? value : path.join(workspaceRoot, value)
    },
  }

  return config
}
