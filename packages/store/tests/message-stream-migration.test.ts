import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase, migrations, databaseSchemaVersion } from '../src/migrations.ts'

test('v1 to v2 migration marks the format without rewriting or deleting legacy event payloads', () => {
  const database = new DatabaseSync(':memory:')
  try {
    const previousVersion = migrations.findIndex(sql => sql.includes('eden.message.delta.v2'))
    assert.ok(previousVersion > 0, 'The stream-format migration must exist')
    for (const sql of migrations.slice(0, previousVersion)) database.exec(sql)
    database.exec(`PRAGMA user_version=${previousVersion}`)
    database.exec("INSERT INTO sessions VALUES('session','fixture','local','active',0,0)")
    const payload = JSON.stringify({ messageId: 'message', assistantMessageEvent: {},
      messageStorage: { format: 'eden.message.delta.v1', snapshot: { role: 'assistant', content: 'unaltered' } } })
    database.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('event', 'session', null, 1, 'agent.message_update', payload, 0)
    migrateDatabase(database)
    migrateDatabase(database)
    assert.equal(database.prepare("SELECT value FROM realm_meta WHERE key='event_payload_format'").get()!.value, 'eden.message.delta.v2')
    assert.equal(database.prepare('SELECT payload_json FROM events').get()!.payload_json, payload)
    assert.equal(database.prepare('PRAGMA user_version').get()!.user_version, databaseSchemaVersion)
    assert.equal(database.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=?').get(databaseSchemaVersion)!.n, 1)
  } finally { database.close() }
})

test('host rejects a newer database version before applying any migration', () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec(`PRAGMA user_version=${databaseSchemaVersion + 1}`)
    assert.throws(() => migrateDatabase(database), /newer than this host/)
    assert.equal(database.prepare('PRAGMA user_version').get()!.user_version, databaseSchemaVersion + 1)
  } finally { database.close() }
})
