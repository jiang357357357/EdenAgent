import { createHash, randomUUID } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  lstatSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const connectorId = process.argv[2]
const profileIndex = process.argv.indexOf("--profile")
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : "debug"

if (!connectorId || !/^[a-z][a-z0-9.-]*$/.test(connectorId)) {
  throw new Error("usage: node Script/Project/package_connector.mjs <connector-id> [--profile debug|release]")
}
if (!new Set(["debug", "release"]).has(profile)) {
  throw new Error(`unsupported Cargo profile: ${profile}`)
}

const sourceRoot = path.join(agentRoot, "Connectors", "official", connectorId, "package")
const manifestPath = path.join(sourceRoot, "connector.json")
if (!existsSync(manifestPath)) {
  throw new Error(`connector package source does not exist: ${manifestPath}`)
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (manifest.id !== connectorId) {
  throw new Error(`manifest ID ${manifest.id} does not match ${connectorId}`)
}
const pluginPath = path.join(sourceRoot, "plugin.json")
if (!existsSync(pluginPath)) {
  throw new Error(`official connector must also be a unified plugin bundle: ${pluginPath}`)
}
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"))
const nativeRuntime = plugin.components?.runtimes?.find(
  (runtime) => runtime.kind === "native_worker" && runtime.manifest === "connector.json",
)
if (plugin.schemaVersion !== 1 || !nativeRuntime || nativeRuntime.id !== connectorId) {
  throw new Error(`plugin manifest does not expose connector ${connectorId} as a native_worker`)
}
for (const permission of manifest.permissions ?? []) {
  const declared = (plugin.permissions ?? []).some(
    (outer) => outer.capability === permission.capability
      && outer.resource === permission.resource
      && outer.access === permission.access,
  )
  if (!declared) {
    throw new Error(`plugin manifest does not declare connector permission ${permission.capability} ${permission.access} ${permission.resource}`)
  }
}

const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
const architecture = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch
const platformKey = `${platform}-${architecture}`
const entrypoint = manifest.entrypoints?.[platformKey]
if (!entrypoint?.path) {
  throw new Error(`connector ${connectorId} has no ${platformKey} entrypoint`)
}
if (path.isAbsolute(entrypoint.path) || entrypoint.path.includes('\\')
  || entrypoint.path.split('/').some((part) => !part || part === '.' || part === '..')) {
  throw new Error('Worker entrypoint must be a relative package path')
}
const binaryName = path.basename(entrypoint.path)
const builtBinary = path.join(agentRoot, "target", profile, binaryName)
if (!existsSync(builtBinary) || !lstatSync(builtBinary).isFile()) {
  throw new Error(`worker binary is missing; build it first: ${builtBinary}`)
}

const connectorsRoot = path.join(agentRoot, "dist", "connectors")
const packagesRoot = connectorsRoot
const destination = path.join(packagesRoot, connectorId)
const staging = path.join(connectorsRoot, `.staging-${connectorId}-${randomUUID()}`)
const backup = path.join(connectorsRoot, `.backup-${connectorId}-${randomUUID()}`)
mkdirSync(packagesRoot, { recursive: true })

try {
  cpSync(sourceRoot, staging, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceRoot, source)
      if (relative === "checksums.json" || relative === "signature.json" || relative.split(path.sep)[0] === "workers") return false
      if (lstatSync(source).isSymbolicLink()) throw new Error(`Package contains a symbolic link: ${relative}`)
      return true
    },
  })
  const stagedWorker = path.join(staging, entrypoint.path)
  mkdirSync(path.dirname(stagedWorker), { recursive: true })
  cpSync(builtBinary, stagedWorker)

  const checksums = {}
  for (const file of walkFiles(staging)) {
    const relative = path.relative(staging, file).split(path.sep).join("/")
    checksums[relative] = createHash("sha256").update(readFileSync(file)).digest("hex")
  }
  writeFileSync(path.join(staging, "checksums.json"), `${JSON.stringify(checksums, null, 2)}\n`, "utf8")

  if (existsSync(destination)) renameSync(destination, backup)
  renameSync(staging, destination)
  if (existsSync(backup)) {
    try {
      rmSync(backup, { recursive: true, force: true })
    } catch (error) {
      console.warn(`old package backup remains until its Worker exits: ${backup} (${error.message})`)
    }
  }
} catch (error) {
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
  if (!existsSync(destination) && existsSync(backup)) renameSync(backup, destination)
  throw error
}

console.log(JSON.stringify({ connectorId, platform: platformKey, profile, destination }, null, 2))

function walkFiles(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(target))
    else if (entry.isFile()) files.push(target)
  }
  return files.sort()
}
