import type { Readable, Writable } from 'node:stream'
import { connectorWorkerInitializeSchema, connectorWorkerReadySchema, connectorPublishedEventSchema, connectorWorkerStatusSchema, connectorWorkerHealthSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { ConnectorRepository } from './repository.ts'
import type { ConnectorEventRepository } from './event-repository.ts'
import { WorkerChannel } from './worker-channel.ts'
/** Receives streams only from the owning isolated launcher; never spawns a process itself. */
export class ConnectorWorkerRuntime {
  private readonly controller = new AbortController()
  private readonly channel: WorkerChannel
  private ready = false
  private stopped = false
  private readonly bufferedEvents: JsonValue[] = []
  private capabilities = new Set<string>()
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private healthPending = false
  private closing: Promise<void> | undefined
  constructor(private readonly id: string, private readonly generation: string, input: Writable, output: Readable,
    private readonly repository: ConnectorRepository, private readonly events: ConnectorEventRepository,
    private readonly terminate: () => Promise<void>, private readonly authorize?: () => void, private readonly workerKey?: string) {
    this.channel = new WorkerChannel(input, output, (method, value) => this.notify(method, value), error => this.failed(error))
  }
  async initialize(raw: unknown, originalSettings?: JsonValue) {
    const params = connectorWorkerInitializeSchema.parse(raw)
    const current = this.repository.read(this.id)
    if (params.connectorInstanceId !== this.id || params.connectorKey !== (this.workerKey ?? current.connectorKey) || current.generation !== this.generation || current.desiredState !== 'connected') throw new Error('Connector initialization identity changed')
    if (JSON.stringify(originalSettings ?? params.settings) !== JSON.stringify(current.settings)) throw new Error('Connector initialization settings changed')
    try {
      this.repository.runtimeState(this.id, this.generation, 'connecting', null)
      const ready = connectorWorkerReadySchema.parse(await this.channel.request('initialize', toJson(params), this.controller.signal))
      this.assertCurrent()
      this.capabilities = new Set(ready.capabilities)
      this.ready = true
      await this.readHealth()
      for (const value of this.bufferedEvents.splice(0)) this.events.accept(this.id, this.generation, value)
      this.heartbeat = setInterval(() => { void this.health() }, 15000)
      this.heartbeat.unref()
      return ready
    } catch (error) { this.failed(error instanceof Error ? error : new Error('Connector initialization failed')); throw error }
  }
  /** Caller owns schema validation, approvals and a persisted operation intent for execute. */
  async invoke(method: 'query' | 'execute', capability: string, payload: JsonValue, operationId: string, signal: AbortSignal) {
    this.assertCurrent()
    if (!this.ready || !this.capabilities.has(capability)) throw new Error('Connector capability is not available')
    return this.channel.request(method, { capability, payload, operationId }, AbortSignal.any([signal, this.controller.signal]))
  }
  private assertCurrent() {
    try { this.authorize?.() }
    catch (error) { this.failed(new Error('Connector authorization is no longer valid')); throw error }
    const current = this.repository.read(this.id)
    if (this.stopped || current.generation !== this.generation || current.desiredState !== 'connected') throw new Error('Connector generation is no longer active')
  }
  private notify(method: string, value: JsonValue) {
    this.assertCurrent()
    if (method === 'event.publish') {
      const parsed = toJson(connectorPublishedEventSchema.parse(value))
      if (this.ready) this.events.accept(this.id, this.generation, parsed)
      else {
        if (this.bufferedEvents.length >= 8 || Buffer.byteLength(JSON.stringify(parsed)) > 256 * 1024) throw new Error('Connector startup event buffer exceeded')
        this.bufferedEvents.push(parsed)
      }
    } else if (method === 'worker.status') {
      const status = connectorWorkerStatusSchema.parse(value)
      if (['error', 'failed', 'disconnected'].includes(status.state)) throw new Error('Worker reported loss of connection')
      if (status.state === 'starting' || status.state === 'connecting') this.repository.runtimeState(this.id, this.generation, 'connecting', null)
      // Only a health response establishes online state; status details may contain private paths.
    }
    // worker.log is intentionally not published: worker logs may contain identity secrets.
  }
  private async health() {
    if (this.healthPending || this.stopped) return
    this.healthPending = true
    try {
      this.assertCurrent()
      await this.readHealth()
    } catch { this.failed(new Error('Connector health failed')) }
    finally { this.healthPending = false }
  }
  private async readHealth() {
    const result = connectorWorkerHealthSchema.parse(await this.channel.request('health', null, this.controller.signal, 10000))
    this.assertCurrent()
    if (!result.initialized || ['degraded', 'error', 'failed', 'disconnected'].includes(result.state)) throw new Error('Connector worker is unhealthy')
    this.repository.runtimeState(this.id, this.generation, ['ready', 'connected'].includes(result.state) ? 'connected' : 'connecting', null)
  }
  private failed(_error: Error) {
    if (this.stopped) return
    try { this.repository.runtimeState(this.id, this.generation, 'error', 'Connector worker stopped or violated its protocol') }
    finally { void this.close().catch(() => { process.stderr.write('Connector worker termination failed\n') }) }
  }
  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      this.stopped = true; this.ready = false
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.bufferedEvents.length = 0; this.controller.abort(); this.channel.close()
      await this.terminate()
    })
    return this.closing
  }
}
