import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../testing/schema-history.ts'
import { migrateDatabase } from '../src/migrations.ts'

test('event history upgrade preserves records and indexes recovery and metadata lookups', () => {
  const db = new DatabaseSync(':memory:')
  try {
    const indexMigration = migrations.findIndex(sql => sql.includes('CREATE INDEX events_session_kind_seq'))
    for (const sql of migrations.slice(0, indexMigration)) db.exec(sql)
    db.exec(`PRAGMA user_version=${indexMigration}`)
    db.exec("INSERT INTO sessions VALUES ('session','fixture','mon','active',0,0)")
    db.exec("INSERT INTO events VALUES ('event','session','turn',1,'agent.message_end','{}',0)")
    migrateDatabase(db)
    migrateDatabase(db)
    assert.equal(db.prepare('SELECT count(*) AS n FROM events').get()?.n, 1)
    for (const [sql, args, index] of [
      ["SELECT payload_json FROM events WHERE session_id=? AND turn_id=? AND kind='agent.message_end' ORDER BY seq DESC", ['session', 'turn'], 'events_session_turn_kind_seq'],
      ["SELECT payload_json FROM events WHERE session_id=? AND kind='model.response' ORDER BY seq DESC LIMIT 1", ['session'], 'events_session_kind_seq'],
    ] as const) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row => row.detail).join('\n')
      assert.ok(plan.includes(index), plan)
      assert.ok(!plan.includes('TEMP B-TREE'), plan)
    }
  } finally { db.close() }
})
