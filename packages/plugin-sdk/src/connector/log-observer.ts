import { createHash } from 'node:crypto'
import type { JsonValue } from '@eden/api/connector'
import type { ConnectorContext, ConnectorSession } from './contracts.ts'
import { followLog } from './log-tail.ts'
import { parseBridgeRecord, type BridgeRecord } from './bridge-record.ts'

export interface Observation {
  event: string
  externalId: string
  payload: JsonValue
  state: Record<string, JsonValue>
}
export function observeLog(context: ConnectorContext, marker: string, transform: (record: BridgeRecord, observedAt: number) => Observation | undefined) {
  const settings = context.settings as Record<string, JsonValue>, file = settings.logPath
  if (typeof file !== 'string' || !context.grantedPermissions.some(item => item.capability === 'filesystem.read' && item.resource === file && item.access === 'read')) throw new Error('Log observer requires an approved log path')
  const abort = new AbortController(), signal = AbortSignal.any([abort.signal, context.signal])
  const state: Record<string, JsonValue> = { logPath: file, attached: false, bridgeSeen: false, protocolVersion: null, bridgeVersion: null, lastObservedAt: null, latestSnapshot: null }
  const initial = new Map<string, BridgeRecord>()
  let failed = false
  const apply = (record: BridgeRecord) => {
    const now = Date.now(), observation = transform(record, now)
    if (!observation) return
    Object.assign(state, observation.state, { bridgeSeen: true, protocolVersion: 1, lastObservedAt: now })
    const id = `${observation.externalId.slice(0, 160)}:${createHash('sha256').update(JSON.stringify(observation.payload)).digest('hex')}`
    context.publish(observation.event, id, observation.payload)
  }
  const task = followLog(file, signal, batch => {
    state.attached = true
    for (const line of batch.lines) {
      const record = parseBridgeRecord(line, marker)
      if (!record) continue
      if (batch.initial) { if (initial.size < 16 || initial.has(record.kind)) initial.set(record.kind, record) }
      else apply(record)
    }
    if (batch.initial && batch.complete) { for (const record of initial.values()) apply(record); initial.clear() }
  }).catch(error => { if (!signal.aborted) { failed = true; context.status('degraded'); throw error } })
  void task.catch(() => {})
  const session: ConnectorSession = {
    health: () => ({ state: failed ? 'degraded' : state.bridgeSeen ? 'ready' : 'connecting', initialized: true, attached: state.attached === true, bridgeSeen: state.bridgeSeen === true }),
    query: () => structuredClone(state),
    async close() { abort.abort(); await task }
  }
  return { session, state }
}
