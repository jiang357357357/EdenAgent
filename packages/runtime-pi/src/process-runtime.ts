import { fork } from 'node:child_process'
import { AsyncResource } from 'node:async_hooks'
import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import type { EdenRuntime, RuntimeOptions } from './contracts.ts'
import { ProcessPeer } from './process-protocol.ts'
import type { ProcessMessage, ProcessOptions } from './process-protocol.ts'
import { ProcessTools } from './process-tools.ts'
import { ProcessDeadline } from './process-deadline.ts'
import { resolveProcessPolicy, type ProcessPolicy } from './process-policy.ts'
import { ProcessDiagnostics } from './process-diagnostics.ts'
import { RuntimeCancellationError, RuntimeProcessError } from './process-error.ts'

declare const EDEN_BUNDLED_SERVER: boolean
export interface IsolatedRuntime extends EdenRuntime { dispose(): Promise<void>; completeText(text: string): Promise<string> }

/** A failed or stalled model process cannot take the account's socket loop with it. */
export function createIsolatedRuntime(options: RuntimeOptions, policy: ProcessPolicy = {}): IsolatedRuntime {
  const bundled = typeof EDEN_BUNDLED_SERVER !== 'undefined' && EDEN_BUNDLED_SERVER
  const limits = resolveProcessPolicy(policy)
  const spawnOptions = {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] as ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced' as const, windowsHide: true,
    execArgv: [`--max-old-space-size=${limits.maxOldSpaceMb}`, ...(bundled || policy.entry ? [] : ['--import', import.meta.resolve('tsx')])],
  }
  const child = fork(policy.entry ?? new URL(bundled ? './runtime-process.mjs' : './process-entry.ts', import.meta.url), [], spawnOptions)
  const diagnostics = new ProcessDiagnostics(options.sessionId, child.pid, limits.maxOldSpaceMb, options.callbacks.diagnostic)
  diagnostics.attach(child.stdout!, child.stderr!)
  diagnostics.emit('runtime.process.started')
  const exited = new Promise<void>(resolve => { child.once('close', () => resolve()) })
  const controller = new AbortController()
  let failure: Error | undefined
  let disposed = false
  let stopping: Promise<void> | undefined
  let initialized = false
  const healthy = () => { if (failure) throw failure; if (disposed) throw new Error('Runtime process is disposed') }
  const fail = (error: unknown): never => {
    failure ??= error instanceof Error ? error : new Error(String(error))
    controller.abort(failure)
    throw failure
  }
  const tools = new ProcessTools(options, controller.signal, healthy, fail)
  const dispatch = async (method: string, args: unknown[]): Promise<unknown> => {
    healthy()
    if (method === 'executeTool') {
      diagnostics.tool(tools.name(args[0] as number), args[1] as string)
      return tools.execute(args[0] as number, args[1] as string, args[2])
    }
    if (method === 'refreshTools') return tools.describe(await options.refreshTools!())
    try {
      switch (method) {
        case 'checkpoint': return await options.callbacks.checkpoint(args[0] as RuntimeCheckpoint)
        case 'event': return await options.callbacks.event(args[0] as string, args[1] as JsonValue,
          (args[2] as { coalesced?: boolean } | undefined)?.coalesced === true ? { coalesced: true } : undefined)
        case 'request': return await options.callbacks.request(args[0] as JsonValue)
        case 'response': return await options.callbacks.response?.(args[0] as JsonValue)
        default: throw new Error(`Unknown host operation: ${method}`)
      }
    } catch (error) { return fail(error) }
  }
  const peer = new ProcessPeer(message => {
    if (!child.connected) throw new Error('Runtime process disconnected')
    child.send(message, error => { if (error) stop(error) })
  }, dispatch, () => failure !== undefined)
  const stop = (error: Error) => {
    failure ??= error
    controller.abort(failure)
    peer.close(failure)
    watchdog.stop()
    child.kill('SIGKILL')
  }
  const watchdog = new ProcessDeadline(() => initialized ? limits.heartbeatTimeoutMs : limits.startupTimeoutMs,
    () => stop(new RuntimeProcessError('Runtime process stopped responding; this turn was interrupted', 'unresponsive')), Math.min(1_000, limits.heartbeatTimeoutMs))
  child.on('message', AsyncResource.bind((message: ProcessMessage) => {
    watchdog.touch()
    diagnostics.activity(message.type === 'heartbeat' ? message.memory : undefined)
    initialized = true
    if (message.type !== 'heartbeat') peer.receive(message)
  }))
  child.on('error', error => stop(new RuntimeProcessError('Runtime process could not start', 'startup', { cause: error })))
  child.on('exit', (code, signal) => stop(new RuntimeProcessError(`Runtime process exited (${signal ?? code}); this turn was interrupted`, diagnostics.outOfMemory ? 'out_of_memory' : 'crashed')))
  child.on('close', (code, signal) => diagnostics.closed(code, signal, failure?.message ?? 'Runtime process closed',
    failure instanceof RuntimeCancellationError ? 'cancelled' : failure instanceof RuntimeProcessError ? failure.kind : disposed ? 'disposed' : 'crashed'))
  const { callbacks: _callbacks, refreshTools: _refresh, tools: _tools, ...serializable } = options
  const startup = peer.call<void>('initialize', { ...serializable, tools: tools.describe(options.tools), refresh: !!options.refreshTools } satisfies ProcessOptions)
  // Observe startup immediately, including a child failure before the first command.
  void startup.catch(() => undefined)
  const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
    await startup; healthy()
    diagnostics.method(method)
    try { return await peer.call<T>(method, ...args) }
    catch (error) { throw failure ?? error }
  }
  const abort = (): Promise<void> => {
    if (stopping) return stopping
    controller.abort(new RuntimeCancellationError())
    stopping = new Promise<void>((resolve, reject) => {
      const timer = new ProcessDeadline(() => limits.abortTimeoutMs,
        () => { stop(new RuntimeCancellationError(true)); resolve() }, Math.min(250, limits.abortTimeoutMs))
      void call<void>('abort').then(() => { timer.stop(); resolve() }, error => {
        timer.stop()
        if (disposed) resolve(); else reject(error)
      })
    })
    return stopping
  }
  return {
    prompt: (text, images) => call('prompt', text, images), steer: (text, images) => call('steer', text, images),
    followUp: (text, images) => call('followUp', text, images), compact: instructions => call('compact', instructions),
    waitForIdle: () => call('waitForIdle'), snapshot: () => call('snapshot'),
    async replaceTools(items) { await call('waitForIdle'); await call('replaceTools', tools.describe(items)) }, abort,
    completeText: text => call('completeText', text),
    async dispose() {
      if (disposed) return
      disposed = true
      stop(new Error('Runtime process disposed'))
      await exited
    },
  }
}
