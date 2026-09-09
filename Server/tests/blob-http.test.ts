import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { blobInfoSchema } from '@eden/api'
import { loadConfig } from '../src/bootstrap/config.ts'
import { startServer } from '../src/bootstrap/container.ts'

async function fixture(context: test.TestContext, max = 1024, origin: 'mon' | 'local' = 'local') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-blob-http-'))
  const config = loadConfig({ EDEN_AGENT_V2_DATA_ROOT: root, EDEN_AGENT_PORT: '0', EDEN_AGENT_MAX_BLOB_BYTES: String(max), EDEN_AGENT_RUNTIME_ORIGIN: origin })
  let server = await startServer(config)
  context.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }) })
  return {
    root, config, get server() { return server },
    get url() { return `http://127.0.0.1:${server.port}/blobs` },
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'text/plain' },
    async restart() { await server.close(); server = await startServer(config) },
  }
}

test('production blob HTTP upload, deduplication and authenticated read survive restart', async context => {
  const f = await fixture(context)
  const uploaded = await fetch(f.url, { method: 'POST', headers: f.headers, body: 'persistent attachment' })
  assert.equal(uploaded.status, 200)
  const info = blobInfoSchema.parse(await uploaded.json())
  assert.equal(info.byteLength, 21)
  const duplicate = await fetch(f.url, { method: 'POST', headers: { ...f.headers, 'content-type': 'application/octet-stream' }, body: 'persistent attachment' })
  assert.deepEqual(await duplicate.json(), info)
  await f.restart()
  const read = await fetch(`${f.url}/${info.id}`, { headers: f.headers })
  assert.equal(read.status, 200)
  assert.equal(read.headers.get('content-type'), 'text/plain')
  assert.equal(read.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(read.headers.get('content-disposition'), 'attachment')
  assert.equal(await read.text(), 'persistent attachment')
})

test('blob HTTP rejects missing and foreign tokens, hostile origins and query tokens', async context => {
  const f = await fixture(context)
  for (const headers of [{}, { authorization: `Bearer ${'x'.repeat(43)}` }]) {
    assert.equal((await fetch(f.url, { method: 'POST', headers, body: 'private' })).status, 401)
  }
  assert.equal((await fetch(f.url, { method: 'POST', headers: { ...f.headers, origin: 'https://hostile.invalid' }, body: 'private' })).status, 403)
  assert.equal((await fetch(`${f.url}?token=${f.config.token}`, { method: 'POST', body: 'private' })).status, 404)
  await assert.rejects(readdir(path.join(f.root, 'blobs')), { code: 'ENOENT' })
  const uploaded = await fetch(f.url, { method: 'POST', headers: f.headers, body: 'realm-private' })
  const info = blobInfoSchema.parse(await uploaded.json())
  assert.equal((await fetch(`${f.url}/${info.id}`)).status, 401)
  const other = await fixture(context, 1024, 'mon')
  assert.equal((await fetch(`${other.url}/${info.id}`, { headers: f.headers })).status, 401)
  assert.equal((await fetch(`${other.url}/${info.id}`, { headers: other.headers })).status, 404)
})

test('blob CORS allows the configured frontend and preflight never authorizes the upload', async context => {
  const f = await fixture(context)
  const origin = 'http://127.0.0.1:40091'
  const preflight = await fetch(f.url, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Authorization, Content-Type' } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
  assert.equal((await fetch(f.url, { method: 'POST', headers: { origin }, body: 'no token' })).status, 401)
  const upload = await fetch(f.url, { method: 'POST', headers: { ...f.headers, origin }, body: 'allowed' })
  assert.equal(upload.status, 200)
  assert.equal(upload.headers.get('access-control-allow-origin'), origin)
  const denied = await fetch(f.url, { method: 'OPTIONS', headers: { origin: 'https://hostile.invalid', 'access-control-request-method': 'POST' } })
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
})

test('blob HTTP rejects declared and chunked oversize bodies before storage', async context => {
  const f = await fixture(context, 4)
  assert.equal((await fetch(f.url, { method: 'POST', headers: f.headers, body: '12345' })).status, 413)
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(f.url, { method: 'POST', headers: { ...f.headers, 'transfer-encoding': 'chunked' } }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.write('123')
    request.end('45')
  })
  assert.equal(status, 413)
  assert.equal((await fetch(f.url, { method: 'POST', headers: { ...f.headers, 'content-encoding': 'gzip' }, body: 'a' })).status, 415)
  await assert.rejects(readdir(path.join(f.root, 'blobs')), { code: 'ENOENT' })
})

test('server shutdown interrupts unfinished uploads and releases the realm lock', async context => {
  const f = await fixture(context)
  const request = httpRequest(f.url, { method: 'POST', headers: { ...f.headers, 'content-length': '100' } })
  request.on('error', () => {})
  const closed = new Promise<void>(resolve => request.once('close', resolve))
  await new Promise<void>((resolve, reject) => request.write('unfinished', error => error ? reject(error) : resolve()))
  assert.equal((await fetch(f.url.replace('/blobs', '/healthz'))).status, 200)
  await f.server.close()
  request.destroy()
  await closed
  await f.restart()
  assert.equal((await fetch(f.url, { method: 'POST', headers: f.headers, body: 'after restart' })).status, 200)
})

test('blob HTTP integrity failures reveal neither file content nor storage paths', async context => {
  const f = await fixture(context)
  const upload = await fetch(f.url, { method: 'POST', headers: f.headers, body: 'original' })
  const info = blobInfoSchema.parse(await upload.json())
  await writeFile(path.join(f.root, 'blobs', info.sha256.slice(0, 2), info.sha256), 'secret corrupted content')
  const read = await fetch(`${f.url}/${info.id}`, { headers: f.headers })
  assert.equal(read.status, 500)
  assert.deepEqual(await read.json(), { error: 'Blob operation failed' })
})

test('eight acknowledged slow uploads cap concurrency and shutdown drains every request', async context => {
  const f = await fixture(context)
  const uploads = []
  for (let index = 0; index < 8; index++) {
    const request = httpRequest(f.url, { method: 'POST', headers: { ...f.headers, expect: '100-continue', 'content-length': '100' } })
    request.on('error', () => {})
    context.after(() => request.destroy())
    const closed = new Promise<void>(resolve => request.once('close', resolve))
    await new Promise<void>((resolve, reject) => {
      request.once('continue', resolve).once('error', reject)
      request.flushHeaders()
    })
    uploads.push(closed)
  }
  assert.equal((await fetch(f.url, { method: 'POST', headers: f.headers, body: 'busy' })).status, 503)
  await f.server.close()
  await Promise.all(uploads)
  await assert.rejects(readdir(path.join(f.root, 'blobs')), { code: 'ENOENT' })
})
