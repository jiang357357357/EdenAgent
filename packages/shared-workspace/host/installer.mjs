// Executed on a Linux SSH host. The caller prefixes a JSON constant named edenDeploymentInput.
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { installHostRuntime } from './runtime-install.mjs'
import { installBootService, stopMonpmDaemon } from './boot-service.mjs'

const execute = promisify(execFile)
const input = edenDeploymentInput
const app = 'shared-workspace-host'
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
const fail = code => { throw new Error(code) }
async function command(executable, args) {
  try { return (await execute(executable, args, { timeout: 20_000, maxBuffer: 128 * 1024, encoding: 'utf8' })).stdout }
  catch (error) {
    if (input.deploymentRoot) await fs.appendFile(path.join(input.deploymentRoot, 'deployment.log'), JSON.stringify({
      executable, action: args[0], message: error.message, stderr: String(error.stderr ?? '').slice(-8000),
    }) + '\n', { mode: 0o600 })
    throw error
  }
}
async function info(filename) {
  try { return await fs.lstat(filename) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function regular(filename, directory = false) {
  const value = await info(filename)
  if (value && (value.isSymbolicLink() || (directory ? !value.isDirectory() : !value.isFile()))) fail('unsafe_path')
  return value
}
async function prepareDirectory() {
  const root = path.resolve(input.directory || path.join(os.homedir(), '.local/share/eden-shared-host'))
  if (!path.isAbsolute(input.directory || root) || root === '/' || root.split('/').filter(Boolean).length < 2) fail('unsafe_path')
  // Refuse symlinked ancestors and installation directories, including a symlink to another EDEN install.
  let parent = root
  while (parent !== '/') { await regular(parent, true); parent = path.dirname(parent) }
  const stat = await regular(root, true)
  if (stat && stat.uid !== process.getuid()) fail('unsafe_path')
  const markerPath = path.join(root, '.eden-shared-host.json')
  const marker = await regular(markerPath)
  if (marker) {
    const value = JSON.parse(await fs.readFile(markerPath, 'utf8'))
    if (value.kind !== 'eden-shared-host' || value.administrator.deviceId !== input.administrator.deviceId
      || value.administrator.publicKey !== input.administrator.publicKey) fail('wrong_owner')
  } else if (stat && (await fs.readdir(root)).length) fail('unmanaged_directory')
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  await fs.chmod(root, 0o700)
  if (!marker) await fs.writeFile(markerPath, JSON.stringify({ kind: 'eden-shared-host', administrator: input.administrator,
    preparing: true }), { mode: 0o600, flag: 'wx' })
  return { root, markerPath }
}
async function runtime() {
  if (process.platform !== 'linux') fail('linux_required')
  const [major, minor, patch] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && (minor < 23 || (minor === 23 && patch < 1)))) fail('node_version')
  let version
  try { version = JSON.parse(await command(input.monpmPath, ['version', '--json'])) } catch { fail('monpm_missing') }
  if (version.ipcProtocolVersion !== 2 || version.maxConfigSchemaVersion < 2) fail('monpm_version')
}
function config(root) {
  return { version: 2, log_dir: path.join(root, 'data/logs'), apps: [{ name: app, command: input.nodePath,
    args: [path.join(root, 'eden-shared-host.mjs'), '--data', path.join(root, 'data'), '--name', input.name,
      '--host', '0.0.0.0', '--port', String(input.servicePort), '--public-address', input.publicAddress], cwd: root,
    env: input.privateLibraryPath ? { LD_LIBRARY_PATH: input.privateLibraryPath } : {},
    auto_start: true, auto_restart: true, ports: [input.servicePort],
    healthcheck: { type: 'tcp', address: `127.0.0.1:${input.servicePort}`, interval_ms: 5000, timeout_ms: 1500,
      retries: 5, start_period_ms: 10000, restart_on_failure: true } }] }
}
async function lock(root) {
  const filename = path.join(root, '.deployment.lock')
  await regular(filename)
  try {
    const owner = JSON.parse(await fs.readFile(filename, 'utf8'))
    try { process.kill(owner.pid, 0); fail('deployment_busy') } catch (error) { if (error.code !== 'ESRCH') throw error }
    await fs.unlink(filename)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const handle = await fs.open(filename, 'wx', 0o600)
  await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.close()
  return () => fs.unlink(filename)
}
async function install(root, markerPath) {
  const entry = path.join(root, 'eden-shared-host.mjs'), cfg = path.join(root, 'shared-host.monpm.json')
  const previous = await regular(cfg)
  await regular(entry)
  await regular(path.join(root, 'data'), true)
  await regular(path.join(root, 'data/host-setup.json'))
  await regular(path.join(root, 'data/logs'), true)
  if (previous) {
    const old = JSON.parse(await fs.readFile(cfg, 'utf8'))
    if (old.version !== 2 || old.apps?.length !== 1 || old.apps[0].name !== app || old.apps[0].args?.[0] !== entry) fail('unmanaged_directory')
  }
  emit({ phase: 'uploading' })
  const bytes = Buffer.from(input.contentBase64, 'base64')
  if (createHash('sha256').update(bytes).digest('hex') !== input.sha256) fail('hash_mismatch')
  const stage = await fs.mkdtemp(path.join(root, '.upload-'))
  try {
    const entryStage = path.join(stage, 'host.mjs'), configStage = path.join(stage, 'config.json')
    await fs.writeFile(entryStage, bytes, { mode: 0o600, flag: 'wx' })
    await fs.writeFile(configStage, JSON.stringify(config(root), null, 2), { mode: 0o600, flag: 'wx' })
    await command(process.execPath, ['--check', entryStage])
    await command(input.monpmPath, ['config', 'check', '-config', configStage, '-json'])
    if (previous) {
      const backupRoot = path.join(root, 'backups')
      await regular(backupRoot, true)
      const backup = path.join(backupRoot, randomUUID())
      await fs.mkdir(backup, { recursive: true, mode: 0o700 })
      await fs.copyFile(entry, path.join(backup, 'eden-shared-host.mjs'))
      await fs.copyFile(cfg, path.join(backup, 'shared-host.monpm.json'))
      await command(input.monpmPath, ['stop', app, '-config', cfg])
    }
    await fs.rename(entryStage, entry); await fs.rename(configStage, cfg)
    await fs.writeFile(markerPath, JSON.stringify({ kind: 'eden-shared-host', administrator: input.administrator,
      sha256: input.sha256, installedAt: Date.now() }), { mode: 0o600 })
    emit({ phase: 'starting' })
    if (previous) await stopMonpmDaemon(input.monpmPath, cfg, command)
    let bootService = false
    try {
      if (!input.installService) throw new Error('boot_service_disabled')
      await installBootService(input.monpmPath, cfg, command)
      bootService = true
    } catch {
      // Some SSH accounts have no systemd user bus/linger permission. The result reports this explicitly.
      emit({ event: 'boot_service_unavailable' })
    }
    await command(input.monpmPath, ['reload', '-config', cfg])
    await command(input.monpmPath, ['start', app, '-config', cfg])
    emit({ event: 'started', address: input.publicAddress, bootService })
    return { cfg, bootService }
  } finally {
    // Only remove the exact temporary directory created by this invocation.
    for (const name of ['host.mjs', 'config.json']) await fs.unlink(path.join(stage, name)).catch(error => { if (error.code !== 'ENOENT') throw error })
    await fs.rmdir(stage)
  }
}
async function invitation(cfg) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const text = await command(input.monpmPath, ['logs', app, '-config', cfg, '-stream', 'stdout', '-tail', '80'])
    let result
    for (const line of text.split('\n')) {
      try {
        const item = JSON.parse(line.slice(line.indexOf('{')))
        if (item.event === 'shared_host_pairing_invitation' && item.expiresAt > Date.now() + 10_000) result = item
      } catch { /* MonPM also emits human-readable log headers. */ }
    }
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  fail('host_not_ready')
}
try {
  emit({ phase: 'preflight' }); await runtime()
  const { root, markerPath } = await prepareDirectory(), release = await lock(root)
  try {
    input.deploymentRoot = root
    emit({ event: 'prepared', directory: root })
    emit({ phase: 'dependencies' })
    const installed = await installHostRuntime(root, input.runtime)
    input.nodePath = installed.node; input.monpmPath = installed.monpm
    input.privateLibraryPath = input.runtime.usePrivateLibraries ? installed.libraryPath : undefined
    const { cfg, bootService } = await install(root, markerPath)
    const ready = await invitation(cfg)
    emit({ event: 'ready', code: ready.code, address: input.publicAddress, directory: root, bootService })
  } finally { await release() }
} catch (error) {
  emit({ event: 'error', code: error.message }); process.exitCode = 1
}
