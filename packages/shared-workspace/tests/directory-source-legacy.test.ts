import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SnapshotStore } from '../client/snapshots.ts'
import { identity, digest } from '../lan/identity.ts'
import { LanRepository } from '../lan/repository.ts'
import type { SourceStatus } from '../lan/source-contracts.ts'
import type { Conflict } from '../client/contracts.ts'
import { directorySourceFixture } from './directory-source-fixture.ts'

test('legacy snapshot libraries bind existing folders without overwriting either version and expose administrator conflict resolution', async context => {
  let spaceId = '', fileId = ''
  const f = await directorySourceFixture(context, async (_root, source, host) => {
    const root = path.join(host, 'lan'), device = identity(root)
    const repository = new LanRepository(root, device), snapshots = new SnapshotStore(root)
    try {
      spaceId = repository.create('原云端资料库').id; fileId = randomUUID()
      const bytes = Buffer.from('legacy version'), hash = digest(bytes)
      await snapshots.save(bytes)
      repository.saveBlob(spaceId, device.deviceId, hash, bytes.length)
      repository.commit(spaceId, device.deviceId, { operationId: randomUUID(), fileId, path: 'note.txt', baseRevision: 0,
        deleted: false, sha256: hash, size: bytes.length })
      writeFileSync(path.join(source, 'note.txt'), 'existing cloud folder version')
    } finally { repository.close() }
  })
  const result = await f.admin.hostRequest<{ source: SourceStatus }>(f.hostId, 'POST', `spaces/${spaceId}/source`, { path: f.source, confirmSource: true })
  assert.equal(result.source.conflicts, 1)
  assert.equal(readFileSync(path.join(f.source, 'note.txt'), 'utf8'), 'existing cloud folder version')
  const conflicts = await f.admin.hostRequest<{ conflicts: Conflict[] }>(f.hostId, 'GET', `spaces/${spaceId}/source/conflicts`)
  assert.equal(conflicts.conflicts.length, 1)
  const resolved = await f.admin.hostRequest<{ source: SourceStatus }>(f.hostId, 'POST', `spaces/${spaceId}/source/resolve`, { conflictId: conflicts.conflicts[0]!.id, strategy: 'local' })
  assert.equal(resolved.source.conflicts, 0)
  await f.client.bind(spaceId); await f.client.sync()
  assert.equal(readFileSync(path.join(f.local, 'note.txt'), 'utf8'), 'existing cloud folder version')
  assert.equal((await f.client.history(fileId)).versions.length, 2, 'legacy revision is retained')
})
