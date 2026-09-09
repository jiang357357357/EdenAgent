import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EdenDatabase } from '@eden/store'
import { extractionSource } from './extraction-source.ts'
import { parseMemoryCandidates } from './extraction.ts'
import type { MemoryCandidate } from './extraction.ts'
import { jsonValue } from '@eden/api'

const jobSchema = z.object({
  id: z.uuid(), inputId: z.uuid(), sessionId: z.uuid(), turnId: z.uuid(), actorId: z.string(), scopeKey: z.string().min(1),
  userText: z.string(), assistantText: z.string(), state: z.enum(['queued', 'extracting', 'candidates', 'completed', 'failed', 'interrupted']),
  candidates: z.array(z.unknown()), savedIds: z.array(z.number().int().positive().safe()), error: z.string().nullable(), createdAt: z.number(), updatedAt: z.number(),
})
export type MemoryExtractionJob = z.infer<typeof jobSchema>

function pageBounds(after: string, limit: number): void {
  if (!/^(0|[1-9][0-9]*)$/.test(after) || !Number.isSafeInteger(Number(after)) || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Invalid memory extraction queue bounds')
}

export class MemoryExtractionRepository {
  constructor(private readonly database: EdenDatabase) {}

  schedule(inputId: string, actorId?: string | number): MemoryExtractionJob | undefined {
    return this.database.transaction(() => this.scheduleSource(extractionSource(this.database, inputId, actorId)))
  }

  scheduleInput(inputId: string, owner?: { sessionId: string; turnId: string }): MemoryExtractionJob[] {
    return this.database.transaction(() => {
      const row = this.database.connection.prepare('SELECT metadata_json,session_id,turn_id FROM inputs WHERE id=?').get(inputId)
      if (!row) throw new Error('Memory extraction source input missing')
      if (owner && (row.session_id !== owner.sessionId || row.turn_id !== owner.turnId)) throw new Error('Memory extraction event ownership mismatch')
      const metadata = z.object({ participants: z.array(z.record(z.string(), jsonValue)).default([]) }).parse(JSON.parse(String(row.metadata_json)))
      const actors = metadata.participants.length > 1 ? [...new Set(metadata.participants.map(participant =>
        String(z.union([z.string().min(1), z.number().int().safe()]).parse(participant.assistantId))))] : [undefined]
      return actors.flatMap(actor => {
        const job = this.scheduleSource(extractionSource(this.database, inputId, actor))
        return job ? [job] : []
      })
    })
  }

  private scheduleSource(source: ReturnType<typeof extractionSource>): MemoryExtractionJob | undefined {
    if (!source) return undefined
    const now = Date.now()
    this.database.connection.prepare(`INSERT OR IGNORE INTO memory_extractions
      (id,input_id,session_id,turn_id,actor_id,scope_key,user_text,assistant_text,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'queued',?,?)`)
      .run(randomUUID(), source.inputId, source.sessionId, source.turnId, source.actorId, source.scopeKey, source.userText, source.assistantText, now, now)
    const row = this.database.connection.prepare('SELECT id FROM memory_extractions WHERE input_id=? AND actor_id=?').get(source.inputId, source.actorId)
    return this.read(String(row?.id))
  }

  queued(after = '0', limit = 20): { items: MemoryExtractionJob[]; nextCursor: string | null } {
    pageBounds(after, limit)
    const rows = this.database.connection.prepare(`SELECT memory_extractions.id,memory_extractions.rowid AS cursor FROM memory_extractions
      JOIN sessions ON sessions.id=memory_extractions.session_id WHERE memory_extractions.state='queued' AND sessions.status='active'
      AND memory_extractions.rowid>? ORDER BY memory_extractions.rowid LIMIT ?`).all(Number(after), limit + 1)
    const page = rows.slice(0, limit)
    return { items: page.map(row => this.read(String(row.id))), nextCursor: rows.length > limit ? String(page.at(-1)!.cursor) : null }
  }

  completedInputs(after = '0', limit = 50): { ids: string[]; nextCursor: string | null } {
    pageBounds(after, limit)
    const rows = this.database.connection.prepare(`SELECT inputs.id,inputs.rowid AS cursor FROM inputs
      JOIN sessions ON sessions.id=inputs.session_id JOIN turns ON turns.id=inputs.turn_id
      WHERE inputs.state='completed' AND inputs.kind='prompt' AND turns.state='completed' AND sessions.status='active'
      AND inputs.rowid>? ORDER BY inputs.rowid LIMIT ?`).all(Number(after), limit + 1)
    const page = rows.slice(0, limit)
    return { ids: page.map(row => String(row.id)), nextCursor: rows.length > limit ? String(page.at(-1)!.cursor) : null }
  }

  candidates(sessionId: string, after = '0', limit = 20) {
    z.uuid().parse(sessionId)
    pageBounds(after, limit)
    const rows = this.database.connection.prepare(`SELECT memory_extractions.id,memory_extractions.rowid AS cursor FROM memory_extractions
      JOIN sessions ON sessions.id=memory_extractions.session_id WHERE memory_extractions.session_id=? AND sessions.status='active'
      AND memory_extractions.state='candidates' AND memory_extractions.rowid>? ORDER BY memory_extractions.rowid LIMIT ?`).all(sessionId, Number(after), limit + 1)
    const page = rows.slice(0, limit)
    return { items: page.map(row => this.read(String(row.id))), nextCursor: rows.length > limit ? String(page.at(-1)!.cursor) : null }
  }

  resumable(sessionId: string, id: string): MemoryExtractionJob {
    const job = this.read(id)
    if (job.sessionId !== sessionId) throw new Error('Memory extraction does not belong to this session')
    if (job.state !== 'candidates') throw new Error('Memory extraction has no saved candidates')
    const source = extractionSource(this.database, job.inputId, job.actorId)
    if (!source || source.scopeKey !== job.scopeKey || source.userText !== job.userText || source.assistantText !== job.assistantText)
      throw new Error('Memory extraction source changed')
    return job
  }

  read(id: string): MemoryExtractionJob {
    const row = this.database.connection.prepare('SELECT * FROM memory_extractions WHERE id=?').get(id)
    if (!row) throw new Error('Memory extraction not found')
    return jobSchema.parse({ id: row.id, inputId: row.input_id, sessionId: row.session_id, turnId: row.turn_id, actorId: row.actor_id, scopeKey: row.scope_key,
      userText: row.user_text, assistantText: row.assistant_text, state: row.state, candidates: JSON.parse(String(row.candidates_json)),
      savedIds: JSON.parse(String(row.saved_ids_json)), error: row.error, createdAt: row.created_at, updatedAt: row.updated_at })
  }

  modelSnapshot(id: string) {
    const job = this.read(id)
    const source = extractionSource(this.database, job.inputId, job.actorId)
    if (!source || source.scopeKey !== job.scopeKey || source.userText !== job.userText || source.assistantText !== job.assistantText)
      throw new Error('Memory extraction source changed')
    const row = this.database.connection.prepare('SELECT metadata_json FROM inputs WHERE id=? AND session_id=? AND turn_id=?')
      .get(job.inputId, job.sessionId, job.turnId)
    if (!row) throw new Error('Memory extraction source input missing')
    const metadata = z.object({ participants: z.array(jsonValue), model: jsonValue.optional(),
      companion: z.object({ actors: z.array(z.object({ assistantId: z.string(), model: jsonValue })) }).optional(),
    }).parse(JSON.parse(String(row.metadata_json)))
    const multi = metadata.participants.length > 1
    const actors = metadata.companion?.actors.filter(actor => actor.assistantId === job.actorId) ?? []
    const model = multi ? (actors.length === 1 ? actors[0]!.model : undefined) : metadata.model
    if (!model) throw new Error('Memory extraction source model snapshot missing or ambiguous')
    return { multi, model }
  }

  claim(id: string): MemoryExtractionJob | undefined {
    return this.database.transaction(() => {
      const result = this.database.connection.prepare(`UPDATE memory_extractions SET state='extracting',updated_at=? WHERE id=? AND state='queued'
        AND EXISTS (SELECT 1 FROM sessions WHERE sessions.id=memory_extractions.session_id AND sessions.status='active')`).run(Date.now(), id)
      return result.changes ? this.read(id) : undefined
    })
  }

  saveCandidates(id: string, candidates: readonly MemoryCandidate[]): MemoryExtractionJob {
    const safe = parseMemoryCandidates(JSON.stringify({ memories: candidates }))
    if (safe.length !== candidates.length) throw new Error('Invalid or duplicate memory candidates')
    return this.database.transaction(() => {
      const result = this.database.connection.prepare("UPDATE memory_extractions SET state='candidates',candidates_json=?,updated_at=? WHERE id=? AND state='extracting'")
        .run(JSON.stringify(safe), Date.now(), id)
      if (!result.changes) throw new Error('Memory extraction is not running')
      return this.read(id)
    })
  }

  fail(id: string, reason: string, interrupted = false): void {
    const result = this.database.connection.prepare("UPDATE memory_extractions SET state=?,error=?,updated_at=? WHERE id=? AND state='extracting'")
      .run(interrupted ? 'interrupted' : 'failed', reason.slice(0, 1000), Date.now(), id)
    if (!result.changes) throw new Error('Memory extraction is not running')
  }

  recover(): number {
    return Number(this.database.connection.prepare("UPDATE memory_extractions SET state='interrupted',error='Host stopped during extraction',updated_at=? WHERE state='extracting'")
      .run(Date.now()).changes)
  }
}
