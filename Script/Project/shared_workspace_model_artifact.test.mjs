import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactClient, artifactHost } from './workspace_artifact_fixture.mjs'

const entry = fileURLToPath(new URL('../../dist/server/main.mjs', import.meta.url))
const name = 'query_shared_workspace'
const retired = ['get_shared_workspace_status', 'list_shared_workspaces', 'list_shared_workspace_files']

for (const origin of ['mon', 'local']) test(`compiled ${origin} host scopes shared model tool registration to Eden`, async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'eden-shared-model-artifact-')))
  let host, client
  const observed = []
  const core = createServer((request, response) => {
    observed.push(request.url)
    assert.equal(request.headers.authorization, 'Token shared-artifact-test-only')
    assert.equal(request.url, '/api/users/me/profile/')
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 41 }))
  })
  t.after(async () => {
    client?.close()
    try { await host?.close() } finally {
      core.closeAllConnections(); await new Promise(resolve => core.close(resolve))
      assert.equal(path.dirname(root), await realpath(tmpdir()))
      assert.ok(path.basename(root).startsWith('eden-shared-model-artifact-'))
      await rm(root, { recursive: true, force: true })
    }
  })
  await writeFile(path.join(root, '.monconfig'), '')
  await writeFile(path.join(root, '.monworkspace'), '')
  core.listen(0, '127.0.0.1'); await once(core, 'listening')
  host = await artifactHost(entry, root, path.join(root, 'Data', 'Agent'), {
    origin, coreUrl: `http://127.0.0.1:${core.address().port}`,
  })
  client = await artifactClient(host, { origin, ...(origin === 'mon' ? { coreToken: 'shared-artifact-test-only' } : {}) })
  const catalog = await client.rpc('tool.list')
  assert.ok(catalog.every(tool => !retired.includes(tool.name)))
  assert.equal(catalog.filter(tool => tool.name === name).length, origin === 'mon' ? 1 : 0)
  for (const sharedFile of ['read_shared_file', 'write_shared_file', 'edit_shared_file'])
    assert.equal(catalog.filter(tool => tool.name === sharedFile).length, origin === 'mon' ? 1 : 0)
  if (origin === 'mon') {
    const tool = catalog.find(item => item.name === name)
    assert.equal(tool.source, 'builtin'); assert.equal(tool.exposure, 'direct')
    assert.match(tool.description, /共享资料库/)
    assert.equal(tool.parameters.additionalProperties, false)
    assert.deepEqual(tool.parameters.required, ['action'])
    assert.deepEqual(tool.parameters.properties.action.enum, ['status', 'spaces', 'files'])
    assert.doesNotMatch(JSON.stringify(tool.parameters), /sessionId|expectedWorkspacePath|spaceId|revision/)
  }
  if (origin === 'mon') {
    const session = await client.rpc('session.create', { title: 'Artifact shared model registration' })
    const status = await client.rpc('sharedWorkspace.status', { sessionId: session.id })
    assert.equal(status.available, true); assert.equal(status.bound, false); assert.equal(status.canPublish, false)
    assert.equal(status.root, '')
    const before = await client.rpc('workspace.info', { sessionId: session.id })
    const selected = await client.rpc('sharedWorkspace.directory.read', { sessionId: session.id })
    assert.equal(selected.status, 'unselected')
    const sharedRoot = path.join(root, 'independent-shared'); await mkdir(sharedRoot)
    await client.rpc('sharedWorkspace.directory.select', { sessionId: session.id, path: sharedRoot, expectedRevision: selected.revision })
    assert.deepEqual(await client.rpc('workspace.info', { sessionId: session.id }), before)
    assert.equal((await client.rpc('sharedWorkspace.status', { sessionId: session.id })).root, sharedRoot)
    assert.ok(observed.length > 0)
  } else assert.deepEqual(observed, [])
})
