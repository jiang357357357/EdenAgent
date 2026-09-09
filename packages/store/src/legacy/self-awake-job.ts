import type { DatabaseSync } from 'node:sqlite'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyJson, legacyText, legacyUuid } from './fields.ts'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy self-awake payload')
  return value as Record<string, unknown>
}

/** The runnable request carries the same bounded trigger allowlist as the old host. Full data remains in the import record. */
export function convertSelfAwakeJob(db: DatabaseSync, row: LegacyRow) {
  const sessionId = legacyUuid(row, 'session_id')
  const session = db.prepare('SELECT status FROM sessions WHERE id=?').get(sessionId)
  if (!session) throw new Error('Legacy self-awake target session is absent')
  const payload = object(JSON.parse(legacyJson(row, 'payload_json')))
  const key = legacyText(row, 'idempotency_key')
  if (!key || key.length > 512) throw new Error('Legacy self-awake key exceeds supported length')
  const raw = payload.trigger == null ? { type: 'scheduled', reason: typeof payload.prompt === 'string' ? payload.prompt : 'periodic observation' } : object(payload.trigger)
  const allowed = ['type', 'source', 'reason', 'wake_reason', 'occurred_at', 'current_time', 'title', 'details']
  const trigger = Object.fromEntries(allowed.filter(field => typeof raw[field] === 'string')
    .map(field => [field, Array.from(String(raw[field])).slice(0, 4000).join('')]))
  const eventId = typeof payload.eventId === 'string' && payload.eventId ? payload.eventId : key
  if (eventId.length > 512) throw new Error('Legacy self-awake event ID exceeds supported length')
  const request: Record<string, unknown> = { schemaVersion: 'self-awake.v1', eventId, trigger }
  // Routing identity is data, not proof of ownership; submission ownership is converted separately.
  for (const field of ['scheduler', 'userId']) {
    if (payload[field] !== undefined) {
      if (typeof payload[field] !== 'string' || payload[field].length > 512) throw new Error(`Invalid legacy self-awake ${field}`)
      request[field] = payload[field]
    }
  }
  return { sessionId, key, causation: eventId, payload: JSON.stringify(request),
    state: session.status === 'active' ? 'queued' : 'cancelled',
    error: session.status === 'active' ? null : 'Imported self-awake target session is no longer active' }
}
