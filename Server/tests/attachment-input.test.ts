import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { AttachmentService } from '../src/modules/attachments/index.ts'
import { BlobService, BlobRepository } from '../src/modules/blobs/index.ts'
import { wireEvent } from '../src/transport/rpc/session.routes.ts'

const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='

async function fixture(context: test.TestContext, ready = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-attachment-input-'))
  const database = new EdenDatabase(path.join(root, 'test.sqlite'), 'local')
  const model = await recordedModel([{ text: 'I see the image' }, { text: 'I remember it' }])
  const repository = new SessionRepository(database, 'local')
  const blobs = new BlobService(path.join(root, 'blobs'), new BlobRepository(database))
  const attachments = new AttachmentService(blobs)
  const boundary = { pendingSessions: () => [], run: async () => ready }
  const create = () => new SessionService(repository, model.config, undefined, undefined, undefined, boundary, attachments)
  let service = create()
  context.after(async () => { await service.close(); database.close(); await model.close(); await rm(root, { recursive: true, force: true }) })
  const session = repository.create('Image queue')
  const info = await blobs.put(Buffer.from(data, 'base64'), 'image/png')
  return { database, model, repository, attachments, session, ref: { blobId: info.id, mime: info.mime },
    allow() { ready = true },
    get service() { return service }, async restart() { await service.close(); service = create() } }
}

test('accepted image references are transactional, idempotent and feed restored model history', async context => {
  const f = await fixture(context)
  const accepted = await f.service.startWithAttachments(f.session.id, 'Look', [f.ref], 'image-key')
  await f.service.waitForIdle(f.session.id)
  const duplicate = await f.service.startWithAttachments(f.session.id, 'Look', [f.ref], 'image-key')
  assert.equal(duplicate.inputId, accepted.inputId)
  const row = f.database.connection.prepare('SELECT metadata_json FROM inputs WHERE id=?').get(accepted.inputId)
  assert.match(String(row?.metadata_json), new RegExp(f.ref.blobId))
  assert.ok(!String(row?.metadata_json).includes(data))
  assert.ok(JSON.stringify(f.model.requests[0]).includes(`data:image/png;base64,${data}`))
  assert.equal(f.model.requests.length, 1)
  const events = f.repository.events.list(f.session.id, '0', 1000)
  const publicMessages = f.repository.events.messages(f.session.id, undefined, 100).items
  assert.ok(!JSON.stringify(publicMessages).includes(data))
  assert.match(JSON.stringify(publicMessages), /"type":"attachment"/)
  assert.match(JSON.stringify(publicMessages), new RegExp(f.ref.blobId))
  assert.ok(JSON.stringify(events.filter(event => event.kind === 'model.request')).includes(data))
  assert.ok(!JSON.stringify(events.map(wireEvent)).includes(data))
  await f.restart()
  f.service.start(f.session.id, 'Remember the image')
  await f.service.waitForIdle(f.session.id)
  assert.ok(JSON.stringify(f.model.requests[1]).includes(data))
})

test('queued image snapshots survive service restart before the first model request', async context => {
  const f = await fixture(context, false)
  const accepted = await f.service.startWithAttachments(f.session.id, 'Queued image', [f.ref])
  await f.service.waitForIdle(f.session.id)
  assert.equal(f.model.requests.length, 0)
  assert.equal(f.database.connection.prepare('SELECT state FROM inputs WHERE id=?').get(accepted.inputId)?.state, 'queued')
  await f.restart()
  f.allow()
  f.service.resumePending()
  await f.service.waitForIdle(f.session.id)
  assert.ok(JSON.stringify(f.model.requests[0]).includes(`data:image/png;base64,${data}`))
  assert.equal(f.database.connection.prepare('SELECT state FROM inputs WHERE id=?').get(accepted.inputId)?.state, 'completed')
})

test('failed attachment queue event rolls back both input and environment without model execution', async context => {
  const f = await fixture(context)
  const before = f.repository.read(f.session.id).environment
  f.database.connection.exec("CREATE TRIGGER reject_attachment BEFORE INSERT ON events WHEN NEW.kind='input.queued' BEGIN SELECT RAISE(ABORT, 'queue disk failure'); END")
  await assert.rejects(f.service.startWithAttachments(f.session.id, 'Look', [f.ref], 'failed', { timezone: 'Asia/Tokyo' }), /queue disk failure/)
  assert.equal(f.database.connection.prepare('SELECT count(*) AS n FROM inputs').get()?.n, 0)
  assert.deepEqual(f.repository.read(f.session.id).environment, before)
  assert.equal(f.model.requests.length, 0)
})

for (const action of ['cancel', 'close'] as const) {
  test(`${action} while validating an attachment prevents a late queue commit`, async context => {
    const f = await fixture(context)
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const paused = new Promise<void>(resolve => { release = resolve })
    const original = f.attachments.snapshot.bind(f.attachments)
    f.attachments.snapshot = async refs => { entered(); await paused; return original(refs) }
    const pending = f.service.startWithAttachments(f.session.id, 'Look', [f.ref])
    const rejected = assert.rejects(pending, /cancelled|shutting down/)
    await started
    const stopping = action === 'cancel' ? f.service.cancel(f.session.id) : f.service.close()
    release()
    await stopping
    await rejected
    assert.equal(f.database.connection.prepare('SELECT count(*) AS n FROM inputs').get()?.n, 0)
    assert.equal(f.model.requests.length, 0)
  })
}
