import { DatabaseSync } from 'node:sqlite'
import { mkdir, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

type Cell = null | string | number | bigint | Uint8Array
function encode(value: Cell) {
  if (typeof value === 'bigint') return { type: 'integer', value: String(value) }
  if (value instanceof Uint8Array) return { type: 'blob', value: Buffer.from(value).toString('base64') }
  return { type: value === null ? 'null' : typeof value === 'number' ? 'real' : 'text', value }
}
function identifier(value: string): string { return '"' + value.replaceAll('"', '""') + '"' }

/** Export only: never runs legacy DDL or enables imported work. Destination must not exist. */
export async function exportLegacySnapshot(source: string, destination: string, origin: 'mon' | 'local') {
  if (!['mon', 'local'].includes(origin)) throw new Error('Specify the source runtime origin')
  const filename = await realpath(source)
  const target = path.resolve(destination)
  const db = new DatabaseSync(filename, { readOnly: true })
  let transaction = false
  try {
    db.exec('PRAGMA query_only=ON; BEGIN')
    transaction = true
    const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    if (!tables.some(row => row.name === 'session_events') || !tables.some(row => row.name === 'sessions')) throw new Error('Source is not a supported legacy Agent database')
    const columns = db.prepare('PRAGMA table_info(sessions)').all()
    if (!columns.some(row => row.name === 'runtime_origin')) throw new Error('Legacy database lacks world attribution; assign origin with a dedicated conversion first')
    if (db.prepare('SELECT 1 FROM sessions WHERE runtime_origin IS NULL OR runtime_origin!=? LIMIT 1').get(origin)) throw new Error('Source contains sessions from another world; split it before export')
    await mkdir(target, { mode: 0o700 })
    const incomplete = await open(path.join(target, 'INCOMPLETE'), 'wx', 0o600)
    await incomplete.writeFile('Do not import while this marker exists, even if manifest.json exists. This directory contains private legacy data.\n')
    await incomplete.sync(); await incomplete.close()
    const exported = []
    for (const [index, table] of tables.entries()) {
      const name = String(table.name), basename = `${String(index).padStart(3, '0')}.ndjson`
      const statement = db.prepare(`SELECT * FROM ${identifier(name)}`)
      statement.setReadBigInts(true)
      const output = await open(path.join(target, basename), 'wx', 0o600)
      const digest = createHash('sha256')
      let rows = 0, bytes = 0
      try {
        for (const row of statement.iterate()) {
          const line = JSON.stringify(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encode(value)]))) + '\n'
          const encoded = Buffer.from(line)
          if (encoded.length > 32 * 1024 * 1024) throw new Error(`Legacy row exceeds export limit in ${name}`)
          await output.writeFile(encoded)
          digest.update(encoded); bytes += encoded.length; rows++
        }
        await output.sync()
      } finally { await output.close() }
      exported.push({ name, file: basename, schema: String(table.sql ?? ''), rows, bytes, sha256: digest.digest('hex') })
    }
    db.exec('COMMIT'); transaction = false
    const manifest = { format: 'eden.legacy-snapshot.v1', origin, createdAt: new Date().toISOString(), tables: exported,
      note: 'Database values only. Blob files and external resources must be copied and verified separately; this is not an import completion report.' }
    const output = await open(path.join(target, 'manifest.json'), 'wx', 0o600)
    try { await output.writeFile(JSON.stringify(manifest, null, 2) + '\n'); await output.sync() }
    finally { await output.close() }
    const { unlink } = await import('node:fs/promises')
    await unlink(path.join(target, 'INCOMPLETE'))
    return { destination: target, origin, tables: exported.map(({ name, rows, bytes, sha256 }) => ({ name, rows, bytes, sha256 })) }
  } finally {
    if (transaction) db.exec('ROLLBACK')
    db.close()
  }
}
