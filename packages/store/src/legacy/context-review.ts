import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import { legacyContextCheckpoint } from '@eden/runtime-pi'
import { toJson } from '@eden/api'
import { withLegacyRecovery } from './recovery-connection.ts'
import { contextReviewDigest, contextReviewLines, contextReviewTarget } from './context-review-source.ts'
import { conversionReport, writeConversionReport } from './conversion-report.ts'
import type { Stats } from 'fs'
import type { FileHandle } from 'fs/promises'

export async function exportLegacyContextReview(destination: string, origin: 'mon' | 'local', sessionId: string, output: string) {
  return withLegacyRecovery(destination, origin, async db => {
    const file = await open(output, 'wx', 0o600), hash = createHash('sha256')
    let bytes = 0, lines = 0
    try {
      db.exec('BEGIN')
      for (const line of contextReviewLines(db, sessionId)) {
        await file.writeFile(line)
        hash.update(line); bytes += Buffer.byteLength(line); lines++
      }
      await file.sync()
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    finally { await file.close() }
    return {
      format: 'eden.legacy-context-review.v1', sessionId, sourceSha256: hash.digest('hex'), bytes, lines,
      note: 'Review transient and incomplete-turn evidence before writing a summary. A failed export is partial and must not be used.'
    }
  })
}

async function readSummary(filename: string) {
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new Error('Summary must be a regular JSON file of at most 256 KiB')
  const file = await open(filename, 'r')
  let raw: unknown
  try {
    raw = await readSummaryDocument(file, info)
  } finally { await file.close() }
  return parseSummary(raw)
}

async function readSummaryDocument(file: FileHandle, info: Stats) {
  const opened = await file.stat()
  if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error('Summary file changed while opening')
  const buffer = Buffer.alloc(256 * 1024 + 1)
  let length = 0
  while (length < buffer.length) {
    const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
    if (!bytesRead) break
    length += bytesRead
  }
  if (length > 256 * 1024) throw new Error('Summary exceeds 256 KiB')
  const finished = await file.stat()
  if (finished.size !== opened.size || finished.mtimeMs !== opened.mtimeMs || finished.ctimeMs !== opened.ctimeMs || length !== opened.size) throw new Error('Summary file changed while reading')
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)))
  return raw
}

export async function applyLegacyContextSummary(destination: string, origin: 'mon' | 'local', sessionId: string, summaryFile: string) {
  const review = await readSummary(summaryFile)
  if (review.sessionId !== sessionId) throw new Error('Summary session mismatch')
  return withLegacyRecovery(destination, origin, async (db, target) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const state = db.prepare('SELECT state FROM legacy_runtime_contexts WHERE session_id=?').get(sessionId)
      if (state?.state !== 'review_required') throw new Error('Only a context awaiting review may receive an initial summary')
      if (db.prepare('SELECT 1 FROM runtime_checkpoints WHERE session_id=?').get(sessionId) ||
        db.prepare('SELECT 1 FROM actor_checkpoints WHERE session_id=?').get(sessionId)) throw new Error('Existing checkpoints cannot be replaced by offline recovery')
      const source = contextReviewTarget(db, sessionId)
      if (contextReviewDigest(db, sessionId) !== review.sourceSha256) throw new Error('Historical context changed since review; export and review again')
      const now = Date.now(), checkpoint = legacyContextCheckpoint(sessionId, [toJson({
        kind: 'reviewed_historical_summary',
        summary: review.summary, sourceSha256: review.sourceSha256
      })], source.createdAt)
      const serialized = JSON.stringify(checkpoint)
      db.prepare('INSERT INTO legacy_context_reviews VALUES(?,?,?,?,?)').run(sessionId, review.sourceSha256, review.summary, review.note, now)
      db.prepare('INSERT INTO runtime_checkpoints VALUES(?,?,?)').run(sessionId, serialized, now)
      for (const actor of source.actors) db.prepare('INSERT INTO actor_checkpoints VALUES(?,?,?,?)').run(sessionId, actor, serialized, now)
      db.prepare("UPDATE legacy_runtime_contexts SET state='prepared',error=NULL,updated_at=? WHERE session_id=?").run(now, sessionId)
      if (source.child) db.prepare("UPDATE legacy_subagent_context SET state='context_prepared_policy_required' WHERE agent_id=?").run(source.child.agent_id!)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    const report = conversionReport(db, origin, 'context_summary')
    await writeConversionReport(target, report)
    return report
  })
}

function parseSummary(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Summary document is invalid')
  const value = raw as Record<string, unknown>
  if (value.format !== 'eden.legacy-context-summary.v1' || value.acknowledgeReplacement !== true ||
    typeof value.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceSha256) ||
    typeof value.sessionId !== 'string' || typeof value.summary !== 'string' || !value.summary.trim() ||
    Buffer.byteLength(value.summary) > 192 * 1024 || typeof value.note !== 'string' || !value.note.trim() || value.note.length > 4000) {
    throw new Error('Summary requires sessionId, sourceSha256, nonempty summary/note and explicit acknowledgeReplacement')
  }
  return { sessionId: value.sessionId, sourceSha256: value.sourceSha256, summary: value.summary, note: value.note }
}
