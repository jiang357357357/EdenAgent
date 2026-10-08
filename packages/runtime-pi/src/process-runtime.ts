import { fork } from 'node:child_process'
import { AsyncResource } from 'node:async_hooks'
import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import type { EdenRuntime, RuntimeOptions } from './contracts.ts'
import { ProcessPeer } from './process-protocol.ts'
import type { ProcessMessage, ProcessOptions } from './process-protocol.ts'
import { ProcessTools } from './process-tools.ts'

declare const EDEN_BUNDLED_SERVER: boolean
export interface IsolatedRuntime extends EdenRuntime { dispose(): Promise<void>; completeText(text: string): Promise<string> }
interface ProcessPolicy { entry?: URL; heartbeatTimeoutMs?: number; startupTimeoutMs?: number; abortTimeoutMs?: number }

/** A failed or stalled model process cannot take the account's socket loop with it. */
export function createIsolatedRuntime(options: RuntimeOptions, policy: ProcessPolicy = {}): IsolatedRuntime {
  const bundled = typeof EDEN_BUNDLED_SERVER !== 'undefined' && EDEN_BUNDLED_SERVER
  const spawnOptions = {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'] as ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' as const, windowsHide: true,
    execArgv: ['--max-old-space-size=512', ...(bundled || policy.entry ? [] : ['--import', import.meta.resolve('tsx')])],
  }
  const child = fork(policy.entry ?? new URL(bundled ? './runtime-process.mjs' : './process-entry.ts', import.meta.url), [], spawnOptions)
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', () => resolve()) })
  const controller = new AbortController()
  let failure: Error | undefined
  let disposed = false
  let stopping: Promise<void> | undefined
  let lastHeartbeat = Date.now()
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
    if (method === 'executeTool') return tools.execute(args[0] as number, args[1] as string, args[2])
    if (method === 'refreshTools') return tools.describe(await options.refreshTools!())
    try {
      switch (method) {
        case 'checkpoint': return await options.callbacks.checkpoint(args[0] as RuntimeCheckpoint)
        case 'event': return await options.callbacks.event(args[0] as string, args[1] as JsonValue)
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
    clearInterval(watchdog)
    child.kill()
  }
  const watchdog = setInterval(() => {
    const timeout = initialized ? policy.heartbeatTimeoutMs ?? 15_000 : policy.startupTimeoutMs ?? 60_000
    if (Date.now() - lastHeartbeat > timeout) stop(new Error('Runtime process stopped responding; this turn was interrupted'))
  }, Math.min(1_000, policy.heartbeatTimeoutMs ?? 1_000))
  watchdog.unref()
  child.on('message', AsyncResource.bind((message: ProcessMessage) => {
    if (message.type === 'heartbeat') { lastHeartbeat = Date.now(); initialized = true }
    else peer.receive(message)
  }))
  child.on('error', error => stop(new Error('Runtime process could not start', { cause: error })))
  child.on('exit', (code, signal) => stop(new Error(`Runtime process exited (${signal ?? code}); this turn was interrupted`)))
  const { callbacks: _callbacks, refreshTools: _refresh, tools: _tools, ...serializable } = options
  const startup = peer.call<void>('initialize', { ...serializable, tools: tools.describe(options.tools), refresh: !!options.refreshTools } satisfies ProcessOptions)
  // Observe startup immediately, including a child failure before the first command.
  void startup.catch(() => undefined)
  const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
    await startup; healthy()
    try { return await peer.call<T>(method, ...args) }
    catch (error) { throw failure ?? error }
  }
  const abort = (): Promise<void> => {
    if (stopping) return stopping
    controller.abort(new Error('Runtime execution cancelled'))
    stopping = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { stop(new Error('Runtime cancellation deadline exceeded')); resolve() }, policy.abortTimeoutMs ?? 2_000)
      void call<void>('abort').then(() => { clearTimeout(timer); resolve() }, error => {
        clearTimeout(timer)
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
