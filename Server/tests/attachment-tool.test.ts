import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { createServices } from '../src/bootstrap/services.ts'
import { attachmentTool, AttachmentRepository } from '../src/modules/attachments/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { toJson } from '@eden/api'

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-attachment-tool-'))
  const database = new EdenDatabase(path.join(root, 'test.sqlite'), 'local')
  const readInput = { action: 'read', blobId: '' }
  const model = await recordedModel([{ tool: 'eden_attachment', input: { action: 'list' } }, { tool: 'eden_attachment', input: readInput }, { text: 'Finished' }])
  const config = { ...loadConfig({ EDEN_AGENT_V2_DATA_ROOT: root }), model: model.config }
  const services = createServices(database, config)
  context.after(async () => {
    await services.sessions.close(); await services.plugins.close(); await services.mon.close(); await services.companion.close(); services.questions.close()
    database.close(); await model.close(); await rm(root, { recursive: true, force: true })
  })
  const session = services.repository.create('Files')
  const inputs = new InputRepository(database, services.repository.events)
  return { database, model, services, session, inputs, readInput }
}

test('production file input exposes attachment catalog to the model and persists tool intent/results', async context => {
  const f = await fixture(context)
  const info = await f.services.blobs.put(Buffer.from('document private content'), 'text/plain')
  f.readInput.blobId = info.id
  const accepted = await f.services.sessions.startWithAttachments(f.session.id, 'List the file', [{ blobId: info.id, mime: info.mime, filename: 'document.txt' }])
  await f.services.sessions.waitForIdle(f.session.id)
  assert.equal(f.services.sessions.faultCount(), 0)
  const first = JSON.stringify(f.model.requests[0])
  assert.match(first, /document.txt/)
  assert.ok(!first.includes('document private content'))
  assert.match(JSON.stringify(f.model.requests[1]), /document.txt/)
  assert.match(JSON.stringify(f.model.requests[2]), /document private content/)
  const operations = f.database.connection.prepare('SELECT state, result_json FROM tool_operations WHERE turn_id = ?').all(accepted.turnId)
  assert.equal(operations.length, 2)
  assert.ok(operations.every(operation => operation.state === 'completed'))
  assert.ok(operations.some(operation => String(operation.result_json).includes('document private content')))
})

test('attachment reader paginates Unicode text and binary without crossing active input ownership', async context => {
  const f = await fixture(context)
  const text = await f.services.blobs.put(Buffer.from('A😀中B'), 'text/plain')
  const binary = await f.services.blobs.put(Buffer.from([0xff, 0x00, 0x81, 0x42]), 'application/octet-stream')
  const refs = await f.services.attachments.snapshot([text, binary].map(info => ({ blobId: info.id, mime: info.mime })))
  f.inputs.enqueue(f.session.id, 'Files', 'files', { attachments: toJson(refs) })
  const input = f.inputs.claim(f.session.id)!
  const tool = attachmentTool(new AttachmentRepository(f.database), f.services.attachments, f.session.id, input.turnId)
  const run = (args: Record<string, unknown>) => tool.execute(args, { callId: 'read', signal: new AbortController().signal })
  assert.deepEqual(await run({ action: 'read', blobId: text.id, limit: 2 }), { blobId: text.id, encoding: 'text', offsetUnit: 'utf16', content: 'A', nextOffset: 1 })
  assert.deepEqual(await run({ action: 'read', blobId: text.id, offset: 1, limit: 1 }), { blobId: text.id, encoding: 'text', offsetUnit: 'utf16', content: '😀', nextOffset: 3 })
  await assert.rejects(run({ action: 'read', blobId: text.id, offset: 2 }), /Unicode/)
  await assert.rejects(run({ action: 'read', blobId: binary.id }), /UTF-8/)
  assert.deepEqual(await run({ action: 'read', blobId: binary.id, encoding: 'base64', offset: 1, limit: 2 }), { blobId: binary.id, encoding: 'base64', offsetUnit: 'bytes', content: 'AIE=', nextOffset: 3 })
  const unrelated = await f.services.blobs.put(Buffer.from('other file'), 'text/plain')
  await assert.rejects(run({ action: 'read', blobId: unrelated.id }), /current input/)
  const other = f.services.repository.create('Other session')
  const foreign = attachmentTool(new AttachmentRepository(f.database), f.services.attachments, other.id, input.turnId)
  await assert.rejects(foreign.execute({ action: 'list' }, { callId: 'foreign', signal: new AbortController().signal }), /active input/)
  f.inputs.finish(input)
  await assert.rejects(run({ action: 'read', blobId: text.id }), /active input/)
})
