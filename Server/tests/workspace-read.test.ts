import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { WorkspaceService } from '../src/modules/workspace/index.ts'

test('selected workspace persists, bounds reads, skips links, and limits binary and large files', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-workspace-'))
  const root = path.join(directory, 'project')
  const privateRoot = path.join(directory, 'private')
  mkdirSync(root); mkdirSync(privateRoot)
  const database = new EdenDatabase(':memory:', 'local')
  let workspace = new WorkspaceService(database, [privateRoot])
  try {
    assert.equal(workspace.info().path, '')
    await assert.rejects(workspace.read('README.md'), /Select/)
    assert.throws(() => workspace.switch(directory), /private/)
    writeFileSync(path.join(root, 'README.md'), '你好，老师。')
    writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]))
    writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(1024 * 1024 + 10))
    writeFileSync(path.join(privateRoot, 'secret'), 'private')
    workspace.switch(root)
    workspace = new WorkspaceService(database, [privateRoot])
    assert.equal((await workspace.read('README.md')).content, '你好，老师。')
    assert.equal((await workspace.read('binary.bin')).binary, true)
    assert.equal((await workspace.read('large.txt')).truncated, true)
    await assert.rejects(workspace.read('../private/secret'), /escapes/)
    if (process.platform !== 'win32') {
      symlinkSync(privateRoot, path.join(root, 'escape'))
      await assert.rejects(workspace.read('escape/secret'), /escapes/)
      assert.ok(!(await workspace.list('')).entries.some(entry => entry.name === 'escape'))
    }
    await assert.rejects(workspace.read(''), /regular file/)
  } finally { database.close(); rmSync(directory, { recursive: true }) }
})
