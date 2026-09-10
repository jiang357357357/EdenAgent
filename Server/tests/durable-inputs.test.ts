import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'

test('broadcast listeners observe committed data; failed input writes never publish', () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(database, 'local')
  const session = repository.create('Durability')
  const inputs = new InputRepository(database, repository.events)
  const seen: string[] = []
  repository.events.subscribe(event => {
    assert.ok(database.connection.prepare('SELECT id FROM events WHERE id=?').get(event.id))
    seen.push(event.kind)
  })
  try {
    database.connection.exec("CREATE TRIGGER fail_inputs BEFORE INSERT ON events WHEN NEW.kind='input.queued' BEGIN SELECT RAISE(ABORT, 'disk simulation'); END")
    assert.throws(() => inputs.enqueue(session.id, 'Must roll back', 'one'))
    assert.equal(database.connection.prepare('SELECT count(*) AS count FROM inputs').get()?.count, 0)
    assert.deepEqual(seen, [])
    database.connection.exec('DROP TRIGGER fail_inputs')
    inputs.enqueue(session.id, 'Accepted', 'one')
    assert.deepEqual(seen, ['input.queued'])
  } finally { database.close() }
})

test('recovery interrupts in-flight work and marks uncertain effects unknown', () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(database, 'local')
  const session = repository.create('Recovery')
  const inputs = new InputRepository(database, repository.events)
  try {
    inputs.enqueue(session.id, 'Effect', 'one')
    const input = inputs.claim(session.id)!
    database.connection.prepare('INSERT INTO tool_operations(id,session_id,turn_id,tool_name,revision,state,result_json,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('effect', session.id, input.turnId, 'external', '1', 'running', null, 1, 1)
    assert.equal(inputs.recoverInterrupted(), 1)
    assert.equal(inputs.claim(session.id), undefined)
    assert.equal(database.connection.prepare("SELECT state FROM tool_operations WHERE id='effect'").get()?.state, 'unknown')
    assert.equal(inputs.recoverInterrupted(), 0)
  } finally { database.close() }
})
