import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSharedLanRuntime } from '../index.ts'

test('authenticated cloud host classification survives re-pairing, client restart and host offline', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eden-host-modes-'))
  const options = { active: () => true, canPublish: () => true, discovery: false, host: '127.0.0.1' }
  const cloud = await createSharedLanRuntime({ ...options, dataRoot: path.join(root, 'cloud'), dedicated: true })
  let client = await createSharedLanRuntime({ ...options, dataRoot: path.join(root, 'client') })
  const id = cloud.network().deviceId
  try {
    await client.connectHost(cloud.invite().code)
    assert.equal((await client.hosts()).hosts.find(host => host.deviceId === id)?.dedicated, true)
    await client.connectHost(cloud.invite().code)
    await client.close(); await cloud.close()
    client = await createSharedLanRuntime({ ...options, dataRoot: path.join(root, 'client') })
    const offline = (await client.hosts()).hosts.find(host => host.deviceId === id)
    assert.equal(offline?.dedicated, true)
    assert.equal(offline?.reachable, false)
  } finally { await client.close(); await cloud.close(); rmSync(root, { recursive: true, force: true }) }
})

test('LAN pairing accepts a bare private IP and port and rejects a public address', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eden-lan-mode-'))
  const options = { active: () => true, canPublish: () => true, discovery: false, host: '127.0.0.1' }
  const host = await createSharedLanRuntime({ ...options, dataRoot: path.join(root, 'host') })
  const client = await createSharedLanRuntime({ ...options, dataRoot: path.join(root, 'client') })
  try {
    await assert.rejects(client.pair(host.invite().code, '203.0.113.10:40195'))
    await client.pair(host.invite().code, `127.0.0.1:${host.network().port}`)
    const peer = (await client.hosts()).hosts.find(value => value.deviceId === host.network().deviceId)
    assert.equal(peer?.reachable, true); assert.equal(peer?.dedicated, false)
  } finally { await client.close(); await host.close(); rmSync(root, { recursive: true, force: true }) }
})
