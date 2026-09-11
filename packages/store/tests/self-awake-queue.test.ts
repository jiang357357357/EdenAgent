import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrations, migrateDatabase } from '../src/migrations.ts'
import { retainLatestImportedWake } from '../src/legacy/self-awake-job.ts'

test('queue migration retains newest pending wake and preserves all history and active jobs', () => {
  const db = new DatabaseSync(':memory:')
  try {
    const version = migrations.findIndex(sql => sql.includes('CREATE UNIQUE INDEX jobs_one_pending_self_awake'))
    for (const sql of migrations.slice(0, version)) db.exec(sql)
    db.exec(`PRAGMA user_version=${version}`)
    const insert = db.prepare("INSERT INTO jobs(id,kind,session_id,due_at,payload_json,operation_key,causation_id,depth,state,attempts,created_at,updated_at) VALUES(?,'self_awake',NULL,1,'{}',?,'',0,?,0,?,0)")
    for (let i = 0; i < 6; i++) insert.run(String(i), String(i), 'queued', i)
    insert.run('active', 'active', 'dispatched', 0)
    migrateDatabase(db)
    migrateDatabase(db)
    assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 7)
    assert.equal(db.prepare("SELECT id FROM jobs WHERE state='queued'").get()?.id, '5')
    assert.equal(db.prepare("SELECT state FROM jobs WHERE id='active'").get()?.state, 'dispatched')
    assert.throws(() => insert.run('extra', 'extra', 'queued', 99), /UNIQUE/)
    assert.equal(retainLatestImportedWake(db, 1), false)
    assert.equal(retainLatestImportedWake(db, 6), true)
    insert.run('new', 'new', 'queued', 6)
    assert.equal(db.prepare("SELECT id FROM jobs WHERE state='queued'").get()?.id, 'new')
  } finally { db.close() }
})
