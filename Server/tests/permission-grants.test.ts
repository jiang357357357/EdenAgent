import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { PermissionService } from '../src/modules/permissions/index.ts'
import { permissionRoutes } from '../src/transport/rpc/permission.routes.ts'

test('always grants survive service recreation and bind session, revision and exact parameters; revocation restores prompting', async () => {
  const database = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(database, 'local')
  const first = sessions.create('First')
  const second = sessions.create('Second')
  let permissions = new PermissionService(database, sessions.events)
  const controller = new AbortController()
  const context = { sessionId: first.id, turnId: randomUUID(), callId: 'one', signal: controller.signal }
  try {
    const waiting = permissions.request(context, 'plugin.invoke', 'double@revision-one', { value: 2 })
    const request = permissions.list()[0]!
    permissionRoutes(permissions)['permission.resolve']!({ requestId: request.id, decision: 'always' })
    await waiting
    permissions = new PermissionService(database, sessions.events)
    await permissions.request({ ...context, callId: 'two' }, 'plugin.invoke', 'double@revision-one', { value: 2 })
    assert.equal(permissions.list().filter(item => item.state === 'pending').length, 0)
    for (const [sessionId, resource, value] of [
      [second.id, 'double@revision-one', 2], [first.id, 'double@revision-two', 2], [first.id, 'double@revision-one', 3],
    ] as const) {
      const denied = permissions.request({ ...context, sessionId, callId: randomUUID() }, 'plugin.invoke', resource, { value })
      const rejection = assert.rejects(denied, /denied/)
      permissions.resolve(permissions.list().find(item => item.state === 'pending')!.id, false)
      await rejection
    }
    permissionRoutes(permissions)['permission.grant.revoke']!({ requestId: request.id })
    const denied = permissions.request({ ...context, callId: 'revoked' }, 'plugin.invoke', 'double@revision-one', { value: 2 })
    const rejection = assert.rejects(denied, /denied/)
    permissions.resolve(permissions.list().find(item => item.state === 'pending')!.id, false)
    await rejection
  } finally { controller.abort(); database.close() }
})


test('committed approval wins over subscriber cancellation, while failed persistence leaves it pending', async () => {
  const database = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(database, 'local')
  const session = sessions.create('Approval race')
  const permissions = new PermissionService(database, sessions.events)
  const controller = new AbortController()
  const context = { sessionId: session.id, turnId: randomUUID(), callId: 'approval', signal: controller.signal }
  sessions.events.subscribe(event => { if (event.kind === 'permission.resolved') controller.abort() })
  try {
    const waiting = permissions.request(context, 'workspace.write', '/workspace/file', { content: 'approved' })
    const request = permissions.list()[0]!
    database.connection.exec("CREATE TRIGGER reject_approval BEFORE INSERT ON events WHEN NEW.kind='permission.resolved' BEGIN SELECT RAISE(ABORT, 'approval disk failure'); END")
    assert.throws(() => permissions.resolve(request.id, true, 'denied', true), /approval disk failure/)
    assert.equal(permissions.list()[0]?.state, 'pending')
    assert.equal(database.connection.prepare('SELECT COUNT(*) AS count FROM permission_grants').get()?.count, 0)
    database.connection.exec('DROP TRIGGER reject_approval')
    permissions.resolve(request.id, true, 'denied', true)
    await waiting
    assert.equal(controller.signal.aborted, true)
    assert.equal(permissions.list()[0]?.state, 'allowed')
    assert.equal(database.connection.prepare('SELECT COUNT(*) AS count FROM permission_grants').get()?.count, 1)
    assert.equal(sessions.events.list(session.id).filter(event => event.kind === 'permission.resolved').length, 1)
    assert.throws(() => permissions.resolve(request.id, false), /already resolved/)
  } finally { controller.abort(); database.close() }
})
