import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PluginService } from '@eden/plugin-host'
import { probeSandbox } from '@eden/execution'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { startServer } from '../src/bootstrap/container.ts'
import { RpcRouter } from '../src/transport/rpc/router.ts'
import { pluginRoutes } from '../src/transport/rpc/plugin.routes.ts'
import { permissionRoutes } from '../src/transport/rpc/permission.routes.ts'

const manifest = { schemaVersion: 1, id: 'double', name: 'Double', description: 'Double a number', version: '1.0.0', entry: 'index.ts',
  tool: { name: 'double', description: 'Double a number', parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false } },
  permissions: [], tests: [{ input: { value: 3 }, expected: 6 }],
}
const source = 'export default (input: {value: number}) => input.value * 2'

test('agent authors, tests, activates, and invokes its plugin through durable user approvals', async context => {
  if (!(await probeSandbox()).available) { context.skip('Requires verified OS sandbox'); return }
  const temporary = new EdenDatabase(':memory:', 'local')
  const registry = new PluginService(temporary)
  registry.drafts.save(manifest, source)
  const report = await registry.test('double')
  temporary.close()
  assert.equal(report.passed, true)
  const revision = report.revision
  const replies = [
    { action: 'draft', args: { manifest, source } }, { action: 'validate', args: { id: 'double' } },
    { action: 'test', args: { id: 'double' } }, { action: 'install', args: { id: 'double', revision } },
    { action: 'activate', args: { id: 'double', revision } }, { action: 'invoke', args: { id: 'double', revision, input: { value: 21 } } },
  ]
  const model = await recordedModel([...replies.map(input => ({ tool: 'eden_plugin', input })), { text: 'The plugin returned 42' }])
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-agent-plugin-'))
  const server = await startServer({ ...loadConfig({ EDEN_AGENT_V2_DATA_ROOT: directory, EDEN_AGENT_PORT: '0' }), model: model.config })
  const router = new RpcRouter('local', { ...pluginRoutes(server.plugins), ...permissionRoutes(server.permissions) })
  const failures: unknown[] = []
  await router.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 2, runtimeOrigin: 'local', clientName: 'test-user', clientVersion: '1', capabilities: [] } })
  let first = true
  const unsubscribe = server.sessions.repository.events.subscribe(event => {
    if (event.kind !== 'permission.requested') return
    queueMicrotask(async () => {
      try {
        const request = server.permissions.list().find(item => item.state === 'pending')!
        if (first) { assert.throws(() => server.plugins.drafts.read('double'), /not found/); first = false }
        const result = await router.dispatch({ jsonrpc: '2.0', id: request.id, method: 'permission.resolve', params: { requestId: request.id, decision: 'once' } })
        assert.equal((result as { error: unknown }).error, null)
      } catch (error) { failures.push(error) }
    })
  })
  try {
    const session = server.sessions.repository.create('Plugin authoring', [], null)
    server.sessions.start(session.id, 'Write, test, and use a double-number plugin')
    await server.sessions.waitForIdle(session.id)
    assert.deepEqual(failures, [])
    assert.equal(model.requests.length, 7)
    assert.equal(server.permissions.list().length, 5)
    assert.ok(server.permissions.list().every(item => item.state === 'allowed'))
    assert.equal(server.plugins.activations.list()[0]?.revision, revision)
    assert.equal(await server.plugins.invoke('double', revision, { value: 21 }), 42)
    const events = server.sessions.repository.events.list(session.id, '0', 1000)
    assert.ok(events.some(event => event.kind === 'operation.completed' && JSON.stringify(event.payload).includes('42')))
    const requests = events.filter(event => event.kind === 'model.request')
    assert.ok(requests.every(event => JSON.stringify(event.payload).includes('eden.plugin-management.v1')))
    assert.equal((await router.dispatch({ jsonrpc: '2.0', id: 9, method: 'toString', params: {} }) as { error: { code: number } }).error.code, -32601)
  } finally { unsubscribe(); await server.close(); await model.close(); rmSync(directory, { recursive: true }) }
})

test('denied plugin mutation remains absent', async () => {
  const model = await recordedModel([{ tool: 'eden_plugin', input: { action: 'draft', args: { manifest, source } } }, { text: 'Permission denied' }])
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-agent-denial-'))
  const server = await startServer({ ...loadConfig({ EDEN_AGENT_V2_DATA_ROOT: directory, EDEN_AGENT_PORT: '0' }), model: model.config })
  const unsubscribe = server.sessions.repository.events.subscribe(event => {
    if (event.kind === 'permission.requested') queueMicrotask(() => server.permissions.resolve(server.permissions.list()[0]!.id, false))
  })
  try {
    const session = server.sessions.repository.create('Denial', [], null)
    server.sessions.start(session.id, 'Create plugin')
    await server.sessions.waitForIdle(session.id)
    assert.throws(() => server.plugins.drafts.read('double'), /not found/)
    assert.equal(server.permissions.list()[0]?.state, 'denied')
  } finally { unsubscribe(); await server.close(); await model.close(); rmSync(directory, { recursive: true }) }
})

test('cancelling a tool waiting for permission leaves no live waiter or draft', async () => {
  const model = await recordedModel([{ tool: 'eden_plugin', input: { action: 'draft', args: { manifest, source } } }])
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-agent-cancel-'))
  const server = await startServer({ ...loadConfig({ EDEN_AGENT_V2_DATA_ROOT: directory, EDEN_AGENT_PORT: '0' }), model: model.config })
  let requested!: () => void
  const waiting = new Promise<void>(resolve => { requested = resolve })
  const unsubscribe = server.sessions.repository.events.subscribe(event => { if (event.kind === 'permission.requested') requested() })
  try {
    const session = server.sessions.repository.create('Cancel', [], null)
    server.sessions.start(session.id, 'Create plugin')
    await waiting
    assert.equal(await server.sessions.cancel(session.id), true)
    await server.sessions.waitForIdle(session.id)
    assert.throws(() => server.plugins.drafts.read('double'), /not found/)
    assert.equal(server.permissions.list()[0]?.state, 'cancelled')
  } finally { unsubscribe(); await server.close(); await model.close(); rmSync(directory, { recursive: true }) }
})
