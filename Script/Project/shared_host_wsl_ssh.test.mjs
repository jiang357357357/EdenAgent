import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSharedLanRuntime, createSharedWorkspaceClient } from '../../packages/shared-workspace/index.ts'
import { HostDeploymentJobs } from '../../Server/src/modules/shared-workspace/host-deployment-jobs.ts'
import { probeSshHost } from '../../Server/src/modules/shared-workspace/host-ssh.ts'
import { emptyHostFixture } from './fixtures/shared-host-empty-fixture.mjs'

const execute = promisify(execFile)
const nodePath = process.env.EDEN_SHARED_HOST_LINUX_NODE
const bundleRoot = process.env.EDEN_SHARED_HOST_RUNTIME_BUNDLE ?? fileURLToPath(new URL('../../../DLC/SharedWorkspace/Runtime', import.meta.url))
const distro = process.env.EDEN_SHARED_HOST_WSL_DISTRO ?? 'Ubuntu'
const run = (executable, args) => execute('wsl.exe', ['-d', distro, '--exec', executable, ...args], { timeout: 30_000, encoding: 'utf8' })
const wait = delay => new Promise(resolve => setTimeout(resolve, delay))
async function finished(jobs, id) {
  let previous = ''
  for (let tick = 0; tick < 1200; tick++) {
    const result = jobs.status(id)
    if (result.phase !== previous) { console.log(`[empty-host] ${result.phase}: ${result.message}`); previous = result.phase }
    if (result.state !== 'running') return result
    await wait(100)
  }
  jobs.cancel(id); throw new Error('deployment did not finish')
}

test('blank Linux host over real SSH/SFTP: automatic Node/MonPM installation without global runtimes or download tools', {
  skip: process.platform !== 'win32' || !nodePath, timeout: 240_000,
}, async () => {
  const remoteRoot = `/tmp/eden-shared-host-${randomUUID()}`
  const directory = remoteRoot + "/部署 ' $(echo unused)"
  const local = await mkdtemp(path.join(tmpdir(), 'eden-ssh-wsl-client-'))
  const address = (await run('hostname', ['-I'])).stdout.trim().split(/\s+/)[0]
  assert.match(address, /^\d+\.\d+\.\d+\.\d+$/)
  const portReply = await run(nodePath, ['--input-type=module', '-e', 'import {createServer} from "node:net"; const s=createServer(); s.listen(0,"0.0.0.0",()=>{console.log(s.address().port);s.close()})'])
  const servicePort = Number(portReply.stdout.trim())
  assert.ok(servicePort > 0 && servicePort < 65536)
  const publicAddress = `http://${address}:${servicePort}`
  const fresh = await emptyHostFixture(distro, nodePath)
  const admin = await createSharedLanRuntime({ dataRoot: path.join(local, 'admin'), active: () => true, canPublish: () => true, discovery: false, host: '127.0.0.1' })
  const receiver = await createSharedLanRuntime({ dataRoot: path.join(local, 'receiver'), active: () => true, canPublish: () => false, discovery: false, host: '127.0.0.1' })
  const jobs = new HostDeploymentJobs({ active: () => true, canPublish: () => true, runtime: async () => admin, runtimeBundleRoot: () => bundleRoot })
  const clients = []
  try {
    assert.equal((await fresh.exec('/bin/sh', ['-c', 'command -v node; command -v monpm; command -v curl; :'])).stdout.trim(), '')
    const target = fresh.target
    const observed = await probeSshHost(target, new AbortController().signal)
    const input = { ...target, ...observed, auth: { type: 'password', password: fresh.password }, directory, name: 'WSL isolated shared host',
      servicePort, publicAddress, installService: false }
    const deployed = await finished(jobs, jobs.start(input).id)
    assert.equal(deployed.state, 'succeeded', deployed.message)
    assert.equal(deployed.hostStarted, true); assert.equal(deployed.bootService, false)
    assert.equal(deployed.directory, directory)
    assert.ok(!JSON.stringify(deployed).includes(fresh.password))
    const config = await fresh.readJson(directory + '/shared-host.monpm.json')
    assert.ok(config.apps[0].command.startsWith(directory + '/runtime/'))
    assert.ok(config.apps[0].env.LD_LIBRARY_PATH.startsWith(directory + '/runtime/'))
    assert.equal((await fresh.exec('/usr/bin/uname', ['-s'])).stdout.trim(), 'Linux')
    assert.equal((await fresh.exec('/bin/sh', ['-c', 'command -v node; command -v monpm; command -v curl; :'])).stdout.trim(), '')
    const hostId = deployed.deviceId
    const sourceDirectory = '/shared-source'
    await fresh.exec('/bin/mkdir', [sourceDirectory])
    const created = await admin.hostRequest(hostId, 'POST', 'spaces', { name: 'WSL cloud documents', sourceDirectory, confirmSource: true })
    const invitation = await admin.hostRequest(hostId, 'POST', 'pairing/invite')
    await receiver.connectHost(invitation.code, publicAddress)
    await admin.remote.request('PUT', `spaces/${created.space.id}/members`, { deviceId: receiver.network().deviceId, role: 'editor' })
    await receiver.remote.request('GET', 'spaces')
    const makeClient = async (runtime, name) => {
      const root = path.join(local, name); await mkdir(root)
      const client = createSharedWorkspaceClient({ dataRoot: path.join(local, name + '-state'), remote: runtime.remote,
        workspace: () => ({ root, key: name }), mutate: async (_root, work) => work() })
      clients.push(client); await client.bind(created.space.id); return { root, client }
    }
    const source = await makeClient(admin, 'source'), targetClient = await makeClient(receiver, 'target')
    await writeFile(path.join(source.root, 'proof.txt'), 'Windows -> SSH Linux host -> Windows receiver')
    await source.client.sync(); await targetClient.client.sync()
    assert.equal(await readFile(path.join(targetClient.root, 'proof.txt'), 'utf8'), 'Windows -> SSH Linux host -> Windows receiver')
    const repeated = await finished(jobs, jobs.start(input).id)
    assert.equal(repeated.state, 'succeeded', repeated.message); assert.equal(repeated.deviceId, hostId)
    assert.equal((await admin.remote.request('GET', 'spaces')).spaces[0].id, created.space.id)
    await writeFile(path.join(targetClient.root, 'proof.txt'), 'persisted after SSH redeployment')
    await targetClient.client.sync(); await source.client.sync()
    assert.equal(await readFile(path.join(source.root, 'proof.txt'), 'utf8'), 'persisted after SSH redeployment')
    assert.equal((await source.client.history(source.client.files()[0].fileId)).versions.length, 2)
    assert.ok(fresh.commands.includes('uname -sm'))
    assert.ok(fresh.commands.every(command => !command.includes(fresh.password)))
  } catch (error) {
    console.error(error.message)
    try { console.error(await fresh.readText(directory + '/deployment.log')) } catch { /* No remote mutation before preflight. */ }
    throw error
  } finally {
    jobs.suspend()
    for (const client of clients) await client.close()
    await receiver.close(); await admin.close()
    try {
      const config = await fresh.readJson(directory + '/shared-host.monpm.json')
      const installedMonpm = path.posix.join(path.posix.dirname(config.apps[0].command), 'monpm')
      await fresh.exec(installedMonpm, ['daemon', 'shutdown', '-config', directory + '/shared-host.monpm.json'])
    } catch { /* The disposable root cleanup also stops only its own remaining processes. */ }
    assert.match(remoteRoot, /^\/tmp\/eden-shared-host-[a-f0-9-]{36}$/)
    await fresh.close()
    await rm(local, { recursive: true, force: true })
  }
})
