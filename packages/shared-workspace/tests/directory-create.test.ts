import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { directorySourceFixture } from './directory-source-fixture.ts'

test('a cloud administrator creates a real folder without creating a library or overwriting existing content', async t => {
  const f = await directorySourceFixture(t)
  const result = await f.admin.hostRequest<{ path: string }>(f.hostId, 'POST', 'directories/create', { parent: f.source, name: '共享文档' })
  assert.equal(result.path, path.join(f.source, '共享文档'))
  assert.equal(statSync(result.path).isDirectory(), true)
  assert.equal((await f.admin.hosts()).hosts.find(host => host.deviceId === f.hostId)?.directoryCreate, true)
  const catalog = await f.admin.hostRequest<{ spaces: unknown[] }>(f.hostId, 'GET', 'spaces')
  assert.deepEqual(catalog.spaces, [], 'creating a folder never publishes it or creates a library')
  writeFileSync(path.join(result.path, 'proof.txt'), 'preserve this file')
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'directories/create', { parent: f.source, name: '共享文档' }), /同名/)
  assert.equal(readFileSync(path.join(result.path, 'proof.txt'), 'utf8'), 'preserve this file')
  writeFileSync(path.join(f.source, 'file-name'), 'existing file')
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'directories/create', { parent: f.source, name: 'file-name' }), /同名/)
})

test('directory creation rejects non-administrators, unsafe names, links and private state before writing', async t => {
  const f = await directorySourceFixture(t)
  await assert.rejects(f.guest.hostRequest(f.hostId, 'POST', 'directories/create', { parent: f.source, name: 'not-authorized' }), /管理员/)
  for (const name of ['../escape', 'nested/child', 'nested\\child', '..', 'CON', 'bad:name', '界'.repeat(100)]) {
    await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'directories/create', { parent: f.source, name }), /名称/)
  }
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'directories/create', { parent: path.join(f.root, 'host'), name: 'private' }), /运行数据/)
  const link = path.join(f.root, 'source-link')
  symlinkSync(f.source, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'directories/create', { parent: link, name: 'through-link' }), /符号链接/)
  assert.deepEqual(readdirSync(f.source), [])
  assert.equal(existsSync(path.join(f.root, 'escape')), false)
})

test('a new folder may be created next to host state but not inside a directory already shared by another library', async t => {
  const f = await directorySourceFixture(t)
  const sibling = await f.admin.hostRequest<{ path: string }>(f.hostId, 'POST', 'directories/create', { parent: f.root, name: 'new-library-folder' })
  assert.equal(statSync(sibling.path).isDirectory(), true, 'a parent of private state may contain independent source siblings')
  await f.create()
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'directories/create', { parent: f.source, name: 'nested-library' }), /交叉绑定/)
  assert.equal(existsSync(path.join(f.source, 'nested-library')), false)
})
