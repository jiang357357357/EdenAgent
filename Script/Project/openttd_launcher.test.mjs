import assert from "node:assert/strict"
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const helper = fileURLToPath(new URL("./openttd_launcher.mjs", import.meta.url))
const shellLauncher = fileURLToPath(new URL("../Cmd/Linux/StartOpenTTD.sh", import.meta.url))

function run(arguments_, options = {}) {
  return spawnSync(process.execPath, [helper, ...arguments_], {
    encoding: "utf8",
    ...options,
  })
}

function temporaryDirectory(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "edenagent-openttd-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test("configure writes isolated public and secret configuration without putting the password in argv", (t) => {
  const directory = temporaryDirectory(t)
  const base = path.join(directory, "base.cfg")
  const target = path.join(directory, "instance.cfg")
  const secrets = path.join(directory, "secrets.cfg")
  writeFileSync(base, "[network]\nserver_name = test\n\n[gui]\n", "utf8")

  const result = run(["configure", base, target, secrets, "41234", "41235"], {
    input: "private-password",
  })
  assert.equal(result.status, 0, result.stderr)
  const config = readFileSync(target, "utf8")
  const secretConfig = readFileSync(secrets, "utf8")
  assert.match(config, /server_port = 41234/)
  assert.match(config, /server_admin_port = 41235/)
  assert.match(config, /server_admin_chat = true/)
  assert.match(config, /allow_insecure_admin_login = true/)
  assert.match(config, /autosave_on_exit = true/)
  assert.doesNotMatch(config, /private-password/)
  assert.match(secretConfig, /admin_password = private-password/)
})

test("bridge installer copies managed GameScript and AI files idempotently without deleting user content", (t) => {
  const directory = temporaryDirectory(t)
  const source = path.join(directory, "bridge")
  const data = path.join(directory, "data")
  for (const kind of ["game", "ai"]) {
    mkdirSync(path.join(source, kind), { recursive: true })
    writeFileSync(path.join(source, kind, "info.nut"), `${kind}-info`, "utf8")
    writeFileSync(path.join(source, kind, "main.nut"), `${kind}-main`, "utf8")
  }
  const userFile = path.join(data, "game", "EdenAgentBridge", "user-owned.txt")
  mkdirSync(path.dirname(userFile), { recursive: true })
  writeFileSync(userFile, "preserve", "utf8")

  const first = run(["install-bridge", path.resolve(source), path.resolve(data)])
  assert.equal(first.status, 0, first.stderr)
  assert.equal(JSON.parse(first.stdout).installed.every((item) => item.changed), true)
  assert.equal(readFileSync(path.join(data, "game", "EdenAgentBridge", "info.nut"), "utf8"), "game-info")
  assert.equal(readFileSync(path.join(data, "game", "EdenAgentBridge", "main.nut"), "utf8"), "game-main")
  assert.equal(readFileSync(path.join(data, "ai", "EdenAgentCompany", "info.nut"), "utf8"), "ai-info")
  assert.equal(readFileSync(path.join(data, "ai", "EdenAgentCompany", "main.nut"), "utf8"), "ai-main")

  const second = run(["install-bridge", path.resolve(source), path.resolve(data)])
  assert.equal(second.status, 0, second.stderr)
  assert.equal(JSON.parse(second.stdout).installed.every((item) => !item.changed), true)
  assert.equal(readFileSync(userFile, "utf8"), "preserve")
})

