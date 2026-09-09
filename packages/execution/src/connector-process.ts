import { snapshotWorkerPackage } from './worker-package-snapshot.ts'
import { spawn } from 'node:child_process'
import { snapshotWorker } from './worker-snapshot.ts'
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { sandboxArguments, sandboxExecutable } from './sandbox-arguments.ts'
export interface ConnectorProcessRequest {
  executable: string
  packageSnapshot?: { files: ReadonlyMap<string, Buffer>; entrypoint: string }
  sha256: string
  args?: string[]
  dataDirectory: string
  /** Host-created socket directory, never a user-selected filesystem grant. */
  adminBridgeDirectory?: string
  httpsBridgeDirectory?: string
  identity?: { key: string; credential: string }
  /** Trusted host has already resolved grants and rewritten worker settings to these guest paths. */
  writeMounts?: { source: string; target: string }[]
  readMounts: { source: string; target: string }[]
  signal: AbortSignal
}
export interface ConnectorProcess {
  input: Writable
  output: Readable
  exited: Promise<{ code: number | null; signal: string | null }>
  stop(): Promise<void>
}
function canonical(value: string, directory: boolean): string {
  if (!path.isAbsolute(value) || lstatSync(value).isSymbolicLink()) throw new Error('Connector resource requires an absolute nonsymlink path')
  const resolved = realpathSync(value), stat = lstatSync(resolved)
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Invalid connector resource type')
  return resolved
}
/** Network stays unshared. Networked workers require a separate approved network transport. */
export async function launchConnectorProcess(request: ConnectorProcessRequest): Promise<ConnectorProcess> {
  request.signal.throwIfAborted()
  const args = sandboxArguments()
  const executable = request.packageSnapshot ? null : canonical(request.executable, false), dataDirectory = canonical(request.dataDirectory, true)
  if ((executable && lstatSync(executable).size > 128 * 1024 * 1024) || !/^[a-f0-9]{64}$/.test(request.sha256)) throw new Error('Invalid connector executable digest or size')
  if (request.readMounts.length > 16) throw new Error('Too many connector read grants')
  args.push('--bind', dataDirectory, '/data', '--dir', '/inputs')
  if (request.adminBridgeDirectory && request.httpsBridgeDirectory) throw new Error('Only one connector network bridge is allowed')
  if (request.httpsBridgeDirectory) args.push('--ro-bind', canonical(request.httpsBridgeDirectory, true), '/network')
  if (request.adminBridgeDirectory) args.push('--ro-bind', canonical(request.adminBridgeDirectory, true), '/network')
  const environment: Record<string, string> = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }
  if (request.identity) {
    if (!request.identity.key || request.identity.key.length > 256 || !request.identity.credential || request.identity.credential.length > 16384
      || /[\r\n\0]/.test(request.identity.key + request.identity.credential)) throw new Error('Invalid private connector identity')
    environment.MON_CONNECTOR_IDENTITY_KEY = request.identity.key
    environment.MON_CONNECTOR_IDENTITY_CREDENTIAL = request.identity.credential
  }
  if (request.adminBridgeDirectory) environment.MON_CONNECTOR_ADMIN_SOCKET = '/network/transport.sock'
  if (request.httpsBridgeDirectory) environment.MON_CONNECTOR_HTTPS_SOCKET = '/network/transport.sock'
  const targets = new Set<string>()
  for (const mount of request.readMounts) {
    if (!/^\/inputs\/[a-zA-Z0-9_-]{1,64}$/.test(mount.target) || targets.has(mount.target)) throw new Error('Invalid connector sandbox mount target')
    targets.add(mount.target)
    const source = realpathSync(mount.source), stat = lstatSync(source)
    if (!path.isAbsolute(mount.source) || lstatSync(mount.source).isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Invalid connector read mount')
    args.push('--ro-bind', source, mount.target)
  }
  const writes = request.writeMounts ?? []
  if (writes.length > 4) throw new Error('Too many connector write grants')
  args.push('--dir', '/outputs')
  for (const mount of writes) {
    if (!/^\/outputs\/[a-zA-Z0-9_-]{1,64}$/.test(mount.target) || targets.has(mount.target)) throw new Error('Invalid connector write target')
    targets.add(mount.target)
    args.push('--bind', canonical(mount.source, true), mount.target)
  }
  const workerArgs = request.args ?? []
  if (workerArgs.length > 32 || workerArgs.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) throw new Error('Invalid connector worker arguments')
  const snapshot = request.packageSnapshot
    ? await snapshotWorkerPackage(request.packageSnapshot.files, request.packageSnapshot.entrypoint, request.sha256, request.signal)
    : { ...await snapshotWorker(executable!, request.sha256, request.signal), root: undefined, guestExecutable: '/worker/connector', cwd: '/data' }
  if (snapshot.root) args.push('--ro-bind', snapshot.root, '/package')
  else args.push('--dir', '/worker', '--ro-bind', snapshot.executable, '/worker/connector')
  args.push('--chdir', snapshot.cwd, '--', '/usr/bin/prlimit', '--as=1073741824:1073741824', '--nofile=128:128', '--fsize=67108864:67108864', '--', snapshot.guestExecutable, ...workerArgs)
  const child = (() => {
    try { return spawn(sandboxExecutable, args, { env: environment, stdio: ['pipe', 'pipe', 'pipe'], detached: true }) }
    catch (error) { void snapshot.cleanup().catch(() => { process.stderr.write('Worker launch snapshot cleanup failed\n') }); throw error }
  })()
  let finished = false, stderrBytes = 0
  const kill = () => {
    if (finished || !child.pid) return
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) child.kill('SIGKILL')
    }
  }
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => {
    child.once('close', (code, signal) => { finished = true; request.signal.removeEventListener('abort', kill); resolve({ code, signal }) })
  }).then(async result => { await snapshot.cleanup(); return result })
  void exited.catch(() => { process.stderr.write('Worker exit snapshot cleanup failed\n') })
  // Drain private stderr without returning secrets; excessive worker logging terminates the process.
  child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 1024 * 1024) kill() })
  child.stdin.on('error', () => kill())
  request.signal.addEventListener('abort', kill, { once: true })
  if (request.signal.aborted) kill()
  try {
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('Connector sandbox process failed to spawn'))) })
    request.signal.throwIfAborted()
  } catch (error) { kill(); await exited; throw error }
  return { input: child.stdin, output: child.stdout, exited, async stop() { kill(); await exited } }
}
