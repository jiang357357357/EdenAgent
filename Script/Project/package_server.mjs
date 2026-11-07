import { chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serverDependencyPlan } from './server_dependency_plan.mjs'
import { packageVideoRuntime } from './video_resources.mjs'
import { packageDesktopControl } from './desktop_resources.mjs'
import { buildTui } from '../../Server/scripts/build-tui.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const platform = process.env.EDEN_AGENT_PACKAGE_PLATFORM ?? process.platform
const arch = process.env.EDEN_AGENT_PACKAGE_ARCH ?? process.arch
const nodeExecutable = path.resolve(process.env.EDEN_AGENT_PACKAGE_NODE ?? process.execPath)
if (!['win32', 'linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported runtime target')
const output = path.resolve(process.argv[2] ?? path.join(root, 'dist', `runtime-${process.platform}-${process.arch}`))
if (process.argv.length > 3) throw new Error('Usage: node Script/Project/package_server.mjs [new-output-directory]')
if (existsSync(output)) throw new Error(`Refusing to replace existing runtime directory: ${output}`)
if (process.versions.node !== '22.23.1') throw new Error('Package with the pinned Node 22.23.1 runtime')
const buildDirectory = path.resolve(process.env.EDEN_AGENT_BUILD_DIR ?? path.join(root, 'dist/server'))
const entry = path.join(buildDirectory, 'main.mjs')
await stat(entry)
const runtimeProcess = path.join(buildDirectory, 'runtime-process.mjs')
await stat(runtimeProcess)
const connectorSdk = path.join(buildDirectory, 'connector-sdk.mjs')
await stat(connectorSdk)
const searchWorker = path.join(buildDirectory, 'workspace-search-worker.mjs')
await stat(searchWorker)
const sharedHost = path.join(buildDirectory, 'shared-workspace-host.mjs')
await stat(sharedHost)
const sharedHostInstaller = path.join(buildDirectory, 'shared-workspace-install.mjs')
await stat(sharedHostInstaller)
const tuiEntry = path.join(buildDirectory, 'tui.mjs')
if (process.env.EDEN_AGENT_TUI_PREBUILT !== '1') await buildTui(root, tuiEntry)
await stat(tuiEntry)
const packages = serverDependencyPlan(root).filter(dependency => {
  const manifest = JSON.parse(readFileSync(path.join(dependency.source, 'package.json'), 'utf8'))
  const matches = (rules, target) => !rules || (!rules.includes(`!${target}`)
    && (rules.every(rule => rule.startsWith('!')) || rules.includes(target) || rules.includes('any')))
  return matches(manifest.os, platform) && matches(manifest.cpu, arch)
})
const nodeDirectory = path.dirname(nodeExecutable)
const license = [path.join(nodeDirectory, 'LICENSE'), path.join(nodeDirectory, '../LICENSE')].find(existsSync)
if (!license) throw new Error('The Node distribution LICENSE must be present alongside the runtime')
const staging = `${output}.staging-${randomUUID()}`
await mkdir(staging, { recursive: true })
try {
  const connectors = [] // Connectors are installed independently, never bundled from local build output.
  await mkdir(path.join(staging, 'server'))
  await packageVideoRuntime(root, path.join(staging, 'server'))
  await cp(entry, path.join(staging, 'server/main.mjs'))
  await cp(`${entry}.map`, path.join(staging, 'server/main.mjs.map'))
  for (const name of ['LICENSE', 'NOTICE'])
    await cp(path.join(root, 'Server/src/model-prompts', `dsh-purge.${name}`), path.join(staging, 'server', `dsh-purge.${name}`))
  await cp(runtimeProcess, path.join(staging, 'server/runtime-process.mjs'))
  await cp(connectorSdk, path.join(staging, 'server/connector-sdk.mjs'))
  await cp(`${runtimeProcess}.map`, path.join(staging, 'server/runtime-process.mjs.map'))
  await cp(searchWorker, path.join(staging, 'server/workspace-search-worker.mjs'))
  await cp(`${searchWorker}.map`, path.join(staging, 'server/workspace-search-worker.mjs.map'))
  await cp(sharedHost, path.join(staging, 'server/shared-workspace-host.mjs'))
  await cp(sharedHostInstaller, path.join(staging, 'server/shared-workspace-install.mjs'))
  const desktopControl = await packageDesktopControl(root, path.join(staging, 'server'), buildDirectory, platform)
  await cp(tuiEntry, path.join(staging, 'server/tui.mjs'))
  await cp(`${tuiEntry}.map`, path.join(staging, 'server/tui.mjs.map'))
  await mkdir(path.join(staging, 'bin'))
  await cp(path.join(root, 'Server/bin/eden'), path.join(staging, 'bin/eden'))
  await cp(path.join(root, 'Server/bin/eden.cmd'), path.join(staging, 'bin/eden.cmd'))
  if (platform !== 'win32') {
    const launcher = path.join(staging, 'bin/eden')
    await writeFile(launcher, (await readFile(launcher, 'utf8')).replace(/\r\n/g, '\n'))
  }
  await chmod(path.join(staging, 'bin/eden'), 0o755)
  await mkdir(path.join(staging, 'node'))
  await cp(nodeExecutable, path.join(staging, 'node', platform === 'win32' ? 'node.exe' : 'node'))
  await cp(license, path.join(staging, 'node/LICENSE'))
  for (const dependency of packages) {
    await cp(dependency.source, path.join(staging, 'node_modules', dependency.relative), {
      recursive: true, filter: source => {
        if (path.basename(source) === 'node_modules') return false
        if (dependency.name === 'ssh2' && path.relative(dependency.source, source).split(path.sep)[0] === 'test') return false
        if (dependency.name !== 'onnxruntime-node') return true
        const parts = path.relative(dependency.source, source).split(path.sep)
        if (parts[0] !== 'bin' || parts[1] !== 'napi-v6') return true
        if (parts.length > 2 && parts[2] !== platform) return false
        return parts.length <= 3 || parts[3] === arch
      },
    })
  }
  const lock = await readFile(path.join(root, 'package-lock.json'))
  const sha256 = value => createHash('sha256').update(value).digest('hex')
  await writeFile(path.join(staging, 'runtime-manifest.json'), JSON.stringify({
    format: 1, platform, arch, node: process.versions.node,
    localCapabilities: { owner: 'eden-agent-ts', language: 'typescript', mcpPort: 40072, embedding: 'onnxruntime-node',
      video: { engine: 'videocontext-mcp', commit: 'b1495070863fc65372c986df52f992b9e5f40c02', runtime: 'server/video-runtime' } },
    entry: 'server/main.mjs', lockSha256: sha256(lock), entrySha256: sha256(await readFile(entry)),
    runtimeProcess: 'server/runtime-process.mjs', runtimeProcessSha256: sha256(await readFile(runtimeProcess)),
    connectorSdk: 'server/connector-sdk.mjs', connectorSdkSha256: sha256(await readFile(connectorSdk)),
    searchWorker: 'server/workspace-search-worker.mjs', searchWorkerSha256: sha256(await readFile(searchWorker)),
    sharedHost: 'server/shared-workspace-host.mjs', sharedHostSha256: sha256(await readFile(sharedHost)),
    sharedHostInstaller: 'server/shared-workspace-install.mjs', sharedHostInstallerSha256: sha256(await readFile(sharedHostInstaller)),
    tuiEntry: 'server/tui.mjs', tuiEntrySha256: sha256(await readFile(tuiEntry)), tuiCommand: 'bin/eden',
    packages: packages.map(({ source, ...dependency }) => ({ ...dependency, relative: dependency.relative.split(path.sep).join('/') })), connectors, desktopControl,
  }, null, 2) + '\n')
  await rename(staging, output)
  process.stdout.write(`Packaged ${packages.length} runtime dependencies: ${output}\n`)
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}
