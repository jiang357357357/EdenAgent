import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { artifactClient, artifactHost, copyArtifactRuntime } from './workspace_artifact_fixture.mjs'

const dataRoot = portable => path.join(portable, 'Data', 'Agent', 'realms', 'mon')
const entryAt = portable => path.join(portable, 'runtime', 'agent', 'server', 'main.mjs')

async function movePortable(root, previous, next) {
  assert.equal(path.dirname(path.resolve(previous)), path.resolve(root))
  assert.equal(path.dirname(path.resolve(next)), path.resolve(root))
  assert.equal(existsSync(next), false)
  await rename(previous, next)
  assert.equal(existsSync(previous), false, 'The previous complete installation must no longer exist')
  assert.ok(existsSync(entryAt(next)), 'Executable code must move together with account data')
}

async function assertReady(host) {
  for (const endpoint of ['/healthz', '/readyz']) {
    const response = await fetch(`http://127.0.0.1:${host.port}${endpoint}`)
    assert.equal(response.status, 200, endpoint)
    assert.equal((await response.json()).checks.accounts, true, endpoint)
  }
}

export async function verifyPortableRelocation(context, artifact, report) {
  const root = await mkdtemp(path.join(tmpdir(), 'eden-artifact-relocation-'))
  const hosts = [], clients = []
  let passed = false
  const core = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Token /, '')
    const id = token === 'account-a' ? '101' : token === 'account-b' ? '202' : undefined
    response.writeHead(id ? 200 : 401, { 'content-type': 'application/json' })
      .end(JSON.stringify(id ? { id } : { error: 'unauthorized' }))
  })
  const stop = async () => {
    for (const client of clients) client.close()
    await Promise.all(hosts.map(host => host.close()))
  }
  context.after(async () => {
    try { await stop() }
    finally {
      core.closeAllConnections()
      await new Promise(resolve => core.close(resolve))
      assert.ok(path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('eden-artifact-relocation-'))
      await rm(root, { recursive: true, force: true })
    }
    if (passed) {
      report.passed('managed-workspace-relocation')
      report.passed('external-workspace-preserved')
    }
  })
  core.listen(0, '127.0.0.1')
  await once(core, 'listening')
  const options = { origin: 'mon', coreUrl: `http://127.0.0.1:${core.address().port}` }
  const start = async portable => {
    const host = await artifactHost(entryAt(portable), portable, dataRoot(portable), options)
    hosts.push(host)
    return host
  }
  const connect = async (host, coreToken) => {
    const client = await artifactClient(host, { origin: 'mon', coreToken })
    clients.push(client)
    return client
  }
  const original = path.join(root, '原始 完整包'), moved = path.join(root, '客户 新目录'), movedAgain = path.join(root, '再次 移动包')
  await copyArtifactRuntime(artifact, original)
  await writeFile(path.join(original, '便携包标记.txt'), 'complete package')
  const first = await start(original)
  const accounts = []
  for (const token of ['account-a', 'account-b']) {
    const client = await connect(first, token)
    const session = await client.rpc('session.create', { title: `移动前 ${token}` })
    const info = await client.rpc('workspace.info', { sessionId: session.id })
    assert.equal(info.kind, 'managed')
    assert.equal(info.status, 'ready')
    const relative = path.relative(original, info.path)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    await writeFile(path.join(info.path, '资料 汉字.txt'), `已有文件 ${token}`)
    accounts.push({ token, sessionId: session.id, path: info.path, relative })
  }
  await stop()
  await movePortable(root, original, moved)
  assert.equal(await readFile(path.join(moved, '便携包标记.txt'), 'utf8'), 'complete package')
  const second = await start(moved)
  const restored = []
  for (const account of accounts) {
    const client = await connect(second, account.token)
    const info = await client.rpc('workspace.info', { sessionId: account.sessionId })
    assert.equal(info.kind, 'managed')
    assert.equal(info.status, 'ready')
    assert.equal(info.path, realpathSync(path.join(moved, account.relative)))
    assert.equal(existsSync(account.path), false)
    assert.equal((await client.rpc('session.read', { sessionId: account.sessionId })).id, account.sessionId)
    assert.equal((await client.rpc('workspace.read', { sessionId: account.sessionId, path: '资料 汉字.txt' })).content, `已有文件 ${account.token}`)
    restored.push({ client, path: info.path })
  }
  assert.notEqual(restored[0].path, restored[1].path)
  await assertReady(second)

  const outside = path.join(root, '用户 手选项目'), inside = path.join(moved, '手选 内部项目')
  for (const project of [outside, inside]) {
    await mkdir(project)
    await writeFile(path.join(project, '项目文件.txt'), 'explicit project content')
  }
  await restored[0].client.rpc('workspace.switch', { sessionId: accounts[0].sessionId, path: outside })
  await restored[1].client.rpc('workspace.switch', { sessionId: accounts[1].sessionId, path: inside })
  const selectedInside = (await restored[1].client.rpc('workspace.info', { sessionId: accounts[1].sessionId })).path
  await stop()
  await movePortable(root, moved, movedAgain)
  const third = await start(movedAgain)
  const a = await connect(third, 'account-a'), b = await connect(third, 'account-b')
  const external = await a.rpc('workspace.info', { sessionId: accounts[0].sessionId }), missing = await b.rpc('workspace.info', { sessionId: accounts[1].sessionId })
  assert.equal(external.kind, 'external')
  assert.equal(external.status, 'ready')
  assert.equal(external.path, realpathSync(outside))
  assert.equal((await a.rpc('workspace.read', { sessionId: accounts[0].sessionId, path: '项目文件.txt' })).content, 'explicit project content')
  assert.equal(missing.kind, 'external')
  assert.equal(missing.status, 'missing')
  assert.equal(missing.path, selectedInside, 'Explicit selections must never be guessed from the portable layout')
  assert.equal((await b.rpc('session.read', { sessionId: accounts[1].sessionId })).id, accounts[1].sessionId)
  await assert.rejects(b.rpc('workspace.read', { sessionId: accounts[1].sessionId, path: '项目文件.txt' }))
  await assertReady(third)
  const movedProject = path.join(movedAgain, '手选 内部项目')
  assert.equal(await readFile(path.join(movedProject, '项目文件.txt'), 'utf8'), 'explicit project content')
  await b.rpc('workspace.switch', { sessionId: accounts[1].sessionId, path: movedProject })
  assert.equal((await b.rpc('workspace.info', { sessionId: accounts[1].sessionId })).path, realpathSync(movedProject))
  assert.equal((await b.rpc('workspace.read', { sessionId: accounts[1].sessionId, path: '项目文件.txt' })).content, 'explicit project content')
  assert.equal(existsSync(original), false)
  assert.equal(existsSync(moved), false)
  passed = true
}
