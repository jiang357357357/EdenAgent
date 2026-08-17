import path from "node:path"
import { existsSync, readFileSync, statSync } from "node:fs"

function *ancestors(start) {
  let current = path.resolve(start)
  if (existsSync(current) && statSync(current).isFile()) current = path.dirname(current)
  while (true) {
    yield current
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

function stripInlineComment(line) {
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote
    else if (char === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote
    else if ((char === "#" || char === ";") && !inSingleQuote && !inDoubleQuote) {
      if (index === 0 || /\s/.test(line[index - 1])) return line.slice(0, index)
    }
  }
  return line
}

function parse(file) {
  const data = {}
  let section = "_root"

  for (const [index, rawLine] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    const line = stripInlineComment(rawLine).trim()
    if (!line) continue

    if (line.startsWith("[")) {
      const match = line.match(/^\[([^\]]+)\]$/)
      if (!match || !match[1].trim()) throw new Error(`${file}:${index + 1}: invalid section`)
      section = match[1].trim().toLowerCase()
      data[section] ??= {}
      continue
    }

    const equals = line.indexOf("=")
    if (equals === -1) throw new Error(`${file}:${index + 1}: expected KEY=VALUE`)
    const key = line.slice(0, equals).trim().toUpperCase()
    if (!key) throw new Error(`${file}:${index + 1}: empty key`)
    data[section] ??= {}
    data[section][key] = line.slice(equals + 1).trim()
  }

  return data
}

export function loadMonConfig(start = process.cwd()) {
  let moduleFile
  let workspaceRoot
  for (const directory of ancestors(start)) {
    const configFile = path.join(directory, ".monconfig")
    if (!moduleFile && existsSync(configFile)) moduleFile = configFile
    if (!workspaceRoot && existsSync(configFile) && existsSync(path.join(directory, ".monworkspace"))) {
      workspaceRoot = directory
    }
  }

  const moduleRoot = moduleFile ? path.dirname(moduleFile) : path.resolve(start)
  const data = moduleFile ? parse(moduleFile) : {}
  const config = {
    data,
    moduleRoot,
    workspaceRoot: workspaceRoot ?? moduleRoot,
    files: moduleFile ? [moduleFile] : [],
    get(section, key, fallback) {
      return data[section.trim().toLowerCase()]?.[key.trim().toUpperCase()] ?? fallback
    },
    number(section, key, fallback) {
      const value = config.get(section, key)
      if (value === undefined || value === "") return fallback
      if (!/^[+-]?\d+$/.test(value)) throw new Error(`[${section}] ${key} must be an integer, got ${JSON.stringify(value)}`)
      return Number(value)
    },
    path(section, key, fallback) {
      const value = config.get(section, key, fallback) ?? fallback
      return path.isAbsolute(value) ? value : path.join(moduleRoot, value)
    },
  }

  return config
}
