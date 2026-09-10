import { snapshotWorkerPackage } from './worker-package-snapshot.ts'
import { spawn } from 'node:child_process'
import { snapshotWorker } from './worker-snapshot.ts'
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { hostProcessEnvironment } from './host-environment.ts'
import { stopWindowsProcessTree } from './windows-process.ts'
export interface ConnectorProcessRequest {
  runtime?: 'native' | 'node'
  executable: string
  packageSnapshot?: { files: ReadonlyMap<string, Buffer>; entrypoint: string } | undefined
  sha256: string
  args?: string[]
  dataDirectory: string
  /** Host-created socket directory, never a user-selected filesystem grant. */
  adminBridgeDirectory?: string
  httpsBridgeDirectory?: string
  networkBridgeDirectory?: string
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
/** Runs as current OS account. Sandbox restoration requires developer review. */
export async function launchConnectorProcess(request: ConnectorProcessRequest): Promise<ConnectorProcess> {
  request.signal.throwIfAborted()
  const executable = request.packageSnapshot ? null : canonical(request.executable, false), dataDirectory = canonical(request.dataDirectory, true)
  if ((executable && lstatSync(executable).size > 128 * 1024 * 1024) || !/^[a-f0-9]{64}$/.test(request.sha256)) throw new Error('Invalid connector executable digest or size')
  if (request.readMounts.length > 16) throw new Error('Too many connector read grants')
  if ([request.adminBridgeDirectory, request.httpsBridgeDirectory, request.networkBridgeDirectory].filter(Boolean).length > 1) throw new Error('Only one connector network bridge is allowed')
  const environment = connectorEnvironment(request)
  for (const mount of [...request.readMounts, ...request.writeMounts ?? []]) realpathSync(mount.source)
  const workerArgs = connectorWorkerArguments(request)
  const snapshot = request.packageSnapshot
    ? await snapshotWorkerPackage(request.packageSnapshot.files, request.packageSnapshot.entrypoint, request.sha256, request.signal)
    : { ...await snapshotWorker(executable!, request.sha256, request.signal), root: undefined, guestExecutable: '/worker/connector', cwd: '/data' }
  const command = request.runtime === 'node' ? process.execPath : snapshot.executable
  const args = request.runtime === 'node' ? [snapshot.executable, ...workerArgs] : workerArgs
  const child = (() => {
    try { return spawn(command, args, { cwd: snapshot.root ?? dataDirectory, env: environment, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true }) }
    catch (error) { void snapshot.cleanup().catch(() => { process.stderr.write('Worker launch snapshot cleanup failed\n') }); throw error }
  })()
  let finished = false, stderrBytes = 0
  let termination: Promise<void> | undefined
  const kill = () => {
    if (finished || !child.pid) return
    if (process.platform === 'win32') {
      termination ??= stopWindowsProcessTree(child.pid).catch(error => { child.kill('SIGKILL'); throw error })
      void termination.catch(() => {})
      return
    }
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) child.kill('SIGKILL')
    }
  }
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => {
    child.once('close', (code, signal) => { finished = true; request.signal.removeEventListener('abort', kill); resolve({ code, signal }) })
  }).then(async result => { try { await termination } finally { await snapshot.cleanup() }; return result })
  void exited.catch(() => { process.stderr.write('Worker exit snapshot cleanup failed\n') })
  // Drain private stderr without returning secrets; excessive worker logging terminates the process.
  child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 1024 * 1024) kill() })
  child.stdin.on('error', () => kill())
  request.signal.addEventListener('abort', kill, { once: true })
  if (request.signal.aborted) kill()
  try {
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('Connector host process failed to spawn'))) })
    request.signal.throwIfAborted()
  } catch (error) { kill(); await exited; throw error }
  return { input: child.stdin, output: child.stdout, exited, async stop() { kill(); await exited } }
}

function connectorWorkerArguments(request: ConnectorProcessRequest) {
  const workerArgs = request.args ?? []
  if (workerArgs.length > 32 || workerArgs.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) throw new Error('Invalid connector worker arguments')
  return workerArgs
}

function connectorEnvironment(request: ConnectorProcessRequest) {
  const environment: NodeJS.ProcessEnv = hostProcessEnvironment()
  if (request.identity) {
    if (!request.identity.key || request.identity.key.length > 256 || !request.identity.credential || request.identity.credential.length > 16384
      || /[\r\n\0]/.test(request.identity.key + request.identity.credential)) throw new Error('Invalid private connector identity')
    environment.MON_CONNECTOR_IDENTITY_KEY = request.identity.key
    environment.MON_CONNECTOR_IDENTITY_CREDENTIAL = request.identity.credential
  }
  if (request.adminBridgeDirectory) environment.MON_CONNECTOR_ADMIN_SOCKET = path.join(request.adminBridgeDirectory, 'transport.sock')
  if (request.httpsBridgeDirectory) environment.MON_CONNECTOR_HTTPS_SOCKET = path.join(request.httpsBridgeDirectory, 'transport.sock')
  if (request.networkBridgeDirectory) environment.EDEN_CONNECTOR_NETWORK_SOCKET = path.join(request.networkBridgeDirectory, 'transport.sock')
  return environment
}
