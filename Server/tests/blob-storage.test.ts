import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, writeFile, symlink, unlink, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { BlobRepository, BlobService } from '../src/modules/blobs/index.ts'

async function fixture(context: test.TestContext, max = 1024) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-blobs-'))
  const db = new EdenDatabase(path.join(root, 'test.sqlite'), 'local')
  context.after(async () => { db.close(); await rm(root, { recursive: true, force: true }) })
  const directory = path.join(root, 'blobs')
  const repository = new BlobRepository(db)
  return { root, db, directory, repository, service: new BlobService(directory, repository, max) }
}

test('blob content is immutable, deduplicated concurrently and restored from disk', async context => {
  const { service, directory, repository, db } = await fixture(context)
  const bytes = Buffer.from('shared content')
  const first = await service.put(bytes, 'text/plain')
  const copies = await Promise.all(Array.from({ length: 8 }, () => service.put(bytes, 'application/octet-stream')))
  assert.ok(copies.every(copy => copy.id === first.id && copy.mime === 'text/plain'))
  assert.equal(db.connection.prepare('SELECT count(*) AS n FROM blobs').get()?.n, 1)
  const restored = new BlobService(directory, repository)
  assert.deepEqual(await restored.read(first.id), { info: first, bytes })
  const parent = path.join(directory, first.sha256.slice(0, 2))
  assert.deepEqual(await readdir(parent), [first.sha256])
  if (process.platform !== 'win32') assert.equal((await stat(path.join(parent, first.sha256))).mode & 0o777, 0o600)
})

test('blob validation occurs before files or metadata are created', async context => {
  const { service, directory, db } = await fixture(context, 4)
  await assert.rejects(service.put(Buffer.alloc(5), 'text/plain'), /size limit/)
  await assert.rejects(service.put(Buffer.alloc(1), 'text/plain\r\nX-Evil: yes'))
  await assert.rejects(readdir(directory), { code: 'ENOENT' })
  assert.equal(db.connection.prepare('SELECT count(*) AS n FROM blobs').get()?.n, 0)
  const empty = await service.put(Buffer.alloc(0), 'text/plain')
  assert.equal((await service.read(empty.id)).bytes.length, 0)
  await assert.rejects(service.read('../escape'), /not found/)
})

test('blob snapshots caller memory before yielding and refuses corrupted content', async context => {
  const { service, directory } = await fixture(context)
  const source = Buffer.from('original')
  const pending = service.put(source, 'text/plain')
  source.fill(0)
  const info = await pending
  assert.equal((await service.read(info.id)).bytes.toString(), 'original')
  const filename = path.join(directory, info.sha256.slice(0, 2), info.sha256)
  await writeFile(filename, 'modified')
  await assert.rejects(service.read(info.id), /integrity/)
  await assert.rejects(service.put(Buffer.from('original'), 'text/plain'), /integrity/)
  await writeFile(filename, Buffer.alloc(1025))
  await assert.rejects(service.read(info.id), /integrity/)
})

test('blob database failure leaves durable content available for an explicit retry', async context => {
  const { service, db, directory } = await fixture(context)
  db.connection.exec("CREATE TRIGGER reject_blob BEFORE INSERT ON blobs BEGIN SELECT RAISE(ABORT, 'disk fault'); END")
  await assert.rejects(service.put(Buffer.from('retry'), 'text/plain'), /disk fault/)
  assert.equal(db.connection.prepare('SELECT count(*) AS n FROM blobs').get()?.n, 0)
  assert.equal((await readdir(directory)).length, 1)
  db.connection.exec('DROP TRIGGER reject_blob')
  const info = await service.put(Buffer.from('retry'), 'text/plain')
  assert.equal((await service.read(info.id)).bytes.toString(), 'retry')
})

test('blob reads reject symlink files without exposing their target', { skip: process.platform === 'win32' }, async context => {
  const { service, directory, root } = await fixture(context)
  const info = await service.put(Buffer.from('content'), 'text/plain')
  const filename = path.join(directory, info.sha256.slice(0, 2), info.sha256)
  const target = path.join(root, 'private')
  await writeFile(target, 'content')
  await unlink(filename)
  await symlink(target, filename)
  await assert.rejects(service.read(info.id), /Unsafe blob file/)
})
