import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DirectoryListing } from '../lan/source-contracts.ts'
import type { Space } from '../lan/contracts.ts'
import { directorySourceFixture } from './directory-source-fixture.ts'

test('only the pinned cloud administrator browses or binds source folders with explicit consent', async context => {
  const f = await directorySourceFixture(context)
  mkdirSync(path.join(f.source, 'docs'))
  const listing = await f.admin.hostRequest<DirectoryListing>(f.hostId, 'POST', 'directories/list', { path: f.source })
  assert.equal(listing.selectable, true)
  assert.equal(listing.entries[0]?.path, path.join(f.source, 'docs'))
  await assert.rejects(f.guest.hostRequest(f.hostId, 'POST', 'directories/list', { path: f.source }), /管理员/)
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'spaces', { name: 'no consent', sourceDirectory: f.source }), /确认/)
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'spaces', { name: 'private', sourceDirectory: path.join(f.root, 'host'), confirmSource: true }), /运行数据/)
  const link = path.join(f.root, 'alias')
  symlinkSync(f.source, link, 'junction')
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'directories/list', { path: link }), /链接/)
  const { space } = await f.create()
  await assert.rejects(f.create(), /重复|交叉|其他资料库/)
  await assert.rejects(f.guest.hostRequest(f.hostId, 'POST', `spaces/${space.id}/source`, { path: f.source, confirmSource: true }), /权限|管理员/)
})

test('a host data directory reached through an alias cannot be exposed using its real path', async context => {
  const f = await directorySourceFixture(context, async (root, _source, host) => {
    const actual = path.join(root, 'private-actual')
    mkdirSync(actual); symlinkSync(actual, host, process.platform === 'win32' ? 'junction' : 'dir')
  })
  const pathOnDisk = path.join(f.root, 'private-actual')
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'directories/list', { path: pathOnDisk }), /运行数据/)
  await assert.rejects(f.admin.hostRequest(f.hostId, 'POST', 'spaces', {
    name: 'private alias', sourceDirectory: pathOnDisk, confirmSource: true,
  }), /运行数据/)
})

test('existing cloud files download and authorized client edits update the real cloud folder', async context => {
  const f = await directorySourceFixture(context)
  const cloudFile = path.join(f.source, 'note.txt'), localFile = path.join(f.local, 'note.txt')
  writeFileSync(cloudFile, 'cloud original')
  const { space } = await f.create()
  assert.equal(space.source.path, f.source)
  await f.client.bind(space.id); await f.client.sync()
  assert.equal(readFileSync(localFile, 'utf8'), 'cloud original')
  writeFileSync(localFile, 'client edit')
  await f.client.sync()
  assert.equal(f.client.status().error, null)
  assert.equal(readFileSync(cloudFile, 'utf8'), 'client edit')
  writeFileSync(cloudFile, 'cloud edit')
  await f.client.sync()
  assert.equal(readFileSync(localFile, 'utf8'), 'cloud edit')
  await f.admin.hostRequest(f.hostId, 'PUT', `spaces/${space.id}/members`, { deviceId: f.guest.network().deviceId, role: 'viewer' })
  const catalog = await f.guest.remote.request<{ spaces: Space[] }>('GET', 'spaces')
  assert.equal(catalog.spaces[0]?.id, space.id)
  assert.equal(catalog.spaces[0]?.source, undefined, 'source paths remain administrator metadata')
  await assert.rejects(f.guest.hostRequest(f.hostId, 'POST', 'directories/list', { path: f.source }), /管理员/)
})

test('cloud folder bindings, versions and later filesystem edits survive host restart', async context => {
  const f = await directorySourceFixture(context)
  writeFileSync(path.join(f.source, 'note.txt'), 'before restart')
  const { space } = await f.create()
  await f.client.bind(space.id); await f.client.sync()
  await f.restart()
  writeFileSync(path.join(f.source, 'note.txt'), 'after restart')
  await f.client.sync()
  assert.equal(f.client.status().error, null)
  assert.equal(readFileSync(path.join(f.local, 'note.txt'), 'utf8'), 'after restart')
  const catalog = await f.admin.remote.request<{ spaces: Space[] }>('GET', 'spaces')
  assert.equal(catalog.spaces.find(item => item.id === space.id)?.source?.path, f.source)
  const versions = await f.client.history(f.client.files()[0]!.fileId)
  assert.equal(versions.versions.length, 2)
})

test('replacing a bound cloud directory stops synchronization and preserves both directories', async context => {
  const f = await directorySourceFixture(context)
  writeFileSync(path.join(f.source, 'note.txt'), 'original cloud')
  const { space } = await f.create()
  await f.client.bind(space.id); await f.client.sync()
  const backup = path.join(f.root, 'original-source')
  renameSync(f.source, backup); mkdirSync(f.source)
  writeFileSync(path.join(f.source, 'note.txt'), 'unselected replacement')
  writeFileSync(path.join(f.local, 'note.txt'), 'pending client edit')
  await f.client.sync()
  assert.ok(f.client.status().error)
  assert.equal(readFileSync(path.join(f.source, 'note.txt'), 'utf8'), 'unselected replacement')
  assert.equal(readFileSync(path.join(backup, 'note.txt'), 'utf8'), 'original cloud')
  const catalog = await f.admin.remote.request<{ spaces: Space[] }>('GET', 'spaces')
  assert.equal(catalog.spaces[0]?.source?.state, 'offline')
  await f.admin.hostRequest(f.hostId, 'PUT', `spaces/${space.id}/members`, { deviceId: f.guest.network().deviceId, role: 'viewer' })
  const members = await f.admin.hostRequest<{ members: { deviceId: string; role: string }[] }>(f.hostId, 'GET', `spaces/${space.id}/members`)
  assert.equal(members.members.find(member => member.deviceId === f.guest.network().deviceId)?.role, 'viewer',
    'administrators can still manage permissions while the source folder is unavailable')
  await f.admin.hostRequest(f.hostId, 'DELETE', `spaces/${space.id}/members`, { deviceId: f.guest.network().deviceId })
})

test('simultaneous cloud and client edits remain conflicts until explicitly resolved', async context => {
  const f = await directorySourceFixture(context)
  writeFileSync(path.join(f.source, 'note.txt'), 'base')
  const { space } = await f.create()
  await f.client.bind(space.id); await f.client.sync()
  writeFileSync(path.join(f.source, 'note.txt'), 'cloud choice')
  writeFileSync(path.join(f.local, 'note.txt'), 'client choice')
  await f.client.sync()
  assert.equal(f.client.status().conflicts, 1)
  assert.equal(readFileSync(path.join(f.local, 'note.txt'), 'utf8'), 'client choice')
  assert.equal(readFileSync(path.join(f.source, 'note.txt'), 'utf8'), 'cloud choice')
  await f.client.resolve(f.client.conflicts()[0]!.id, 'remote')
  assert.equal(readFileSync(path.join(f.local, 'note.txt'), 'utf8'), 'cloud choice')
  assert.equal(f.client.status().conflicts, 0)
})
