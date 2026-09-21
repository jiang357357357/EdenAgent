import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrations, migrateDatabase } from '../src/migrations.ts'

test('upgrade removes persisted intentions and history without removing memory or diary tables', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const target = migrations.findIndex(sql => sql.includes('DROP TABLE character_intention_entries'))
  assert.ok(target > 0)
  for (let i = 0; i < target; i++) {
    db.exec(migrations[i]!)
    db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(i + 1, 1)
  }
  db.exec(`PRAGMA user_version=${target}`)
  db.prepare(`INSERT INTO character_intentions(account_key,character_id,title,reason,next_step,status,created_at,updated_at)
    VALUES('account','27','旧打算','原因','下一步','waiting',10,20)`).run()
  const retained = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%memor%' OR name LIKE '%diar%') ORDER BY name").all()
  assert.ok(retained.length > 0)
  migrateDatabase(db)
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'character_intention%'").all(), [])
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%memor%' OR name LIKE '%diar%') ORDER BY name").all(), retained)
  migrateDatabase(db)
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, migrations.length)
})