test("registry writes atomically, validates process identity, and only removes the expected instance", {
  skip: process.platform !== "linux",
}, (t) => {
  const directory = temporaryDirectory(t)
  const registry = path.join(directory, "runtime", "active-instance.json")
  const config = path.resolve(directory, "instance.cfg")
  const instance = "0123456789abcdef0123456789abcdef"
  const written = run([
    "write-registry",
    registry,
    instance,
    "127.0.0.1",
    "41234",
    "41235",
    String(process.pid),
    "dedicated",
    config,
    process.execPath,
  ])
  assert.equal(written.status, 0, written.stderr)
  const value = JSON.parse(readFileSync(registry, "utf8"))
  assert.equal(value.instance_id, instance)
  assert.equal(value.game_port, 41234)
  assert.equal(value.admin_port, 41235)
  assert.equal(value.pid, process.pid)
  assert.equal(value.config_path, config)

  const fields = run(["fields", registry])
  assert.equal(fields.status, 0, fields.stderr)
  assert.deepEqual(fields.stdout.trim().split(/\r?\n/), [
    "127.0.0.1",
    "41234",
    instance,
    String(process.pid),
    config,
    "dedicated",
    realpathSync(process.execPath),
  ])
  assert.equal(run(["alive", registry]).status, 0)
  writeFileSync(registry, `${JSON.stringify({
    ...value,
    process_start_ticks: String(BigInt(value.process_start_ticks) + 1n),
  }, null, 2)}\n`, "utf8")
  assert.notEqual(run(["alive", registry]).status, 0)
  writeFileSync(registry, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  assert.equal(run(["remove-if-matches", registry, instance, "1"]).status, 0)
  assert.equal(JSON.parse(readFileSync(registry, "utf8")).instance_id, instance)
  assert.equal(run(["remove-if-matches", registry, instance, String(process.pid)]).status, 0)
  assert.equal(run(["pid", registry]).stdout, "\n")
})

function writeFakeOpenTtd(directory) {
  const binary = path.join(directory, "openttd")
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const args = process.argv.slice(2)

function append(file, value) {
  if (file) fs.appendFileSync(file, JSON.stringify(value) + "\\n", "utf8")
}

if (args.includes("--fake-server")) {
  setInterval(() => {}, 1000)
} else if (args.includes("-D")) {
  const address = args[args.indexOf("-D") + 1]
  const gamePort = Number(address.slice(address.lastIndexOf(":") + 1))
  const config = fs.readFileSync(args[args.indexOf("-c") + 1], "utf8")
  const adminPort = Number(config.match(/^server_admin_port\\s*=\\s*(\\d+)/m)[1])
  const servers = [gamePort, adminPort].map((port) => net.createServer((socket) => socket.end()).listen(port, "127.0.0.1"))
  let input = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    input += chunk
    if (/(^|\\n)quit(?:\\n|$)/.test(input)) {
      for (const server of servers) server.close()
      setTimeout(() => process.exit(0), 10)
    }
  })
  process.on("SIGTERM", () => process.exit(0))
} else {
  const configIndex = args.indexOf("-c")
  if (configIndex >= 0) {
    const config = path.resolve(args[configIndex + 1])
    const profile = path.dirname(config)
    const download = path.join(profile, "content_download", "newgrf", "downloaded.tar")
    const existedBefore = fs.existsSync(download)
    fs.mkdirSync(path.dirname(download), { recursive: true })
    fs.writeFileSync(download, "persistent")
    append(process.env.MON_TEST_LAUNCH_RECORD, { config, profile, download: path.dirname(path.dirname(download)), existedBefore })
    setTimeout(() => process.exit(0), 500)
  } else {
    append(process.env.MON_TEST_CLIENT_RECORD, args)
  }
}
`, "utf8")
  chmodSync(binary, 0o755)
  return binary
}

function launcherEnvironment(root, binary) {
  const home = path.join(root, "home")
  const data = path.join(root, "data")
  const runtime = path.join(root, "runtime")
  return {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: data,
    XDG_RUNTIME_DIR: runtime,
    MON_OPENTTD_ROOT: path.dirname(binary),
    MON_OPENTTD_BIN: binary,
    MON_CONNECTOR_OPENTTD_RIOU: "test-admin-password",
  }
}

function runLauncher(arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [shellLauncher, ...arguments_], { env: environment, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
}

test("Linux join modes stop the identity-matched managed server when the client exits", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async (t) => {
  for (const arguments_ of [[], ["--join"]]) {
    const root = temporaryDirectory(t)
    const install = path.join(root, "install")
    mkdirSync(install, { recursive: true })
    const binary = writeFakeOpenTtd(install)
    const environment = launcherEnvironment(root, binary)
    const registry = path.join(environment.XDG_RUNTIME_DIR, "edenagent-openttd", "active-instance.json")
    const record = path.join(root, "client.jsonl")
    environment.MON_TEST_CLIENT_RECORD = record
    const server = spawn(binary, ["--fake-server"], { env: environment, stdio: "ignore" })
    const exited = childExit(server)
    t.after(() => { if (server.exitCode === null) server.kill("SIGKILL") })
    await new Promise((resolve) => setTimeout(resolve, 100))
    mkdirSync(path.dirname(registry), { recursive: true })
    const registered = run([
      "write-registry", registry, "0123456789abcdef0123456789abcdef", "127.0.0.1",
      "43210", "43211", String(server.pid), "dedicated", path.join(root, "existing.cfg"), binary,
    ])
    assert.equal(registered.status, 0, registered.stderr)

    const result = await runLauncher(arguments_, environment)
    assert.equal(result.code, 0, result.stderr)
    const stopped = await exited
    assert.equal(stopped.signal, "SIGTERM")
    assert.deepEqual(JSON.parse(readFileSync(record, "utf8").trim()), ["-n", "127.0.0.1:43210"])
    assert.equal(existsSync(registry), false)
  }
})

test("Linux dedicated mode stops the server and removes its registry and generated config", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async (t) => {
  const root = temporaryDirectory(t)
  const install = path.join(root, "install")
  mkdirSync(install, { recursive: true })
  const binary = writeFakeOpenTtd(install)
  const environment = launcherEnvironment(root, binary)
  const config = path.join(environment.HOME, ".config", "openttd", "openttd.cfg")
  const save = path.join(environment.XDG_DATA_HOME, "openttd", "save", "edenagent-route.sav")
  const record = path.join(root, "client.jsonl")
  environment.MON_OPENTTD_CONFIG = config
  environment.MON_TEST_CLIENT_RECORD = record
  mkdirSync(path.dirname(config), { recursive: true })
  mkdirSync(path.dirname(save), { recursive: true })
  writeFileSync(config, "[network]\nserver_name = test\n", "utf8")
  writeFileSync(save, "save", "utf8")

  const result = await runLauncher(["--dedicated"], environment)
  assert.equal(result.code, 0, result.stderr)
  const clientArguments = JSON.parse(readFileSync(record, "utf8").trim())
  assert.equal(clientArguments[0], "-n")
  assert.match(clientArguments[1], /^127\.0\.0\.1:\d+$/)
  const profile = path.join(environment.XDG_DATA_HOME, "openttd")
  assert.equal(existsSync(path.join(environment.XDG_RUNTIME_DIR, "edenagent-openttd", "active-instance.json")), false)
  assert.deepEqual(readdirSync(profile).filter((name) => name.startsWith(".edenagent-instance-")), [])
})

test("Linux host instances share persistent content and import legacy runtime content once", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async (t) => {
  const root = temporaryDirectory(t)
  const install = path.join(root, "install")
  mkdirSync(install, { recursive: true })
  const binary = writeFakeOpenTtd(install)
  const environment = launcherEnvironment(root, binary)
  const config = path.join(environment.HOME, ".config", "openttd", "openttd.cfg")
  const record = path.join(root, "launches.jsonl")
  environment.MON_OPENTTD_CONFIG = config
  environment.MON_TEST_LAUNCH_RECORD = record
  mkdirSync(path.dirname(config), { recursive: true })
  writeFileSync(config, "[network]\nserver_name = test\n", "utf8")

  const legacyRoot = path.join(environment.XDG_RUNTIME_DIR, "edenagent-openttd", "instances", "legacy")
  const legacyDownload = path.join(legacyRoot, "content_download", "newgrf", "legacy.tar")
  const legacySave = path.join(legacyRoot, "save", "edenagent-route.sav")
  const profile = path.join(environment.XDG_DATA_HOME, "openttd")
  const persistentSave = path.join(profile, "save", "edenagent-route.sav")
  mkdirSync(path.dirname(legacyDownload), { recursive: true })
  mkdirSync(path.dirname(legacySave), { recursive: true })
  mkdirSync(path.dirname(persistentSave), { recursive: true })
  writeFileSync(legacyDownload, "legacy", "utf8")
  writeFileSync(legacySave, "fresh", "utf8")
  writeFileSync(persistentSave, "stale", "utf8")
  utimesSync(persistentSave, new Date(1_000), new Date(1_000))

  for (let index = 0; index < 2; index += 1) {
    const result = await runLauncher([], environment)
    assert.equal(result.code, 0, result.stderr)
  }

  const launches = readFileSync(record, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line))
  assert.equal(launches.length, 2)
  assert.notEqual(launches[0].config, launches[1].config)
  assert.equal(launches[0].profile, profile)
  assert.equal(launches[1].profile, profile)
  assert.equal(launches[0].existedBefore, false)
  assert.equal(launches[1].existedBefore, true)
  assert.equal(readFileSync(legacyDownload.replace(legacyRoot, profile), "utf8"), "legacy")
  assert.equal(readFileSync(path.join(profile, "content_download", "newgrf", "downloaded.tar"), "utf8"), "persistent")
  assert.equal(readFileSync(persistentSave, "utf8"), "fresh")
  assert.equal(existsSync(path.join(profile, ".edenagent-runtime-content-migrated-v1")), true)
  assert.equal(existsSync(path.join(environment.XDG_RUNTIME_DIR, "edenagent-openttd", "active-instance.json")), false)
  for (const name of ["ai", "baseset", "content_download", "game", "newgrf", "save", "scenario", "screenshot", "social_integration"])
    assert.equal(lstatSync(path.join(profile, name)).isSymbolicLink(), false, name)
})

test("invalid registry and configuration inputs fail closed", (t) => {
  const directory = temporaryDirectory(t)
  const registry = path.join(directory, "active-instance.json")
  const config = path.resolve(directory, "instance.cfg")
  const invalid = run([
    "write-registry",
    registry,
    "not-an-instance-id",
    "127.0.0.1",
    "41234",
    "41234",
    String(process.pid),
    "dedicated",
    config,
    process.execPath,
  ])
  assert.notEqual(invalid.status, 0)

  writeFileSync(registry, JSON.stringify({ pid: process.pid }), "utf8")
  const fields = run(["fields", registry])
  assert.notEqual(fields.status, 0)
  assert.match(fields.stderr, /invalid instance_id/)
})

test("port allocator returns two distinct ephemeral ports", () => {
  const result = run(["ports"])
  assert.equal(result.status, 0, result.stderr)
  const ports = result.stdout.trim().split(/\r?\n/).map(Number)
  assert.equal(ports.length, 2)
  assert.notEqual(ports[0], ports[1])
  for (const value of ports) assert.ok(Number.isInteger(value) && value > 0 && value <= 65535)
})

test("Linux launcher keeps content persistent and cleans only identity-matched runtime files", () => {
  const source = readFileSync(shellLauncher, "utf8")
  for (const directory of [
    "ai", "baseset", "content_download", "game", "newgrf", "save", "scenario", "screenshot", "social_integration",
  ]) {
    assert.match(source, new RegExp(`\\b${directory}\\b`))
  }
  assert.match(source, /\.edenagent-runtime-content-migrated-v1/)
  assert.match(source, /\.edenagent-instance-\$\{instance_id\}\.cfg/)
  assert.match(source, /remove-if-matches/)
  assert.match(source, /current\[6\].*OPEN_TTD_BIN/)
  assert.match(source, /stop_managed_instance "\$\{old_instance\[2\]\}"/)
  assert.match(source, /printf '%s' "\$\{admin_password\}" \| node "\$\{HELPER\}" configure/)
  assert.match(source, /install-bridge "\$\{OPEN_TTD_BRIDGE\}" "\$\{OPEN_TTD_DATA\}"/)
  assert.doesNotMatch(source, /python(?:3)?\b/)
  assert.doesNotMatch(source, /ln -s/)
})
