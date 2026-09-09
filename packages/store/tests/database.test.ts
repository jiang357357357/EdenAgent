import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { EdenDatabase } from '../src/index.ts'

test('realm binding survives restart and rejects cross-realm opens', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-db-'))
  try {
    const file = path.join(directory, 'test.db')
    new EdenDatabase(file, 'local').close()
    assert.throws(() => new EdenDatabase(file, 'mon'), /origin mismatch/)
    new EdenDatabase(file, 'local').close()
  } finally { rmSync(directory, { recursive: true }) }
})

test('failed transactions do not leak changes', () => {
  const database = new EdenDatabase(':memory:', 'local')
  try {
    assert.throws(() => database.transaction(() => {
      database.connection.prepare('INSERT INTO realm_meta VALUES (?, ?)').run('uncommitted', 'value')
      throw new Error('simulated disk failure')
    }))
    assert.equal(database.connection.prepare("SELECT value FROM realm_meta WHERE key='uncommitted'").get(), undefined)
  } finally { database.close() }
})

test('refuses legacy schema without migrating it', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-legacy-'))
  const file = path.join(directory, 'test.db')
  try {
    const legacy = new DatabaseSync(file)
    legacy.exec('CREATE TABLE old_sessions (id TEXT)')
    legacy.close()
    assert.throws(() => new EdenDatabase(file, 'local'), /explicit import/)
    const check = new DatabaseSync(file)
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 0)
    assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name='realm_meta'").get(), undefined)
    check.close()
  } finally { rmSync(directory, { recursive: true }) }
})
