#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"

const [, , command, ...args] = process.argv

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function readRegistry(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"))
    if (!value || typeof value !== "object") throw new Error("registry is not an object")
    if (!/^[a-f0-9]{32}$/i.test(String(value.instance_id ?? ""))) throw new Error("invalid instance_id")
    if (!Number.isSafeInteger(Number(value.pid)) || Number(value.pid) <= 0) throw new Error("invalid pid")
    if (!Number.isInteger(Number(value.game_port)) || Number(value.game_port) < 1 || Number(value.game_port) > 65535)
      throw new Error("invalid game_port")
    if (!Number.isInteger(Number(value.admin_port)) || Number(value.admin_port) < 1 || Number(value.admin_port) > 65535)
      throw new Error("invalid admin_port")
    if (Number(value.game_port) === Number(value.admin_port)) throw new Error("game_port and admin_port must differ")
    if (!/^(host|dedicated)$/.test(String(value.mode ?? ""))) throw new Error("invalid mode")
    if (!validHost(String(value.host ?? ""))) throw new Error("invalid host")
    if (!path.isAbsolute(String(value.config_path ?? ""))) throw new Error("config_path must be absolute")
    if (!/^\d+$/.test(String(value.process_start_ticks ?? ""))) throw new Error("invalid process_start_ticks")
    if (!path.isAbsolute(String(value.process_executable ?? ""))) throw new Error("process_executable must be absolute")
    if (!path.isAbsolute(String(value.launch_target ?? ""))) throw new Error("launch_target must be absolute")
    return value
  } catch (error) {
    fail(`No valid Eden Agent OpenTTD instance at ${file}: ${error.message}`)
  }
}

function alive(pid) {
  try { process.kill(Number(pid), 0); return true } catch { return false }
}

function linuxProcessIdentity(pid, expectedBinary) {
  if (process.platform !== "linux") fail("OpenTTD process identity requires Linux /proc")
  const proc = `/proc/${Number(pid)}`
  try {
    const stat = fs.readFileSync(path.join(proc, "stat"), "utf8")
    const commandEnd = stat.lastIndexOf(")")
    if (commandEnd < 0) throw new Error("malformed process stat")
    const statFields = stat.slice(commandEnd + 2).trim().split(/\s+/)
    const startTicks = statFields[19]
    if (!/^\d+$/.test(startTicks ?? "")) throw new Error("missing process start time")
    const executable = fs.realpathSync(path.join(proc, "exe"))
    const launchTarget = fs.realpathSync(expectedBinary)
    const arguments_ = fs.readFileSync(path.join(proc, "cmdline"))
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
    const resolvesToTarget = (argument) => {
      if (!path.isAbsolute(argument)) return false
      try { return fs.realpathSync(argument) === launchTarget } catch { return false }
    }
    if (executable !== launchTarget && !arguments_.some(resolvesToTarget))
      throw new Error("process command does not contain the expected OpenTTD binary")
    return { startTicks, executable, launchTarget }
  } catch (error) {
    fail(`Cannot identify OpenTTD process ${pid}: ${error.message}`)
  }
}

function registryProcessIsAlive(value) {
  if (!alive(value.pid)) return false
  try {
    const identity = linuxProcessIdentity(value.pid, value.launch_target)
    return identity.startTicks === String(value.process_start_ticks)
      && identity.executable === value.process_executable
      && identity.launchTarget === value.launch_target
  } catch {
    return false
  }
}

function validHost(value) {
  return value === "127.0.0.1" || value === "localhost"
}

function port(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) fail(`${name} must be an integer from 1 to 65535`)
  return parsed
}

function setIni(source, section, key, value) {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const header = `[${section}]`
  const sectionIndex = lines.findIndex((line) => line.trim().toLowerCase() === header.toLowerCase())
  if (sectionIndex < 0) {
    if (lines.at(-1) !== "") lines.push("")
    lines.push(header, `${key} = ${value}`)
    return lines.join("\n")
  }
  let end = lines.length
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) { end = index; break }
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const keyPattern = new RegExp(`^\\s*${escaped}\\s*=`, "i")
  const relativeIndex = lines.slice(sectionIndex + 1, end).findIndex((line) => keyPattern.test(line))
  if (relativeIndex >= 0) lines[sectionIndex + 1 + relativeIndex] = `${key} = ${value}`
  else lines.splice(end, 0, `${key} = ${value}`)
  return lines.join("\n")
}

function getIni(source, section, key) {
  let current = ""
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (header) { current = header[1].trim().toLowerCase(); continue }
    if (current !== section.toLowerCase()) continue
    const pair = line.match(/^\s*([^#;][^=]*)=(.*)$/)
    if (pair && pair[1].trim().toLowerCase() === key.toLowerCase()) return pair[2].trim()
  }
  return ""
}

function installBridge(sourceRoot, dataRoot) {
  if (!path.isAbsolute(sourceRoot ?? "")) fail("OpenTTD bridge source root must be absolute")
  if (!path.isAbsolute(dataRoot ?? "")) fail("OpenTTD data root must be absolute")
  const sourceBase = fs.realpathSync(sourceRoot)
  const copies = [
    ["game", "EdenAgentBridge", "info.nut"],
    ["game", "EdenAgentBridge", "main.nut"],
    ["ai", "EdenAgentCompany", "info.nut"],
    ["ai", "EdenAgentCompany", "main.nut"],
  ]
  const installed = []
  for (const [kind, packageName, fileName] of copies) {
    const source = path.join(sourceBase, kind, fileName)
    const sourceInfo = fs.lstatSync(source)
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) fail(`Unsafe OpenTTD bridge source: ${source}`)
    const resolvedSource = fs.realpathSync(source)
    const relativeSource = path.relative(sourceBase, resolvedSource)
    if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) fail(`OpenTTD bridge source escapes its root: ${source}`)
    const targetDirectory = path.join(dataRoot, kind, packageName)
    const target = path.join(targetDirectory, fileName)
    fs.mkdirSync(targetDirectory, { recursive: true })
    const content = fs.readFileSync(resolvedSource)
    const unchanged = fs.existsSync(target) && fs.readFileSync(target).equals(content)
    if (!unchanged) fs.copyFileSync(resolvedSource, target)
    fs.chmodSync(target, 0o644)
    installed.push({ kind, package: packageName, file: fileName, changed: !unchanged })
  }
  process.stdout.write(`${JSON.stringify({ installed })}\n`)
}

