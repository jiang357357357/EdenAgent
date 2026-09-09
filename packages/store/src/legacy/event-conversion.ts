import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { applyLegacyEventPatch } from './event-patch.ts'

export async function convertLegacyEvents(db: DatabaseSync, source: LegacySnapshotReader) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE TABLE legacy_event_staging(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,seq INTEGER NOT NULL,turn_id TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,base_seq INTEGER,UNIQUE(session_id,seq));`)
    await source.scan('session_events', row => {
      for (const key of ['id', 'session_id', 'event_type', 'payload_json']) if (typeof row[key] !== 'string') throw new Error(`Invalid legacy event ${key}`)
      if (typeof row.seq !== 'bigint' || row.seq < 1n || row.seq >= 9223372036854775806n || typeof row.created_at !== 'bigint'
        || !Number.isSafeInteger(Number(row.created_at))) throw new Error('Invalid legacy event sequence or timestamp')
      if (row.turn_id != null && typeof row.turn_id !== 'string') throw new Error('Invalid legacy event turn ID')
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      for (const key of ['id', 'session_id', 'turn_id']) if (row[key] != null && !uuid.test(String(row[key]))) throw new Error('Invalid legacy event UUID')
      const base = row.payload_base_seq ?? null
      if (base !== null && (typeof base !== 'bigint' || base < 1n || base >= row.seq)) throw new Error('Invalid legacy event base sequence')
      db.prepare('INSERT INTO legacy_event_staging VALUES(?,?,?,?,?,?,?,?)').run(row.id!, row.session_id!, row.seq, row.turn_id ?? null,
        row.event_type!, row.payload_json!, row.created_at, base)
    })
    // Move authoritative session metadata after history, preserving old event order with a one-slot offset.
    db.exec(`UPDATE events SET seq=COALESCE((SELECT MAX(seq) FROM legacy_event_staging e WHERE e.session_id=events.session_id),0)+2
      WHERE kind='session.metadata.updated';`)
    const statement = db.prepare('SELECT * FROM legacy_event_staging ORDER BY session_id,seq')
    statement.setReadBigInts(true)
    for (const row of statement.iterate()) {
      let payload: unknown = JSON.parse(String(row.payload))
      if (row.base_seq !== null) {
        const base = db.prepare('SELECT payload_json FROM events WHERE session_id=? AND seq=?').get(row.session_id!, BigInt(row.base_seq as bigint) + 1n)
        if (!base) throw new Error('Legacy event base is absent')
        payload = applyLegacyEventPatch(JSON.parse(String(base.payload_json)), payload)
      }
      const serialized = JSON.stringify(payload)
      if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) throw new Error('Expanded legacy event exceeds migration limit')
      db.prepare('INSERT INTO events(id,session_id,turn_id,seq,kind,payload_json,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(row.id!, row.session_id!, row.turn_id!, BigInt(row.seq as bigint) + 1n, row.kind!, serialized, row.created_at!)
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('session_events', row.id!, row.id!)
    }
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='session_events'").run()
    db.exec('DROP TABLE legacy_event_staging; COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
