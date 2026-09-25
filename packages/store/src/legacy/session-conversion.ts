import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacyRow, LegacyCell } from './snapshot-format.ts'
function text(row: LegacyRow, key: string): string {
  if (typeof row[key] !== 'string') throw new Error(`Legacy session field must be text: ${key}`)
  return row[key] as string
}
function timestamp(value: LegacyCell | undefined): number {
  if (typeof value !== 'bigint' && typeof value !== 'number') throw new Error('Invalid legacy timestamp')
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error('Legacy timestamp exceeds exact numeric range')
  return number
}
function metadataId(id: string) {
  const bytes = createHash('sha256').update(`eden:legacy:session-metadata:${id}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function convertLegacySession(db: DatabaseSync, row: LegacyRow, origin: 'mon' | 'local') {
  const id = text(row, 'id')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Legacy session ID is not a UUID')
  if (text(row, 'runtime_origin') !== origin) throw new Error('Legacy session belongs to another world')
  const status = text(row, 'status')
  if (!['active', 'closed', 'deleted'].includes(status)) throw new Error('Unsupported legacy session status')
  const participants = JSON.parse(text(row, 'participants_json')), environment = JSON.parse(text(row, 'environment_json'))
  if (!Array.isArray(participants) || !environment || typeof environment !== 'object' || Array.isArray(environment)) throw new Error('Invalid legacy session metadata')
  const createdAt = timestamp(row.created_at), updatedAt = timestamp(row.updated_at)
  db.prepare('INSERT INTO sessions(id,title,origin,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, text(row, 'title'), origin, status, createdAt, updatedAt)
  if (environment.sessionPurpose === 'self_awake' || environment.sessionPurpose === 'subagent') {
    db.prepare('UPDATE session_classification SET purpose=?,source_channel=? WHERE session_id=?')
      .run(environment.sessionPurpose, 'internal', id)
  }
  db.prepare('INSERT INTO events(id,session_id,turn_id,seq,kind,payload_json,created_at) VALUES(?,?,NULL,1,?,?,?)')
    .run(metadataId(id), id, 'session.metadata.updated', JSON.stringify({ participants, environment, legacyTitleSource: typeof row.title_source === 'string' ? row.title_source : 'legacy' }), createdAt)
  db.prepare('INSERT INTO legacy_conversion_ids(domain,source_id,target_id) VALUES(?,?,?)').run('sessions', id, id)
}
