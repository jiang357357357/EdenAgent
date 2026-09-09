import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyJson, legacyText, legacyUuid } from './fields.ts'

/** Reconstruct only the exact legacy bridge contract, never invent an owner from a routing hint. */
export function convertSelfAwakeSubmission(db: DatabaseSync, row: LegacyRow): void {
  const payload: unknown = JSON.parse(legacyJson(row, 'payload_json'))
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const value = payload as Record<string, unknown>
  if (value.scheduler !== 'monos') return
  const user = value.userId, event = value.eventId, jobId = legacyUuid(row, 'id'), sessionId = legacyUuid(row, 'session_id')
  if (value.schemaVersion !== 'self-awake.v1' || typeof user !== 'string' || !user || user.length > 128 ||
    typeof event !== 'string' || !event || event.length > 256 || !Object.hasOwn(value, 'trigger')) {
    throw new Error('Legacy external self-awake submission lacks a compatible identity or request')
  }
  const session = db.prepare('SELECT origin FROM sessions WHERE id=?').get(sessionId)
  const record = db.prepare("SELECT payload_json FROM events WHERE session_id=? AND kind IN ('session.created','session.metadata.updated') ORDER BY seq DESC LIMIT 1").get(sessionId)
  const metadata = record ? JSON.parse(String(record.payload_json)) : null
  if (session?.origin !== 'mon' || metadata?.environment?.sessionPurpose !== 'self_awake' || metadata?.environment?.selfAwakeUserId !== user) {
    throw new Error('Legacy external self-awake user does not own the converted background session')
  }
  const key = legacyText(row, 'idempotency_key'), prefix = `self-awake:${user}:`
  if (!key.startsWith(prefix)) throw new Error('Legacy self-awake submission key does not match its user')
  const requestKey = key.slice(prefix.length)
  if (!requestKey || requestKey.length > 256) throw new Error('Legacy self-awake submission key exceeds bridge limits')
  // Property order matches the parsed current bridge schema. Context is the complete original trigger,
  // not the bounded prompt trigger constructed for runtime execution.
  const input = { user_id: user, schema_version: 'self-awake.v1', idempotency_key: requestKey, event_id: event, context: value.trigger }
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  db.prepare('INSERT INTO self_awake_submissions(user_id,request_key,request_hash,job_id) VALUES(?,?,?,?)').run(user, requestKey, hash, jobId)
}
