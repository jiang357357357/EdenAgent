import { MonChildModels } from './mon-child-models.ts'
import { reconcileLegacySelections } from './legacy-selection.ts'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { actorIdSchema, jsonValue } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'

import { modelBindingSnapshotSchema } from './binding-snapshot.ts'
import type { ModelBindingSnapshot } from './binding-snapshot.ts'
export { modelBindingSnapshotSchema } from './binding-snapshot.ts'
export type { ModelBindingSnapshot } from './binding-snapshot.ts'

function assertRoster(participants: JsonValue[], snapshot: ModelBindingSnapshot): void {
  if (snapshot.mode === 'single') {
    if (participants.length > 1) throw new Error('Single model binding cannot restore a multi-actor session')
    return
  }
  const ids = participants.map(value => {
    const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return String(actorIdSchema.parse(item.assistantId))
  })
  if (ids.length < 2 || new Set(ids).size !== ids.length ||
    !isDeepStrictEqual(ids.sort(), snapshot.actors.map(item => String(item.assistantId)).sort())) throw new Error('Model binding roster mismatch')
}

/** Private realm storage. Callers must never project snapshot credentials into RPC or events. */
export class ModelBindingRepository {
  readonly childProfiles: MonChildModels
  constructor(private readonly database: EdenDatabase) {
    this.childProfiles = new MonChildModels(database)
    if (database.connection.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== 'mon')
      throw new Error('Mon model bindings require the Mon database')
  }

  save(sessionKey: string, snapshot: ModelBindingSnapshot): void {
    this.commit(sessionKey, snapshot, () => { })
  }

  commit<T>(sessionKey: string, snapshot: ModelBindingSnapshot, work: () => T): T {
    return this.database.transaction(() => { this.saveInTransaction(sessionKey, snapshot); return work() })
  }

  saveInTransaction(sessionKey: string, snapshot: ModelBindingSnapshot): void {
    if (!this.database.inTransaction) throw new Error('Model binding write requires an owning transaction')
    const parsed = modelBindingSnapshotSchema.parse(snapshot)
    const serialized = JSON.stringify(parsed)
    if (Buffer.byteLength(serialized) > 512 * 1024) throw new Error('Model binding snapshot exceeds size limit')
    const participants = this.participants(sessionKey)
    if (!participants) throw new Error('Model binding requires an active session')
    assertRoster(participants, parsed)
    const cursor = this.selectionCursor(sessionKey)
    this.database.connection.prepare(`INSERT INTO model_bindings(session_key,participants_json,snapshot_json,updated_at,operation_cursor)
      VALUES (?,?,?,?,?) ON CONFLICT(session_key) DO UPDATE SET participants_json=excluded.participants_json,
      snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,operation_cursor=excluded.operation_cursor`)
      .run(sessionKey, JSON.stringify(participants), serialized, Date.now(), cursor)
    reconcileLegacySelections(this.database, sessionKey, participants, parsed)
  }

  read(sessionKey: string): ModelBindingSnapshot | undefined {
    const participants = this.participants(sessionKey)
    if (!participants) return undefined
    const row = this.database.connection.prepare('SELECT participants_json,snapshot_json,operation_cursor FROM model_bindings WHERE session_key=?').get(sessionKey)
    if (!row || !isDeepStrictEqual(JSON.parse(String(row.participants_json)), participants)) return undefined
    const pending = this.database.connection.prepare(`SELECT 1 FROM mon_operations WHERE kind='model.select' AND session_id IS ?
      AND rowid>? AND state!='failed' LIMIT 1`).get(sessionKey === 'default' ? null : sessionKey, row.operation_cursor!)
    if (pending) return undefined
    const snapshot = modelBindingSnapshotSchema.parse(JSON.parse(String(row.snapshot_json)))
    assertRoster(participants, snapshot)
    return snapshot
  }

  remove(sessionKey: string): void {
    this.key(sessionKey)
    this.database.connection.prepare('DELETE FROM model_bindings WHERE session_key=?').run(sessionKey)
  }

  keys(): string[] {
    return this.database.connection.prepare('SELECT session_key FROM model_bindings ORDER BY session_key').all().map(row => String(row.session_key))
  }

  private key(sessionKey: string): void { if (sessionKey !== 'default') z.uuid().parse(sessionKey) }

  private selectionCursor(sessionKey: string): number {
    const scope = sessionKey === 'default' ? null : sessionKey
    if (this.database.connection.prepare("SELECT 1 FROM mon_operations WHERE kind='model.select' AND session_id IS ? AND state='running' LIMIT 1").get(scope))
      throw new Error('Wait for the model selection outcome before binding')
    const cursor = Number(this.database.connection.prepare("SELECT COALESCE(MAX(rowid),0) AS cursor FROM mon_operations WHERE kind='model.select' AND session_id IS ?").get(scope)?.cursor)
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid model selection cursor')
    return cursor
  }

  private participants(sessionKey: string) {
    this.key(sessionKey)
    if (sessionKey === 'default') return []
    const session = this.database.connection.prepare("SELECT 1 FROM sessions WHERE id=? AND status='active'").get(sessionKey)
    if (!session) return undefined
    const event = this.database.connection.prepare(`SELECT payload_json FROM events WHERE session_id=?
      AND kind IN ('session.created','session.metadata.updated') ORDER BY seq DESC LIMIT 1`).get(sessionKey)
    const metadata = z.object({ participants: z.array(jsonValue).default([]) }).parse(JSON.parse(String(event?.payload_json ?? '{}')))
    return metadata.participants
  }
}
