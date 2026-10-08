import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { migrations } from '../testing/schema-history.ts'
import { migrateDatabase, databaseSchemaVersion } from '../src/migrations.ts'

test('schema organization preserves every existing migration byte and its version order', () => {
  const hash = createHash('sha256').update(JSON.stringify(migrations.slice(0, 128))).digest('hex')
  assert.equal(hash, '0b3f966dc10bdf21cca942d2198881a3783c8c2cb6ccc93d624510a7eeb92df2')
})

test('version 127 upgrade preserves private QQ state and creates group isolation exactly once', () => {
  const database = new DatabaseSync(':memory:')
  try {
    for (const sql of migrations.slice(0, 127)) database.exec(sql)
    database.exec("PRAGMA user_version=127; INSERT INTO sessions VALUES('private','QQ','mon','active',0,0);")
    database.exec("INSERT INTO qq_channel_conversations VALUES('111111','222222','private',0)")
    database.exec("INSERT INTO qq_channel_pending_files VALUES('7','111111','222222','file','[]',1)")
    migrateDatabase(database)
    migrateDatabase(database)
    assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, databaseSchemaVersion)
    assert.equal(database.prepare('SELECT session_id FROM qq_channel_conversations').get()?.session_id, 'private')
    assert.equal(database.prepare('SELECT message_id FROM qq_channel_pending_files').get()?.message_id, 'file')
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM qq_group_sessions').get()?.n, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=128').get()?.n, 1)
  } finally { database.close() }
})
