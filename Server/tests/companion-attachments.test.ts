import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { createServices } from '../src/bootstrap/services.ts'

const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='

test('production companion actors receive shared images and scoped files without sharing private tool results', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-companion-attachments-'))
  const db = new EdenDatabase(path.join(root, 'test.sqlite'), 'mon')
  const read = { action: 'read', blobId: '' }
  const director = await recordedModel([{ text: '{"beats":[{"assistantId":1},{"assistantId":2}]}' }])
  const first = await recordedModel([{ tool: 'eden_attachment', input: read }, { text: 'First public image reply' }])
  const second = await recordedModel([{ text: 'Second public image reply' }])
  const services = createServices(db, loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_V2_DATA_ROOT: root }))
  context.after(async () => {
    await Promise.all([services.sessions.close(), services.companion.close(), services.mon.close(), services.plugins.close()])
    services.questions.close(); db.close()
    await Promise.all([director.close(), first.close(), second.close()]); await rm(root, { recursive: true, force: true })
  })
  const session = services.repository.create('Shared attachments', [{ assistantId: 1 }, { assistantId: 2 }])
  services.models.bindActors(session.id, [
    { assistantId: 1, characterId: 1, main: { model: first.config, entityId: 1, label: 'First' } },
    { assistantId: 2, characterId: 2, main: { model: second.config, entityId: 2, label: 'Second' } },
  ], director.config)
  const image = await services.blobs.put(Buffer.from(data, 'base64'), 'image/png')
  const file = await services.blobs.put(Buffer.from('PRIVATE_FILE_TOOL_OBSERVATION'), 'text/plain')
  read.blobId = file.id
  await services.sessions.startWithAttachments(session.id, 'Both of you inspect these', [
    { blobId: image.id, mime: image.mime, filename: 'pixel.png' },
    { blobId: file.id, mime: file.mime, filename: 'note.txt' },
  ])
  await services.sessions.waitForIdle(session.id)
  assert.equal(services.sessions.faultCount(), 0)
  const planning = JSON.stringify(director.requests)
  assert.match(planning, /pixel.png/)
  assert.match(planning, /note.txt/)
  assert.ok(!planning.includes(data))
  assert.equal(first.requests.length, 2)
  assert.equal(second.requests.length, 1)
  for (const request of [...first.requests, ...second.requests]) assert.ok(JSON.stringify(request).includes(`data:image/png;base64,${data}`))
  assert.match(JSON.stringify(first.requests[1]), /PRIVATE_FILE_TOOL_OBSERVATION/)
  assert.ok(!JSON.stringify(second.requests[0]).includes('PRIVATE_FILE_TOOL_OBSERVATION'))
  assert.match(JSON.stringify(second.requests[0]), /First public image reply/)
  const checkpoints = db.connection.prepare('SELECT assistant_id, checkpoint_json FROM actor_checkpoints ORDER BY assistant_id').all()
  assert.equal(checkpoints.length, 2)
  assert.ok(checkpoints.every(row => String(row.checkpoint_json).includes(data)))
  assert.ok(!String(checkpoints[1]?.checkpoint_json).includes('PRIVATE_FILE_TOOL_OBSERVATION'))
  assert.equal(services.directors.list(session.id)[0]?.status, 'completed')
  const messages = services.repository.events.messages(session.id, undefined, 100).items
  assert.ok(!JSON.stringify(messages).includes(data))
  assert.match(JSON.stringify(messages), new RegExp(image.id))
  assert.match(JSON.stringify(messages), new RegExp(file.id))
})
