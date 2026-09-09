import { isDeepStrictEqual } from 'node:util'
import type { EdenDatabase } from '@eden/store'
import { extractionApproval } from './extraction-approval.ts'
import { MemoryExtractionRepository } from './extraction-repository.ts'
import type { MemoryExtractionJob } from './extraction-repository.ts'
import { extractionSource } from './extraction-source.ts'
import type { MemoryCandidate } from './extraction.ts'

export class MemoryExtractionCommitRepository {
  private readonly jobs: MemoryExtractionRepository
  constructor(private readonly database: EdenDatabase) { this.jobs = new MemoryExtractionRepository(database) }

  commit(id: string, approvalId?: string): number[] {
    return this.database.transaction(() => {
      const job = this.jobs.read(id)
      if (job.state === 'completed') return job.savedIds
      if (job.state !== 'candidates') throw new Error('Memory extraction has no saved candidates')
      const source = extractionSource(this.database, job.inputId, job.actorId)
      if (!source || source.scopeKey !== job.scopeKey || source.sessionId !== job.sessionId || source.turnId !== job.turnId ||
        source.userText !== job.userText || source.assistantText !== job.assistantText) throw new Error('Memory extraction source changed')
      const approval = extractionApproval(job)
      if (approval.details.candidates.length) this.validateApproval(job, approvalId, approval)
      const savedIds = approval.details.candidates.map(candidate => this.save(job, candidate, approvalId!))
      this.database.connection.prepare("UPDATE memory_extractions SET state='completed',saved_ids_json=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(savedIds), Date.now(), id)
      return savedIds
    })
  }

  private validateApproval(job: MemoryExtractionJob, id: string | undefined, expected: ReturnType<typeof extractionApproval>): void {
    const row = this.database.connection.prepare('SELECT * FROM permission_requests WHERE id=?').get(id ?? '')
    if (!row || row.state !== 'allowed' || row.session_id !== job.sessionId || row.turn_id !== job.turnId ||
      row.capability !== expected.capability || row.resource !== expected.resource ||
      !isDeepStrictEqual(JSON.parse(String(row.request_json)), expected.details)) throw new Error('Memory extraction requires matching approval')
  }

  private save(job: MemoryExtractionJob, candidate: MemoryCandidate, approvalId: string): number {
    // SQLite lower preserves the legacy ASCII-insensitive exact-content deduplication policy.
    const existing = this.database.connection.prepare(`SELECT id FROM memories WHERE scope_type='agent_character'
      AND scope_key=? AND lower(content)=lower(?) ORDER BY id LIMIT 1`).get(job.scopeKey, candidate.content)
    if (existing) return Number(existing.id)
    const metadata = { source: 'automatic_extraction', sourceInputId: job.inputId, sourceAssistantId: job.actorId,
      confidence: candidate.confidence, extractionJobId: job.id, approvalId }
    const now = Date.now()
    const result = this.database.connection.prepare(`INSERT INTO memories
      (content,kind,scope_type,scope_key,source_session_id,metadata_json,created_at,updated_at) VALUES (?,?,'agent_character',?,?,?,?,?)`)
      .run(candidate.content, candidate.kind, job.scopeKey, job.sessionId, JSON.stringify(metadata), now, now)
    return Number(result.lastInsertRowid)
  }
}
