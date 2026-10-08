import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { artifactClient, artifactHost, copyArtifactRuntime } from './workspace_artifact_fixture.mjs'
import { artifactReport } from './workspace_artifact_report.mjs'
import { verifyPortableRelocation } from './workspace_artifact_relocation.mjs'
import { verifyLegacyDefaultRecovery } from './workspace_default_recovery_artifact.mjs'

const artifact = path.resolve(process.env.EDEN_AGENT_ARTIFACT_ENTRY
  || fileURLToPath(new URL('../../dist/server/main.mjs', import.meta.url)))
const report = await artifactReport(artifact, process.env.EDEN_AGENT_ARTIFACT_REPORT)
after(() => report.finish())

test('the built host starts with a missing legacy workspace and persists explicit recovery across IPC process restarts', { timeout: 120000 }, async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'eden-workspace-artifact-'))
  const hosts = [], clients = []
  let passed = false
  context.after(async () => {
    for (const client of clients) client.close()
    try { await Promise.all(hosts.map(host => host.close())) }
    finally {
      assert.ok(path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('eden-workspace-artifact-'))
      await rm(root, { recursive: true, force: true })
    }
    if (passed) report.passed('legacy-workspace-recovery')
  })
  // The supplied installation is only read for executable code/dependencies. All runs use temporary copies.
  const entry = await copyArtifactRuntime(artifact, path.join(root, '程序 副本'))
  const dataRoot = path.join(root, 'data')
  const missing = path.join(root, 'previous-installation', 'workspace')
  const project = path.join(root, 'selected-project')
  await mkdir(project)
  await writeFile(path.join(project, 'artifact.txt'), 'bundled workspace recovery')
  // Let the real bundle create its complete schema before arranging the historical setting.
  const bootstrap = await artifactHost(entry, root, dataRoot)
  hosts.push(bootstrap)
  const bootstrapClient = await artifactClient(bootstrap)
  clients.push(bootstrapClient)
  const session = await bootstrapClient.rpc('session.create', { title: 'bundle recovery' })
  bootstrapClient.close()
  await bootstrap.close()
  const database = new DatabaseSync(path.join(dataRoot, 'eden-agent.db'))
  try {
    database.prepare("DELETE FROM runtime_settings WHERE key LIKE 'workspace.%'").run()
    database.prepare('INSERT INTO runtime_settings VALUES(?,?,?)').run('workspace.root', JSON.stringify(missing), Date.now())
    database.prepare('INSERT OR REPLACE INTO session_workspaces(session_id,settings_json,updated_at) VALUES(?,?,?)')
      .run(session.id, JSON.stringify({ 'workspace.root': missing }), Date.now())
  } finally { database.close() }
  const first = await artifactHost(entry, root, dataRoot)
  hosts.push(first)
  const client = await artifactClient(first)
  clients.push(client)
  const info = await client.rpc('workspace.info', { sessionId: session.id })
  assert.equal(info.status, 'missing')
  assert.equal(info.kind, 'external')
  assert.equal(info.path, missing)
  assert.equal(existsSync(missing), false)
  const newer = await client.rpc('session.create', { title: 'invalid seed does not propagate' })
  assert.equal((await client.rpc('workspace.info', { sessionId: newer.id })).status, 'unselected')
  await client.rpc('workspace.switch', { sessionId: session.id, path: project })
  assert.equal((await client.rpc('workspace.info', { sessionId: session.id })).status, 'ready')
  client.close()
  await first.close()
  const restarted = await artifactHost(entry, root, dataRoot)
  hosts.push(restarted)
  const restored = await artifactClient(restarted)
  clients.push(restored)
  const persisted = await restored.rpc('workspace.info', { sessionId: session.id })
  assert.equal(persisted.status, 'ready')
  assert.equal(persisted.kind, 'external')
  assert.equal(persisted.path, realpathSync(project))
  assert.equal((await restored.rpc('session.read', { sessionId: session.id })).id, session.id)
  assert.equal((await restored.rpc('workspace.read', { sessionId: session.id, path: 'artifact.txt' })).content, 'bundled workspace recovery')
  assert.equal(existsSync(missing), false)
  passed = true
})

test('the exact bundled host preserves managed and explicit workspaces when the complete portable directory moves',
  { timeout: 120000 }, context => verifyPortableRelocation(context, artifact, report))

test('the exact bundled host repairs 21 inherited dead defaults, preserves three chosen projects and stops poisoning new sessions',
  { timeout: 120000 }, context => verifyLegacyDefaultRecovery(context, artifact, report))
