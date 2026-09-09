import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { BlobRepository, BlobService } from '../src/modules/blobs/index.ts'
import { AttachmentService } from '../src/modules/attachments/index.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-attachments-'))
  const database = new EdenDatabase(path.join(root, 'test.sqlite'), 'local')
  context.after(async () => { database.close(); await rm(root, { recursive: true, force: true }) })
  const blobs = new BlobService(path.join(root, 'blobs'), new BlobRepository(database))
  return { root, database, blobs, attachments: new AttachmentService(blobs) }
}

test('attachment snapshots retain only immutable references and restore images and files', async context => {
  const f = await fixture(context)
  const image = await f.blobs.put(png, 'image/png')
  const file = await f.blobs.put(Buffer.from('document content'), 'text/plain')
  const reference = { blobId: image.id, mime: image.mime, filename: 'pixel.png' }
  const pending = f.attachments.snapshot([reference, { blobId: file.id, mime: file.mime, filename: 'note.txt' }])
  reference.filename = 'changed.png'
  const snapshots = await pending
  assert.equal(snapshots[0]?.filename, 'pixel.png')
  assert.equal(snapshots[0]?.sha256, image.sha256)
  assert.equal(snapshots[1]?.kind, 'file')
  assert.ok(!JSON.stringify(snapshots).includes(png.toString('base64')))
  assert.ok(!JSON.stringify(snapshots).includes('document content'))
  const filename = path.join(f.root, 'snapshot.json')
  await writeFile(filename, JSON.stringify(snapshots))
  const reopened = new EdenDatabase(path.join(f.root, 'test.sqlite'), 'local')
  try {
    const restored = new AttachmentService(new BlobService(path.join(f.root, 'blobs'), new BlobRepository(reopened)))
    const fromDisk = JSON.parse(await readFile(filename, 'utf8'))
    assert.deepEqual(await restored.images(fromDisk), [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }])
    assert.equal((await restored.read(snapshots[1]!)).toString(), 'document content')
  } finally { reopened.close() }
})

test('attachment admission refuses foreign IDs, MIME spoofing and fake image signatures', async context => {
  const f = await fixture(context)
  const foreign = await fixture(context)
  const image = await foreign.blobs.put(png, 'image/png')
  await assert.rejects(f.attachments.snapshot([{ blobId: image.id, mime: image.mime }]), /not found/)
  const text = await f.blobs.put(Buffer.from('ordinary text'), 'text/plain')
  await assert.rejects(f.attachments.snapshot([{ blobId: text.id, mime: 'image/png' }]), /MIME/)
  const fake = await f.blobs.put(Buffer.from('not an actual PNG'), 'image/png')
  await assert.rejects(f.attachments.snapshot([{ blobId: fake.id, mime: fake.mime }]), /signature/)
  await assert.rejects(f.attachments.snapshot([{ blobId: '../outside', mime: 'text/plain' }]))
})

test('attachment restoration rejects changed records, bytes and forged kinds', async context => {
  const f = await fixture(context)
  const image = await f.blobs.put(png, 'image/png')
  const snapshots = await f.attachments.snapshot([{ blobId: image.id, mime: image.mime }])
  await assert.rejects(f.attachments.images([{ ...snapshots[0]!, kind: 'file' }]), /kind/)
  f.database.connection.prepare('UPDATE blobs SET mime = ? WHERE id = ?').run('text/plain', image.id)
  await assert.rejects(f.attachments.images(snapshots), /snapshot/)
  f.database.connection.prepare('UPDATE blobs SET mime = ? WHERE id = ?').run('image/png', image.id)
  await writeFile(path.join(f.root, 'blobs', image.sha256.slice(0, 2), image.sha256), Buffer.alloc(png.length))
  await assert.rejects(f.attachments.images(snapshots), /integrity/)
})

test('attachment budget rejects oversized metadata before attempting to read files', async context => {
  const f = await fixture(context)
  const image = await f.blobs.put(png, 'image/png')
  const ref = { blobId: image.id, mime: image.mime }
  await assert.rejects(f.attachments.snapshot(Array.from({ length: 9 }, () => ref)), /eight/)
  f.database.connection.prepare('UPDATE blobs SET byte_length = ? WHERE id = ?').run(32 * 1024 * 1024 + 1, image.id)
  await assert.rejects(f.attachments.snapshot([ref]), /32 MiB/)
  await assert.rejects(f.attachments.snapshot([{ ...ref, filename: 'line\nbreak' }]))
})
