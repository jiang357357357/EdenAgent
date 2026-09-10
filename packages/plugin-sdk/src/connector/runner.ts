import { z } from 'zod'
import type { Readable, Writable } from 'node:stream'
import { connectorWorkerInitializeSchema, connectorPublishedEventSchema, connectorWorkerHealthSchema, jsonValue, toJson } from '@eden/api/connector'
import type { JsonValue } from '@eden/api/connector'
import type { ConnectorDefinition, ConnectorSession } from './contracts.ts'
import { WorkerFrameReader, encodeWorkerFrame, maxWorkerFrame } from './frames.ts'

const requestSchema = z.object({ id: z.number().int().positive().safe(), method: z.string().max(128), params: jsonValue.default(null) }).strict()
const callSchema = z.object({ capability: z.string().min(1).max(128), payload: jsonValue, operationId: z.string().min(1).max(256) }).strict()

/** Sequential requests preserve action order; events may be published while an action awaits I/O. */
export async function runConnector(definition: ConnectorDefinition, input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const abort = new AbortController(), reader = new WorkerFrameReader()
  let session: ConnectorSession | undefined, initializing = false, closed = false, queued = 0
  let chain = Promise.resolve()
  const write = (value: JsonValue) => {
    if (abort.signal.aborted || output.destroyed) throw new Error('Connector output is closed')
    if (output.writableLength > maxWorkerFrame) throw new Error('Connector output queue exceeded limit')
    output.write(encodeWorkerFrame(value))
  }
  const stop = () => { abort.abort(); input.destroy() }
  const close = async () => {
    if (closed) return
    closed = true; abort.abort()
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
    const request = requestSchema.parse(value)
    if (++queued > 32) throw new Error('Connector request queue exceeded limit')
    chain = chain.then(async () => {
      try { write({ id: request.id, result: jsonValue.parse(await dispatch(request.method, request.params)) }) }
      catch { write({ id: request.id, error: { code: 'request_failed', message: 'Connector request failed' } }) }
      finally { queued-- }
      if (closed) stop()
    }).catch(stop)
  }
  output.on('error', stop)
  try {
    for await (const chunk of input) reader.push(Buffer.from(chunk), receive)
    reader.end(); await chain
  } catch (error) {
    if (!closed) throw error
  } finally {
    output.off('error', stop)
    await chain
    await close()
  }
}
