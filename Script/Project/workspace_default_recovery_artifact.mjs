import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { artifactClient, artifactHost, copyArtifactRuntime } from './workspace_artifact_fixture.mjs'

export async function verifyLegacyDefaultRecovery(t, artifact, report) {
    assert.equal(process.versions.node, '22.23.1')
    const root = await mkdtemp(path.join(tmpdir(), 'eden-default-recovery-artifact-'))
    const hosts = [], clients = []
    let passed = false
    const core = createServer((request, response) => {
      const authorized = request.headers.authorization === 'Token fixture-account'
      response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' })
        .end(JSON.stringify(authorized ? { id: '101' } : { error: 'unauthorized' }))
    })
    const stop = async () => {
      for (const client of clients) client.close()
      await Promise.all(hosts.map(host => host.close()))
    }
    t.after(async () => {
      try { await stop() }
      finally {
        core.closeAllConnections()
        await new Promise(resolve => core.close(resolve))
        assert.equal(realpathSync(path.dirname(root)), realpathSync(tmpdir()))
        assert.ok(path.basename(root).startsWith('eden-default-recovery-artifact-'))
        await rm(root, { recursive: true, force: true })
      }
      if (passed) report.passed('legacy-default-inheritance')
    })
    core.listen(0, '127.0.0.1'); await once(core, 'listening')
    const options = { origin: 'mon', coreUrl: `http://127.0.0.1:${core.address().port}` }
    const portable = path.join(root, '客户新安装'), data = path.join(portable, 'Data', 'Agent', 'realms', 'mon')
    const entry = await copyArtifactRuntime(artifact, portable)
    const start = async () => {
      const host = await artifactHost(entry, portable, data, options)
      hosts.push(host)
      const client = await artifactClient(host, { origin: 'mon', coreToken: 'fixture-account' })
      clients.push(client)
      return { host, client }
    }
    const initial = await start(), ids = []
    const project = path.join(root, '普拉娜的工作报告')
    await mkdir(project); await writeFile(path.join(project, '工作报告.txt'), 'keep the manually chosen project')
    for (let i = 0; i < 24; i++) ids.push((await initial.client.rpc('session.create', { title: `客户会话 ${i}` })).id)
    const current = (await initial.client.rpc('workspace.info', { sessionId: ids[0] })).path
    await writeFile(path.join(current, '原有文件.txt'), 'retain the current default contents')
    for (const id of ids.slice(0, 21)) await initial.client.rpc('workspace.info', { sessionId: id })
    for (const id of ids.slice(21)) await initial.client.rpc('workspace.switch', { sessionId: id, path: project })
    await stop()
    const account = path.basename(path.dirname(current))
    const old = path.join(root, 'EDEN_win_20260921_a217f69 已删除', 'Data', 'Agent', 'realms', 'mon', 'accounts', account, 'workspace')
    const databasePath = path.join(path.dirname(current), 'storage', 'eden-agent.db')
    let database = new DatabaseSync(databasePath), before
    try {
      const setting = database.prepare('INSERT OR REPLACE INTO runtime_settings VALUES(?,?,?)')
      setting.run('workspace.root', JSON.stringify(old), Date.now())
      setting.run('workspace.selection', JSON.stringify({ version: 1, kind: 'external', path: old }), Date.now())
      const read = database.prepare('SELECT settings_json FROM session_workspaces WHERE session_id=?')
      const update = database.prepare('UPDATE session_workspaces SET settings_json=? WHERE session_id=?')
      for (const id of ids.slice(0, 21)) {
        const settings = JSON.parse(read.get(id).settings_json)
        settings['workspace.root'] = old
        settings['workspace.selection'] = { version: 1, kind: 'external', path: old }
        update.run(JSON.stringify(settings), id)
      }
      before = ids.slice(21).map(id => database.prepare('SELECT * FROM session_workspaces WHERE session_id=?').get(id))
    } finally { database.close() }
    const restarted = await start()
    for (const id of ids.slice(0, 21)) {
      const info = await restarted.client.rpc('workspace.info', { sessionId: id })
      assert.equal(info.path, current); assert.equal(info.kind, 'managed'); assert.equal(info.status, 'ready')
    }
    for (const id of ids.slice(21)) {
      const info = await restarted.client.rpc('workspace.info', { sessionId: id })
      assert.equal(info.path, realpathSync(project)); assert.equal(info.kind, 'external')
    }
    const newer = await restarted.client.rpc('session.create', { title: '修复后的新会话' })
    assert.equal((await restarted.client.rpc('workspace.info', { sessionId: newer.id })).path, current)
    assert.equal((await restarted.client.rpc('workspace.read', { sessionId: ids[0], path: '原有文件.txt' })).content,
      'retain the current default contents')
    for (const endpoint of ['/healthz', '/readyz']) {
      assert.equal((await fetch(`http://127.0.0.1:${restarted.host.port}${endpoint}`)).status, 200)
    }
    await stop()
    database = new DatabaseSync(databasePath)
    try {
      const audit = JSON.parse(database.prepare("SELECT value_json FROM runtime_settings WHERE key='workspace.selection.default_recovery'").get().value_json)
      assert.equal(audit.recoveredSessions, 21)
      ids.slice(21).forEach((id, i) => assert.deepEqual(database.prepare('SELECT * FROM session_workspaces WHERE session_id=?').get(id), before[i]))
    } finally { database.close() }
    const again = await start()
    assert.equal((await again.client.rpc('workspace.info', { sessionId: newer.id })).path, current)
    assert.equal(await readFile(path.join(project, '工作报告.txt'), 'utf8'), 'keep the manually chosen project')
    assert.equal(existsSync(old), false)
    passed = true
}
