import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { configuredModelSchema, toJson, jsonValue } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { publicHistoryCheckpoint } from '@eden/runtime-pi'
import type { RuntimeModel } from '@eden/runtime-pi'
import { modelDescriptor, conversationWindow } from '../sessions/index.ts'
import type { SessionRepository } from '../sessions/index.ts'
import { HandoffRepository } from './handoff-repository.ts'
import type { ModelBindingRepository, ModelBindingSnapshot } from '../models/index.ts'

export class HandoffCommitRepository {
  constructor(private readonly sessions: SessionRepository, private readonly handoffs: HandoffRepository, private readonly bindings?: ModelBindingRepository) {}

  // Caller installs the prepared in-memory binding before publishing these committed events.
  commit(id: string, preparedModel: RuntimeModel, internalPrompt: string, snapshot?: ModelBindingSnapshot) {
    const model = modelDescriptor(configuredModelSchema.parse(preparedModel))
    if (this.bindings && (!snapshot || snapshot.mode !== 'single' || !snapshot.main ||
      !isDeepStrictEqual(configuredModelSchema.parse(snapshot.main.model), configuredModelSchema.parse(preparedModel))))
      throw new Error('Handoff binding must match the prepared model')
    if (!internalPrompt.trim() || internalPrompt.length > 10000) throw new Error('Invalid assistant handoff instruction')
    return this.sessions.database.transaction(() => {
      const job = this.handoffs.read(id)
      const session = this.sessions.read(job.sessionId)
      const db = this.sessions.database.connection
      if (job.state !== 'claimed' || session.status !== 'active') throw new Error('Assistant handoff is not claimed for an active session')
      if (db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state='running'").get(session.id)) throw new Error('Assistant handoff requires an idle turn boundary')
      const source = db.prepare("SELECT 1 FROM turns WHERE id=? AND session_id=? AND state='completed'").get(job.sourceTurnId, session.id)
      if (!source) throw new Error('Assistant handoff source turn did not complete')
      const participants = [toJson(job.participant)]
      const events = [this.sessions.events.insert(session.id, null, 'session.metadata.updated', { participants, environment: session.environment }),
        this.sessions.events.insert(session.id, null, 'session.participants_updated', { participants, modelBindingsReset: true, assistantHandoff: true }),
        this.sessions.events.insert(session.id, null, 'model.bound', { model, assistantId: job.participant.assistantId, assistantHandoff: true })]
      if (this.bindings) this.bindings.saveInTransaction(session.id, snapshot!)
      if (session.participants.length > 1) {
        const history = conversationWindow(this.sessions.events.messages(session.id, undefined, 100).items.map(event => event.payload))
        const checkpoint = publicHistoryCheckpoint(session.id, history, this.sessions.checkpoint(session.id))
        db.prepare(`INSERT INTO runtime_checkpoints VALUES (?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET checkpoint_json=excluded.checkpoint_json, updated_at=excluded.updated_at`)
          .run(session.id, JSON.stringify(checkpoint), Date.now())
        events.push(this.sessions.events.insert(session.id, null, 'runtime.checkpoint.rebased', { reason: 'assistant.handoff', jobId: id, publicMessages: history.length }))
      }
      const queued = db.prepare("SELECT id, metadata_json FROM inputs WHERE session_id=? AND state='queued' ORDER BY created_at, rowid").all(session.id)
      for (const row of queued) {
        const metadata = jsonValue.parse(JSON.parse(String(row.metadata_json)))
        const old = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
        const { companion: _companion, ...remaining } = old
        const next = { ...remaining, participants, model, handoffJobId: id }
        db.prepare('UPDATE inputs SET metadata_json=? WHERE id=?').run(JSON.stringify(next), row.id!)
        events.push(this.sessions.events.insert(session.id, null, 'input.handoff.updated', { inputId: String(row.id), jobId: id, metadata: next }))
      }
      let inputId: string | undefined
      if (!queued.length) {
        inputId = randomUUID()
        const turnId = randomUUID()
        const metadata: JsonValue = { participants, environment: session.environment, model, internalHandoff: true, handoffJobId: id }
        db.prepare('INSERT INTO inputs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(inputId, session.id, turnId, `assistant-handoff:${id}`, internalPrompt, 'queued', Date.now(), JSON.stringify(metadata), 'prompt')
        events.push(this.sessions.events.insert(session.id, turnId, 'input.queued', { inputId, text: internalPrompt, kind: 'prompt', metadata }))
      }
      db.prepare("UPDATE assistant_handoffs SET state='completed', updated_at=? WHERE id=?").run(Date.now(), id)
      db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(Date.now(), session.id)
      events.push(this.sessions.events.insert(session.id, null, 'session.assistant_handoff.completed', toJson({ jobId: id,
        assistantId: job.participant.assistantId, participant: job.participant, historyPreserved: true,
        targetRunQueued: !queued.length, queuedInputResumed: Boolean(queued.length) })))
      return { sessionId: session.id, events, inputId: inputId ?? String(queued[0]!.id) }
    })
  }
}
