import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { MemoryRepository } from '../src/modules/memories/index.ts'

const first = { scopeType: 'agent_character' as const, scopeKey: '1' }
const second = { scopeType: 'agent_character' as const, scopeKey: '2' }

test('long-term memory preserves legacy fields through disk reopen and isolates character scopes', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-memory-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const filename = path.join(root, 'memory.sqlite')
  let database = new EdenDatabase(filename, 'mon')
  context.after(() => database.close())
  let repository = new MemoryRepository(database)
  const source = randomUUID()
  const stored = repository.create(first, '  Tea\n without   sugar  ', 'preference', source, { source: 'explicit_tool' })
  repository.create(second, 'Other character memory')
  assert.equal(stored.content, 'Tea without sugar')
  assert.throws(() => repository.read(second, stored.id), /scope/)
  assert.throws(() => repository.update(second, stored.id, stored.updatedAt, 'Wrong scope'), /scope/)
  assert.throws(() => repository.forget(second, stored.id, stored.updatedAt), /scope/)
  database.close(); database = new EdenDatabase(filename, 'mon'); repository = new MemoryRepository(database)
  assert.deepEqual(repository.read(first, stored.id), stored)
  assert.deepEqual(repository.search(first, 'TEA'), [stored])
  assert.equal(stored.sourceSessionId, source)
  assert.throws(() => new EdenDatabase(filename, 'local'), /origin/)
})

test('memory updates monotonically version records and reject stale update or forget', () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new MemoryRepository(database)
  try {
    const original = repository.create(first, 'Before', 'fact')
    const changed = repository.update(first, original.id, original.updatedAt, 'After', 'decision')
    assert.ok(changed.updatedAt > original.updatedAt)
    assert.equal(changed.createdAt, original.createdAt)
    assert.equal(changed.kind, 'decision')
    assert.throws(() => repository.update(first, changed.id, original.updatedAt, 'Stale'), /changed/)
    assert.throws(() => repository.forget(first, changed.id, original.updatedAt), /changed/)
    assert.deepEqual(repository.read(first, original.id), changed)
    repository.forget(first, changed.id, changed.updatedAt)
    assert.deepEqual(repository.search(first), [])
  } finally { database.close() }
})

test('memory content validation and failed mutations leave no partial durable state', () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new MemoryRepository(database)
  try {
    for (const content of ['', '  ', 'token: credential-value', '密码：secret', 'sk-0123456789abcdef', 'x'.repeat(16001)]) {
      assert.throws(() => repository.create(first, content))
    }
    assert.deepEqual(repository.search(first), [])
    const stored = repository.create(first, 'Keep me')
    database.connection.exec("CREATE TRIGGER fail_memory_update AFTER UPDATE ON memories BEGIN SELECT RAISE(ABORT, 'memory disk fault'); END")
    assert.throws(() => repository.update(first, stored.id, stored.updatedAt, 'Discard me'), /disk fault/)
    assert.deepEqual(repository.read(first, stored.id), stored)
    database.connection.exec("CREATE TRIGGER fail_memory_delete AFTER DELETE ON memories BEGIN SELECT RAISE(ABORT, 'memory disk fault'); END")
    assert.throws(() => repository.forget(first, stored.id, stored.updatedAt), /disk fault/)
    assert.deepEqual(repository.read(first, stored.id), stored)
  } finally { database.close() }
})

test('memory search is bounded and treats wildcard characters literally', () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new MemoryRepository(database)
  try {
    const exact = repository.create(first, 'Battery is 50% charged')
    repository.create(first, 'Ordinary fact')
    assert.deepEqual(repository.search(first, '%'), [exact])
    assert.equal(repository.search(first, '', 1).length, 1)
    assert.throws(() => repository.search(first, '', 101), /bounds/)
    assert.throws(() => repository.search(first, 'x'.repeat(1001)), /bounds/)
  } finally { database.close() }
})
