import { createHash } from 'node:crypto'
import { z } from 'zod'
import { attachmentRefsSchema, attachmentSnapshotsSchema, jsonValue } from '@eden/api'
import type { AcceptedInput } from '../contracts.ts'
import type { SessionRepository } from '../session-repository.ts'
const legacySchema = z.object({ text: z.string().optional(), attachments: attachmentRefsSchema.default([]),
  environment: jsonValue.optional(), compact: z.boolean().optional() }).strict()

export class InputResubmissionRepository {
  constructor(private readonly sessions: SessionRepository) {}
  existing(sessionId: string, sourceId: string, fingerprint: string, note: string): AcceptedInput | undefined {
    this.sessions.read(sessionId)
    const row = this.sessions.database.connection.prepare(`SELECT r.fingerprint,r.note,i.id,i.turn_id,i.state FROM input_resubmissions r
      JOIN inputs s ON s.id=r.source_id JOIN inputs i ON i.id=r.input_id WHERE r.source_id=? AND s.session_id=?`).get(sourceId, sessionId)
    if (!row) return undefined
    if (row.fingerprint !== fingerprint || row.note !== note) throw new Error('Source input was already resubmitted with different evidence')
    return { sessionId, inputId: String(row.id), turnId: String(row.turn_id), state: String(row.state) }
  }
  source(sessionId: string, sourceId: string) {
    this.sessions.read(sessionId)
    const db = this.sessions.database.connection
    const row = db.prepare("SELECT * FROM inputs WHERE id=? AND session_id=? AND state='cancelled'").get(sourceId, sessionId)
    if (!row) throw new Error('Explicitly stop the original input before resubmitting it')
    if (db.prepare('SELECT 1 FROM subagent_threads WHERE child_session_id=?').get(sessionId) || db.prepare('SELECT 1 FROM jobs WHERE input_id=?').get(sourceId)) throw new Error('Use the owning task or job workflow to continue this input')
    const metadata = z.record(z.string(), jsonValue).parse(JSON.parse(String(row.metadata_json)))
    if (metadata.job) throw new Error('Job inputs require their owning workflow')
    const legacy = metadata.legacyInput === undefined ? undefined : legacySchema.parse(metadata.legacyInput)
    const snapshots = legacy ? [] : attachmentSnapshotsSchema.parse(metadata.attachments ?? [])
    const attachments = legacy?.attachments ?? snapshots.map(({ blobId, mime, filename }) => ({ blobId, mime, ...(filename ? { filename } : {}) }))
    const text = z.string().max(1000000).parse(row.text)
    const kind = z.enum(['prompt', 'compact']).parse(row.kind)
    if (kind === 'compact' && attachments.length) throw new Error('Compaction resubmission cannot silently discard attachments')
    if (kind === 'prompt' && !text.trim() && !attachments.length) throw new Error('Original input has no prompt or attachments')
    return { fingerprint: createHash('sha256').update(JSON.stringify(row)).digest('hex'), text, kind, attachments, snapshots,
      environment: legacy ? legacy.environment : metadata.environment }
  }
  record(sessionId: string, sourceId: string, fingerprint: string, note: string, accepted: AcceptedInput) {
    if (!this.sessions.database.inTransaction) throw new Error('Input resubmission must commit with its accepted input')
    if (this.source(sessionId, sourceId).fingerprint !== fingerprint) throw new Error('Source input changed during resubmission')
    this.sessions.database.connection.prepare('INSERT INTO input_resubmissions VALUES(?,?,?,?,?)').run(sourceId, accepted.inputId, fingerprint, note, Date.now())
  }
}
