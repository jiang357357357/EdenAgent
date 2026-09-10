import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { readPackageZip } from '../src/modules/plugin-market/packages/zip.ts'
import { verifyPackageFiles } from '../src/modules/plugin-market/packages/integrity.ts'

function archive(entries: [string, string][], compressed = false) {
  const local: Buffer[] = [], directory: Buffer[] = []
  let offset = 0
  for (const [filename, text] of entries) {
    const name = Buffer.from(filename), content = Buffer.from(text), data = compressed ? deflateRawSync(content) : content
    const header = Buffer.alloc(30), central = Buffer.alloc(46), method = compressed ? 8 : 0
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(method, 8)
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    local.push(header, name, data); directory.push(central, name)
    offset += header.length + name.length + data.length
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, central, end])
}

test('ZIP accepts stored and deflated packages without changing file bytes', () => {
  for (const compressed of [false, true]) {
    const files = readPackageZip(archive([['plugin.json', '{}'], ['nested/file.txt', '中文 content']], compressed))
    assert.equal(files.get('nested/file.txt')?.toString(), '中文 content')
    assert.equal(files.size, 2)
  }
})

test('ZIP rejects traversal, duplicate paths, file-directory collisions and differing local headers', () => {
  for (const entries of [[['../plugin.json', '{}']], [['plugin.json', '{}'], ['plugin.json', '{}']], [['plugin.json', '{}'], ['a', 'file'], ['a/b', 'nested']]] as [string, string][][]) {
    assert.throws(() => readPackageZip(archive(entries)))
  }
  const bytes = archive([['plugin.json', '{}']])
  bytes.writeUInt16LE(8, 8)
  assert.throws(() => readPackageZip(bytes), /local header differs/)
})

test('package checksums bind the complete content set and reject modified bytes', () => {
  const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
  const files = new Map([['plugin.json', Buffer.from('{}')], ['code.js', Buffer.from('export {}')]])
  files.set('checksums.json', Buffer.from(JSON.stringify(Object.fromEntries([...files].map(([name, value]) => [name, digest(value)])))))
  const verified = verifyPackageFiles(files, () => { throw new Error('Unsigned fixture must not request keys') }, true)
  assert.equal(verified.revision.length, 64)
  files.set('code.js', Buffer.from('modified'))
  assert.throws(() => verifyPackageFiles(files, () => '', true), /checksum mismatch/)
  files.set('extra', Buffer.alloc(0))
  assert.throws(() => verifyPackageFiles(files, () => '', true), /file set differs/)
  assert.throws(() => verifyPackageFiles(new Map([['plugin.json', Buffer.from('{}')]]), () => ''), /Signed plugin requires/)
})
