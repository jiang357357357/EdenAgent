import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrations, migrateDatabase } from '../src/migrations.ts'
import { selfAwakeActivationSchema } from '../src/schema/self-awake-activation.ts'

function fixture(context: test.TestContext, historical = false) {
  const db = new DatabaseSync(':memory:')
  context.after(() => db.close())
  db.exec('PRAGMA foreign_keys=ON')
  const target = migrations.indexOf(selfAwakeActivationSchema)
  assert.ok(target > 0)
  if (historical) {
    for (let i = 0; i < target; i++) {
      db.exec(migrations[i]!)
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(i + 1, 1)
    }
    db.exec(`PRAGMA user_version=${target}`)
  } else migrateDatabase(db)
  for (const session of ['one', 'two']) db.prepare("INSERT INTO sessions VALUES(?,'','mon','active',0,0)").run(session)
  let sequence = 0
  const run = (id: string, session = 'one', turn: string | null = id) => {
    db.prepare(`INSERT INTO jobs(id,kind,session_id,due_at,payload_json,operation_key,causation_id,depth,state,attempts,created_at,updated_at)
      VALUES(?,'self_awake',?,0,'{}',?,'',0,'completed',1,0,0)`).run(id, session, id)
    db.prepare(`INSERT INTO self_awake_runs(id,job_id,session_id,turn_id,event_id,state,request_json,author_json,attempts,started_at,created_at,updated_at)
      VALUES(?,?,?,?,'','running','{}','{}',1,999999,0,0)`).run(id, id, session, turn)
  }
  const event = (turn: string, createdAt: number, session = 'one', kind = 'agent.agent_start') => {
    const id = `event-${++sequence}`
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(id, session, turn, sequence, kind, '{}', createdAt)
    return id
  }
  const activation = (id: string) => db.prepare('SELECT started_at FROM self_awake_activations WHERE run_id=?').get(id)?.started_at
  return { db, run, event, activation }
}

test('historical upgrade projects actual first execution once, excluding dispatch-only runs', t => {
  const f = fixture(t, true)
  f.run('early'); f.event('early', 40); f.event('early', 20)
  f.run('latest'); f.event('latest', 60)
  f.run('not-started'); f.event('not-started', 100, 'one', 'agent.message_update')
  migrateDatabase(f.db)
  assert.equal(f.activation('early'), 20)
  assert.equal(f.activation('latest'), 60)
  assert.equal(f.activation('not-started'), undefined)
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0)
  const changes = f.db.prepare('SELECT total_changes() AS n').get()!.n
  migrateDatabase(f.db)
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, changes)
})

test('start before insertion or turn association is recovered and rebinding clears the old projection', t => {
  const f = fixture(t)
  f.event('before-insert', 10); f.run('inserted', 'one', 'before-insert')
  assert.equal(f.activation('inserted'), 10)
  f.run('bound-later', 'one', null); f.event('new-turn', 20)
  assert.equal(f.activation('bound-later'), undefined)
  f.db.prepare('UPDATE self_awake_runs SET turn_id=? WHERE id=?').run('new-turn', 'bound-later')
  assert.equal(f.activation('bound-later'), 20)
  f.event('other-turn', 30, 'two')
  f.db.prepare('UPDATE self_awake_runs SET session_id=?,turn_id=? WHERE id=?').run('two', 'other-turn', 'bound-later')
  assert.equal(f.activation('bound-later'), 30)
  f.event('new-turn', 1)
  assert.equal(f.activation('bound-later'), 30)
  f.db.prepare('UPDATE self_awake_runs SET turn_id=NULL WHERE id=?').run('bound-later')
  assert.equal(f.activation('bound-later'), undefined)
})

test('minimum execution time and its projection commit or roll back together', t => {
  const f = fixture(t)
  f.run('run'); f.event('run', 30); f.event('run', 50); f.event('run', 20)
  assert.equal(f.activation('run'), 20)
  f.db.exec('BEGIN')
  f.event('run', 10)
  assert.equal(f.activation('run'), 10)
  f.db.exec('ROLLBACK')
  assert.equal(f.activation('run'), 20)
  f.db.prepare("UPDATE self_awake_runs SET state='completed',completed_at=90 WHERE id='run'").run()
  assert.equal(f.activation('run'), 20)
  f.db.prepare("DELETE FROM self_awake_runs WHERE id='run'").run()
  assert.equal(f.activation('run'), undefined)
})

test('editing or deleting execution evidence recomputes only the affected old and new turns', t => {
  const f = fixture(t)
  f.run('a'); f.run('b', 'two')
  const first = f.event('a', 10), second = f.event('a', 20)
  f.db.prepare('UPDATE events SET session_id=?,turn_id=?,created_at=? WHERE id=?').run('two', 'b', 30, first)
  assert.equal(f.activation('a'), 20)
  assert.equal(f.activation('b'), 30)
  f.db.prepare("UPDATE events SET kind='agent.message_update' WHERE id=?").run(first)
  assert.equal(f.activation('b'), undefined)
  f.db.prepare("UPDATE events SET kind='agent.agent_start',created_at=5 WHERE id=?").run(first)
  assert.equal(f.activation('b'), 5)
  f.db.prepare('DELETE FROM events WHERE id=?').run(second)
  assert.equal(f.activation('a'), undefined)
  assert.equal(f.activation('b'), 5)
})
