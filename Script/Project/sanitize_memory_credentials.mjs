import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { credentialValues, redactCredentialJson } from '../../packages/api/src/credential-redaction.ts'
import { isRuntimeProtocolField, isSignedThinking } from '../../packages/api/src/runtime-protocol-fields.ts'
import { mapModelHistoryText } from '../../Server/src/modules/tool-results/index.ts'
import { restoreStreamPayload } from '../../Server/src/modules/sessions/stream-persistence.ts'

const historyColumns = {
  events: ['payload_json'], runtime_checkpoints: ['checkpoint_json'], actor_checkpoints: ['checkpoint_json'],
  inputs: ['text', 'metadata_json'], input_signals: ['text'], tool_operations: ['request_json', 'result_json', 'error_json'],
  permission_requests: ['request_json'], question_requests: ['questions_json', 'answers_json'],
  memory_extractions: ['user_text', 'assistant_text', 'candidates_json', 'error'],
  self_awake_diaries: ['content', 'title'], memories: ['content', 'metadata_json'],
}
const digest = text => createHash('sha256').update(text).digest('hex')
const quote = name => `"${name.replaceAll('"', '""')}"`

/** Maintenance, not a test: requires an account-bound database, exact session, character and version. */
export function sanitizeMemory({ filename, sessionId, characterId, memoryId, expectedUpdatedAt, apply = false }) {
  const db = new DatabaseSync(filename, { readOnly: !apply })
  try {
    db.exec('PRAGMA busy_timeout=3000')
    const account = db.prepare("SELECT value FROM realm_meta WHERE key='account_key'").get()?.value
    const owner = db.prepare('SELECT account_key FROM session_owners WHERE session_id=?').get(sessionId)?.account_key
    if (!account || owner !== account) throw new Error('Requires the matching account-bound database and session')
    const memory = db.prepare('SELECT * FROM memories WHERE id=? AND scope_key=?').get(memoryId, String(characterId))
    if (!memory || Number(memory.updated_at) !== expectedUpdatedAt) throw new Error('Memory ownership or version changed')
    const memoryOwner = db.prepare("SELECT account_key FROM account_records WHERE kind='memory' AND record_id=?").get(memoryId)?.account_key
    if (memoryOwner !== account) throw new Error('Memory belongs to another account')
    const hidden = credentialValues(memory.content)
    if (!hidden.length) throw new Error('Target memory has no detected credential; refusing unrelated edits')
    if (db.prepare("SELECT 1 FROM inputs WHERE state='running' LIMIT 1").get()) throw new Error('An agent turn is running; retry after it finishes')
    const dataVersion = db.prepare('PRAGMA data_version').get().data_version
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name))
    const updates = [], hashes = new Map(), streamRows = expandStreams(db, hidden)
    if (tables.has('request_contents')) for (const row of db.prepare('SELECT hash,content_json FROM request_contents').all()) {
      const content = mask(row.content_json, hidden)
      if (content !== row.content_json) hashes.set(row.hash, { hash: digest(content), content })
    }
    for (const [table, candidates] of Object.entries(historyColumns)) {
      if (!tables.has(table)) continue
      const columns = new Set(db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row => row.name))
      for (const column of candidates.filter(item => columns.has(item))) {
        for (const row of db.prepare(`SELECT rowid AS maintenance_rowid,${quote(column)} AS value FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`).all()) {
          const masked = table === 'events' ? streamRows.get(row.maintenance_rowid) ?? mask(row.value, hidden) : mask(row.value, hidden)
          const value = column === 'payload_json' ? rehash(masked, hashes) : masked
          if (value !== row.value) updates.push({ table, column, rowid: row.maintenance_rowid, value })
        }
      }
    }
    if (apply) {
      db.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE')
      try {
        if (db.prepare('PRAGMA data_version').get().data_version !== dataVersion) throw new Error('Database changed during preparation; retry cleanup')
        if (db.prepare('SELECT updated_at FROM memories WHERE id=?').get(memoryId)?.updated_at !== expectedUpdatedAt
          || db.prepare("SELECT 1 FROM inputs WHERE state='running' LIMIT 1").get()) throw new Error('Runtime state changed before cleanup')
        // Recheck rows, so approval/history generated concurrently cannot be overwritten silently.
        for (const update of updates) {
          const row = db.prepare(`SELECT ${quote(update.column)} AS value FROM ${quote(update.table)} WHERE rowid=?`).get(update.rowid)
          if (update.table === 'events') update.value = rehash(streamRows.get(update.rowid) ?? mask(row.value, hidden), hashes)
          else update.value = mask(row.value, hidden)
          db.prepare(`UPDATE ${quote(update.table)} SET ${quote(update.column)}=? WHERE rowid=?`).run(update.value, update.rowid)
        }
        for (const [old, entry] of hashes) {
          db.prepare('INSERT OR IGNORE INTO request_contents(hash,content_json) VALUES(?,?)').run(entry.hash, entry.content)
          db.prepare('DELETE FROM request_contents WHERE hash=?').run(old)
        }
        db.prepare('UPDATE memories SET content=?,updated_at=? WHERE id=?').run('sudo 密码由老师保管，智能体不保存凭据；需要授权时通过系统安全方式提供。', Math.max(Date.now(), expectedUpdatedAt + 1), memoryId)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    }
    return { applied: apply, memoryId, characterId: String(characterId), maskedRows: updates.length, requestContents: hashes.size,
      changedTables: [...new Set(updates.map(update => update.table))], credentialPrinted: false }
  } finally { db.close() }
}

