import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { createSharedLanRuntime, createSharedWorkspaceClient } from '../../packages/shared-workspace/index.ts'

const entry = fileURLToPath(new URL('../../dist/server/shared-workspace-host.mjs', import.meta.url))

async function startHost(data, administrator, port) {
  const seed = { schemaVersion: 1, capability: 'workspace.publish.v2', administrators: [administrator] }
  const child = spawn(process.execPath, [entry, '--data', data, '--host', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, EDEN_SHARED_HOST_BOOTSTRAP: Buffer.from(JSON.stringify(seed)).toString('base64url') },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let stderr = ''
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-2000) })
  const lines = createInterface({ input: child.stdout })
  const stop = async () => {
    lines.close()
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
  }
  try {
    const invitation = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Cloud artifact startup timed out: ${stderr}`)), 15000)
      const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value) }
      child.once('error', error => finish(error))
      child.once('exit', code => finish(new Error(`Cloud artifact exited (${code}): ${stderr}`)))
      lines.on('line', line => {
        const value = JSON.parse(line)
        if (value.event === 'shared_host_pairing_invitation') finish(null, value)
      })
    })
    return { ...invitation, stop }
  } catch (error) { await stop(); throw error }
}

test('compiled standalone cloud host shares existing files, writes back and restores bindings after process restart', { timeout: 30000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'eden-cloud-artifact-')))
  const source = path.join(root, 'source'), local = path.join(root, 'receiver'), data = path.join(root, 'host')
  await mkdir(source); await mkdir(local)
  const admin = await createSharedLanRuntime({ dataRoot: path.join(root, 'admin'), active: () => true,
    canPublish: () => true, host: '127.0.0.1', discovery: false })
  let host, client
  t.after(async () => {
    await client?.close(); await admin.close(); await host?.stop()
    assert.equal(path.dirname(root), await realpath(tmpdir()))
    assert.ok(path.basename(root).startsWith('eden-cloud-artifact-'))
    await rm(root, { recursive: true, force: true })
  })
  const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  await writeFile(path.join(source, 'proof.txt'), 'cloud original')
  host = await startHost(data, admin.deploymentIdentity(), port)
  const paired = await admin.connectHost(host.code, host.addresses[0])
  const folder = await admin.hostRequest(paired.deviceId, 'POST', 'directories/create', { parent: root, name: 'created-from-client' })
  assert.equal(folder.path, path.join(root, 'created-from-client'))
  assert.deepEqual(await admin.hostRequest(paired.deviceId, 'GET', 'spaces'), { spaces: [] })
  const { space } = await admin.hostRequest(paired.deviceId, 'POST', 'spaces', {
    name: 'compiled cloud source', sourceDirectory: source, confirmSource: true,
  })
  client = createSharedWorkspaceClient({ dataRoot: path.join(root, 'client'), remote: admin.remote,
    workspace: () => ({ root: local, key: 'artifact' }), mutate: async (_root, work) => work() })
  await client.bind(space.id); await client.sync()
  assert.equal(client.status().error, null)
  assert.equal(await readFile(path.join(local, 'proof.txt'), 'utf8'), 'cloud original')
  await writeFile(path.join(local, 'proof.txt'), 'authorized receiver edit'); await client.sync()
  assert.equal(await readFile(path.join(source, 'proof.txt'), 'utf8'), 'authorized receiver edit')
  await host.stop()
  host = await startHost(data, admin.deploymentIdentity(), port)
  await admin.connectHost(host.code, host.addresses[0])
  await writeFile(path.join(source, 'proof.txt'), 'cloud edit after restart'); await client.sync()
  assert.equal(client.status().error, null)
  assert.equal(await readFile(path.join(local, 'proof.txt'), 'utf8'), 'cloud edit after restart')
  const catalog = await admin.remote.request('GET', 'spaces')
  assert.equal(catalog.spaces.find(value => value.id === space.id).source.path, source)
  assert.equal((await client.history(client.files()[0].fileId)).versions.length, 3)
})
