import { z } from 'zod'
import type { Readable, Writable } from 'node:stream'
import { connectorWorkerInitializeSchema, connectorPublishedEventSchema, connectorWorkerHealthSchema, jsonValue, toJson } from '@eden/api/connector'
import type { JsonValue } from '@eden/api/connector'
import type { ConnectorDefinition, ConnectorSession } from './contracts.ts'
import { WorkerFrameReader, encodeWorkerFrame, maxWorkerFrame } from './frames.ts'
import { ConnectorRequestError } from './errors.ts'

const requestSchema = z.object({ id: z.number().int().positive().safe(), method: z.string().max(128), params: jsonValue.default(null) }).strict()
const callSchema = z.object({ capability: z.string().min(1).max(128), payload: jsonValue, operationId: z.string().min(1).max(256) }).strict()
const eventAck = z.object({ ack: z.string(), result: z.object({ id: z.string().uuid(), jobId: z.string().uuid().nullable(), duplicate: z.boolean() }).strict().optional(), error: z.string().max(1000).optional() }).strict()

/** Sequential requests preserve action order; events may be published while an action awaits I/O. */
export async function runConnector(definition: ConnectorDefinition, input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const abort = new AbortController(), reader = new WorkerFrameReader()
  let session: ConnectorSession | undefined, initializing = false, closed = false, queued = 0
  let eventSequence = 0
  const confirmations = new Map<string, { resolve(value: { id: string; jobId: string | null; duplicate: boolean }): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  let chain = Promise.resolve()
  const write = (value: JsonValue) => {
    if (abort.signal.aborted || output.destroyed) throw new Error('Connector output is closed')
    if (output.writableLength > maxWorkerFrame) throw new Error('Connector output queue exceeded limit')
    output.write(encodeWorkerFrame(value))
  }
  const rejectConfirmations = () => {
    for (const pending of confirmations.values()) { clearTimeout(pending.timer); pending.reject(new Error('Event acknowledgment unavailable; outcome may be unknown')) }
    confirmations.clear()
  }
  const stop = () => { abort.abort(); rejectConfirmations(); input.destroy() }
  const close = async () => {
    if (closed) return
    closed = true; abort.abort(); rejectConfirmations()
    await session?.close()
  }
  const initialize = async (raw: JsonValue) => {
    if (initializing || session || closed) throw new Error('Connector is already initialized or closed')
    const params = connectorWorkerInitializeSchema.parse(raw)
    if (params.connectorKey !== definition.id || params.packageVersion !== definition.version) throw new Error('Connector identity or version mismatch')
    initializing = true
    session = await definition.initialize({ ...params, signal: abort.signal,
      publish(eventType, externalId, payload) {
        if (!definition.events.includes(eventType)) throw new Error('Undeclared connector event')
        write({ method: 'event.publish', params: connectorPublishedEventSchema.parse({ eventType, externalId, payload }) })
      },
      publishConfirmed(eventType, externalId, payload) {
        if (!definition.events.includes(eventType)) return Promise.reject(new Error('Undeclared connector event'))
        if (abort.signal.aborted || confirmations.size >= 64) return Promise.reject(new Error('Connector event acknowledgment queue unavailable'))
        const params = connectorPublishedEventSchema.parse({ eventType, externalId, payload }), id = `event:${++eventSequence}`
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { confirmations.delete(id); reject(new Error('Event acknowledgment timed out; outcome may be unknown')) }, 30000)
          timer.unref()
          confirmations.set(id, { resolve, reject, timer })
          try { write({ id, method: 'event.publish.confirmed', params }) }
          catch (error) { clearTimeout(timer); confirmations.delete(id); reject(error) }
        })
      },
      status(state) { write({ method: 'worker.status', params: { state } }) }
    })
    return { protocolVersion: 1, workerVersion: definition.version, capabilities: [...definition.events, ...definition.queries, ...definition.actions] }
  }
  const dispatch = async (method: string, params: JsonValue): Promise<JsonValue> => {
    if (method === 'initialize') return initialize(params)
    if (method === 'shutdown' || method === 'disconnect') {
      // Respond before aborting the stream so the host can observe successful shutdown.
      await session?.close(); session = undefined; closed = true
      return { disconnected: true }
    }
    if (!session || closed) throw new Error('Connector is not initialized')
    if (method === 'health') return toJson(connectorWorkerHealthSchema.parse(await session.health()))
    const call = callSchema.parse(params)
    if (method === 'query' && definition.queries.includes(call.capability) && session.query) return session.query(call)
    if (method === 'execute' && definition.actions.includes(call.capability) && session.execute) return session.execute(call)
    throw new Error('Unsupported connector capability or method')
  }
  const receive = (value: JsonValue) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'ack' in value) {
      const reply = eventAck.parse(value), pending = confirmations.get(reply.ack)
      if (!pending) return // A response can arrive after the caller timed out.
      confirmations.delete(reply.ack); clearTimeout(pending.timer)
      if (reply.error || !reply.result) pending.reject(new Error(reply.error ?? 'Invalid event acknowledgment'))
      else pending.resolve(reply.result)
      return
    }
    const request = requestSchema.parse(value)
    if (++queued > 32) throw new Error('Connector request queue exceeded limit')
    chain = chain.then(async () => {
      try { write({ id: request.id, result: jsonValue.parse(await dispatch(request.method, request.params)) }) }
      catch (error) { write({ id: request.id, error: error instanceof ConnectorRequestError
        ? { code: error.code, message: error.message } : { code: 'request_failed', message: 'Connector request failed' } }) }
      finally { queued-- }
      if (closed) stop()
    }).catch(stop)
  }
  output.on('error', stop)
  try {
    for await (const chunk of input) reader.push(Buffer.from(chunk), receive)
    reader.end(); rejectConfirmations(); await chain
  } catch (error) {
    if (!closed) throw error
  } finally {
    output.off('error', stop)
    rejectConfirmations(); await chain
    await close()
  }
}
