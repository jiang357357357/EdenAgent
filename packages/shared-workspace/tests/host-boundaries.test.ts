import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeSharedHostAddress } from '../index.ts'
import { endpoint } from '../lan/validation.ts'
import { identity } from '../lan/identity.ts'
import { LanRepository } from '../lan/repository.ts'

test('explicit host connections allow public IPv4/HTTPS while LAN endpoints retain private-only validation', () => {
  assert.equal(normalizeSharedHostAddress('203.0.113.10'), 'http://203.0.113.10:40195')
  assert.equal(normalizeSharedHostAddress('203.0.113.10:40196'), 'http://203.0.113.10:40196')
  assert.equal(normalizeSharedHostAddress('203.0.113.10:80'), 'http://203.0.113.10')
  assert.equal(normalizeSharedHostAddress('https://shared.example.com'), 'https://shared.example.com')
  assert.throws(() => endpoint('http://203.0.113.10:40195'))
  for (const address of ['file:///tmp/x', 'http://user:pass@example.com', 'http://0.0.0.0', 'http://example.com/path', 'https://example.com?secret=x'])
    assert.throws(() => normalizeSharedHostAddress(address))
})

test('spoofing a configured administrator UUID with another signing key is rejected before saving the peer', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eden-cloud-pins-'))
  const host = identity(path.join(root, 'host')), admin = identity(path.join(root, 'admin')), stranger = identity(path.join(root, 'stranger'))
  const repository = new LanRepository(path.join(root, 'db'), host, [{ deviceId: admin.deviceId, publicKey: admin.publicKey }])
  try {
    assert.throws(() => repository.savePeer({ deviceId: admin.deviceId, publicKey: stranger.publicKey, name: 'spoof',
      key: 'x', addresses: [], revoked: false }), /密钥不一致/)
    assert.equal(repository.peers().length, 0)
    assert.equal(repository.canManage(admin.deviceId), false)
  } finally { repository.close(); rmSync(root, { recursive: true, force: true }) }
})