async function allocatePorts() {
  const servers = []
  const ports = []
  try {
    for (let index = 0; index < 2; index += 1) {
      const server = net.createServer()
      servers.push(server)
      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
      })
      ports.push(server.address().port)
    }
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  }
  process.stdout.write(`${ports.join("\n")}\n`)
}

switch (command) {
  case "uuid": process.stdout.write(`${crypto.randomUUID().replaceAll("-", "")}\n`); break
  case "alive": process.exit(registryProcessIsAlive(readRegistry(args[0])) ? 0 : 1); break
  case "fields": {
    const value = readRegistry(args[0])
    if (!registryProcessIsAlive(value)) fail(`OpenTTD instance ${value.instance_id ?? ""} is not running or its process identity changed`)
    for (const field of ["host", "game_port", "instance_id", "pid", "config_path", "mode", "launch_target"])
      process.stdout.write(`${value[field] ?? ""}\n`)
    break
  }
  case "pid": {
    try { process.stdout.write(`${Number(JSON.parse(fs.readFileSync(args[0], "utf8")).pid) || ""}\n`) }
    catch { process.stdout.write("\n") }
    break
  }
  case "ports": await allocatePorts(); break
  case "password": process.stdout.write(`${getIni(fs.readFileSync(args[0], "utf8"), "network", "admin_password")}\n`); break
  case "install-bridge": installBridge(args[0], args[1]); break
  case "configure": {
    const [base, target, secrets, gamePortValue, adminPortValue] = args
    const password = fs.readFileSync(0, "utf8")
    if (!password || password.length > 1024 || password.includes("\0") || /[\r\n]/.test(password)) {
      fail("Invalid OpenTTD admin password")
    }
    const gamePort = port(gamePortValue, "gamePort")
    const adminPort = port(adminPortValue, "adminPort")
    if (gamePort === adminPort) fail("gamePort and adminPort must differ")
    let config = fs.readFileSync(base, "utf8")
    for (const [section, key, value] of [
      ["network", "server_port", gamePort], ["network", "server_admin_port", adminPort],
      ["network", "server_admin_chat", "true"], ["network", "allow_insecure_admin_login", "true"],
      ["gui", "autosave_on_exit", "true"],
    ]) config = setIni(config, section, key, value)
    fs.writeFileSync(target, config, { mode: 0o600 })
    let secretConfig = fs.existsSync(secrets) ? fs.readFileSync(secrets, "utf8") : ""
    secretConfig = setIni(secretConfig, "network", "admin_password", password)
    fs.writeFileSync(secrets, secretConfig, { mode: 0o600 })
    break
  }
  case "write-registry": {
    const [file, instanceId, host, gamePort, adminPort, pid, mode, configPath, binaryPath] = args
    if (!/^[a-f0-9]{32}$/i.test(instanceId ?? "")) fail("Invalid OpenTTD instance ID")
    if (!validHost(host)) fail("OpenTTD launcher host must be 127.0.0.1 or localhost")
    const gamePortValue = port(gamePort, "gamePort")
    const adminPortValue = port(adminPort, "adminPort")
    if (gamePortValue === adminPortValue) fail("gamePort and adminPort must differ")
    const pidValue = Number(pid)
    if (!Number.isSafeInteger(pidValue) || pidValue <= 0) fail("Invalid OpenTTD PID")
    if (!/^(host|dedicated)$/.test(mode ?? "")) fail("Invalid OpenTTD mode")
    if (!path.isAbsolute(configPath ?? "")) fail("OpenTTD config path must be absolute")
    if (!path.isAbsolute(binaryPath ?? "")) fail("OpenTTD binary path must be absolute")
    const identity = linuxProcessIdentity(pidValue, binaryPath)
    const value = { instance_id: instanceId, host, game_port: gamePortValue, admin_port: adminPortValue,
      pid: pidValue, mode, started_at: new Date().toISOString(), config_path: path.resolve(configPath),
      process_start_ticks: identity.startTicks, process_executable: identity.executable,
      launch_target: identity.launchTarget }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, file)
    break
  }
  case "remove-if-matches": {
    const [file, expectedId, expectedPid] = args
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"))
      if (value.instance_id === expectedId && Number(value.pid) === Number(expectedPid)) fs.unlinkSync(file)
    } catch (error) { if (error.code !== "ENOENT") fail(error.message) }
    break
  }
  default: fail(`Unknown OpenTTD launcher command: ${command ?? ""}`)
}