function mask(value, known) {
  if (typeof value !== 'string') return value
  return redactCredentialJson(value, known, false, mapModelHistoryText)
}
function expandStreams(db, hidden) {
  const cache = new Map(), groups = new Map(), affected = new Set(), result = new Map()
  for (const row of db.prepare('SELECT rowid AS maintenance_rowid,session_id,seq,payload_json FROM events ORDER BY session_id,seq').all()) {
    const raw = JSON.parse(row.payload_json), key = `${row.session_id}:${row.seq}`
    const value = restoreStreamPayload(raw, seq => cache.get(`${row.session_id}:${seq}`))
    cache.set(key, value)
    if (!raw.messageStorage) continue
    const group = `${row.session_id}:${raw.messageId}`, rows = groups.get(group) ?? []
    rows.push({ rowid: row.maintenance_rowid, value }); groups.set(group, rows)
    if (mask(JSON.stringify(value), hidden) !== JSON.stringify(value)) affected.add(group)
  }
  for (const group of affected) for (const row of groups.get(group)) {
    const value = maskStream(row.value, hidden)
    // A credential can span multiple token deltas; the full restored message is authoritative.
    if (typeof value.assistantMessageEvent?.delta === 'string') value.assistantMessageEvent.delta = '[已隐藏含凭据消息的流式片段]'
    result.set(row.rowid, JSON.stringify(value))
  }
  return result
}
function maskStream(value, hidden) {
  const masked = redactCredentialJson(value, hidden, true, mapModelHistoryText)
  const fragment = item => {
    for (const secret of hidden) for (let length = secret.length - 1; length >= 2; length--) {
      const prefix = secret.slice(0, length)
      if (item.endsWith(prefix)) return item.slice(0, -length) + '[已隐藏凭据片段]'
    }
    return item
  }
  const visit = item => {
    if (typeof item === 'string') return mapModelHistoryText(item, visit, fragment)
    if (Array.isArray(item)) return item.map(visit)
    if (item && typeof item === 'object') {
      if (isSignedThinking(item)) return item
      return Object.fromEntries(Object.entries(item).map(([key, child]) =>
        [key, isRuntimeProtocolField(key, item) || /^(?:id|.*Id|.*ID|name|type|role|format|runtimeVersion|revision|sha256|parentId)$/.test(key) ? child : visit(child)]))
    }
    return item
  }
  return visit(masked)
}
function rehash(text, hashes) {
  const value = JSON.parse(text)
  let changed = false
  const visit = item => {
    if (!item || typeof item !== 'object') return
    if (item.requestStorage?.format === 'eden.request.content.v1') for (const ref of item.requestStorage.references) {
      const replacement = hashes.get(ref.hash)
      if (replacement) { ref.hash = replacement.hash; changed = true }
    }
    Object.values(item).forEach(visit)
  }
  visit(value)
  return changed ? JSON.stringify(value) : text
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [filename, sessionId, characterId, memoryId, updatedAt, mode] = process.argv.slice(2)
  console.log(JSON.stringify(sanitizeMemory({ filename, sessionId, characterId, memoryId: Number(memoryId), expectedUpdatedAt: Number(updatedAt), apply: mode === '--apply' }), null, 2))
}
