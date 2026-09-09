import test from 'node:test'
import assert from 'node:assert/strict'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { MonConnectionRepository } from '../src/modules/mon/connection-repository.ts'

const connection = { coreBaseUrl: 'https://core.example.test', coreToken: 'private-token' }

test('connection writes require an active Mon session and an owning transaction', () => {
  const db = new EdenDatabase(':memory:', 'mon')
  try {
    const sessions = new SessionRepository(db, 'mon')
    const session = sessions.create('Connection')
    const connections = new MonConnectionRepository(db)
    assert.throws(() => connections.saveInTransaction(session.id, connection), /owning transaction/)
    db.transaction(() => connections.saveInTransaction(session.id, connection))
    assert.deepEqual(connections.read(session.id), connection)
    assert.throws(() => db.transaction(() => connections.saveInTransaction(session.id, { ...connection, coreBaseUrl: 'https://user:secret@core.example.test' })))
    assert.throws(() => db.transaction(() => connections.saveInTransaction(session.id, { ...connection, coreToken: 'x'.repeat(8193) })))
    sessions.setStatus(session.id, 'closed')
    assert.equal(connections.read(session.id), undefined)
    assert.throws(() => db.transaction(() => connections.saveInTransaction(session.id, connection)), /active session/)
  } finally { db.close() }
  const local = new EdenDatabase(':memory:', 'local')
  try { assert.throws(() => new MonConnectionRepository(local), /Mon database/) } finally { local.close() }
})

test('failed owning transaction rolls back credential rotation and no credential event is produced', () => {
  const db = new EdenDatabase(':memory:', 'mon')
  try {
    const sessions = new SessionRepository(db, 'mon')
    const session = sessions.create('Rotation')
    const connections = new MonConnectionRepository(db)
    db.transaction(() => connections.saveInTransaction(session.id, connection))
    assert.throws(() => db.transaction(() => {
      connections.saveInTransaction(session.id, { ...connection, coreToken: 'rotated-token' })
      throw new Error('Later binding event failure')
    }), /Later binding event failure/)
    assert.deepEqual(connections.read(session.id), connection)
    assert.ok(!JSON.stringify(sessions.events.list(session.id)).includes('private-token'))
  } finally { db.close() }
})
