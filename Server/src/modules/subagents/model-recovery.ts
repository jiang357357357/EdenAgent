import { createHash } from 'node:crypto'
import { subagentRoleInfoSchema, runtimeOriginSchema } from '@eden/api'
import type { SubagentModelRecoveryPlan } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { ModelService } from '../models/index.ts'
import { SessionRepository } from '../sessions/index.ts'
import { assertSubagentWorkspace } from './workspace-owner.ts'

export class SubagentModelRecovery {
  constructor(private readonly database: EdenDatabase, private readonly models: ModelService) { }
  sources(agentId: string) {
    const db = this.database.connection
    const thread = db.prepare('SELECT parent_session_id,parent_actor_id FROM subagent_threads WHERE id=?').get(agentId)
    if (!thread) throw new Error('Subagent not found')
    return { parentSessionId: String(thread.parent_session_id), actorId: thread.parent_actor_id == null ? null : String(thread.parent_actor_id) }
  }
  private candidate(agentId: string, selectedActorId?: string | number) {
    const db = this.database.connection
    const thread = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(agentId)
    const historical = db.prepare('SELECT state FROM legacy_subagent_context WHERE agent_id=?').get(agentId)
    if (!thread || !['policy_prepared_model_required', 'model_prepared_reopen_required'].includes(String(historical?.state))) throw new Error('Restore the historical task policy before confirming its model')
    if (['queued', 'running'].includes(String(thread.state)) || db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state='running' LIMIT 1").get(thread.child_session_id!)) throw new Error('Stop the child task before confirming its model')
    assertSubagentWorkspace(this.database, String(thread.child_session_id))
    const role = db.prepare('SELECT definition_json FROM subagent_role_snapshots WHERE agent_id=?').get(agentId)
    if (!role) throw new Error('Task has no restored role snapshot')
    const definition = subagentRoleInfoSchema.parse(JSON.parse(String(role.definition_json)))
    const parentSessionId = String(thread.parent_session_id)
    const actorId = selectedActorId === undefined ? thread.parent_actor_id == null ? null : String(thread.parent_actor_id) : String(selectedActorId)
    if (actorId !== null) {
      const origin = runtimeOriginSchema.parse(db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value)
      const sessions = new SessionRepository(this.database, origin)
      const matches = (participants: ReturnType<SessionRepository['read']>['participants']) => participants.filter(value =>
        value && typeof value === 'object' && !Array.isArray(value) && String(value.assistantId) === actorId)
      if (matches(sessions.read(parentSessionId).participants).length !== 1) throw new Error('Selected model source is not a unique current parent participant')
      const child = sessions.read(String(thread.child_session_id))
      if (child.participants.length !== 1 || matches(child.participants).length !== 1) throw new Error('Restore the child participant context for this actor before selecting its model source')
    }
    const snapshot = this.models.childSnapshot(parentSessionId, { model: definition.model, reasoning: definition.reasoning, ...(actorId === null ? {} : { actorId }) })
    const fingerprint = createHash('sha256').update(JSON.stringify({ agentId, parentSessionId, actorId, workspaceRoot: thread.workspace_root, snapshot, definition })).digest('hex')
    const model = snapshot.origin === 'local' ? snapshot.model : snapshot.binding.main.model
    const plan: SubagentModelRecoveryPlan = {
      agentId, parentSessionId, actorId, origin: snapshot.origin, fingerprint,
      provider: model.provider, modelId: model.id, baseUrl: model.baseUrl, reasoning: model.reasoning ?? 'off',
      contextWindow: model.contextWindow, maxTokens: model.maxTokens
    }
    return { snapshot, plan }
  }
  preview(agentId: string, actorId?: string | number) { return this.candidate(agentId, actorId).plan }
  activateInTransaction(agentId: string, childSessionId: string) {
    if (!this.database.inTransaction) throw new Error('Recovered model activation requires an owning transaction')
    const saved = this.database.connection.prepare('SELECT fingerprint,snapshot_json FROM subagent_model_restorations WHERE agent_id=?').get(agentId)
    const current = this.candidate(agentId)
    if (!saved || saved.fingerprint !== current.plan.fingerprint || saved.snapshot_json !== JSON.stringify(current.snapshot)) throw new Error('Confirmed model is stale; confirm the current parent binding before reopening')
    this.models.activateChildSnapshotInTransaction(childSessionId, current.snapshot)
  }
  apply(agentId: string, fingerprint: string, note: string, actorId?: string | number) {
    this.database.transaction(() => {
      const db = this.database.connection
      const previous = db.prepare('SELECT * FROM subagent_model_restorations WHERE agent_id=?').get(agentId)
      if (previous?.fingerprint === fingerprint) {
        const source = db.prepare('SELECT actor_id FROM subagent_model_source_reviews WHERE agent_id=? AND fingerprint=?').get(agentId, fingerprint)
        if (actorId !== undefined && source?.actor_id !== String(actorId)) throw new Error('Model recovery already recorded a different actor source')
        if (previous.note !== note) throw new Error('Model recovery was already recorded with different evidence')
        return
      }
      const candidate = this.candidate(agentId, actorId)
      if (candidate.plan.fingerprint !== fingerprint) throw new Error('Parent model or task configuration changed; preview again')
      if (previous) db.prepare(`INSERT INTO subagent_model_restoration_history(agent_id,fingerprint,snapshot_json,note,created_at,replaced_at)
        VALUES(?,?,?,?,?,?)`).run(agentId, previous.fingerprint!, previous.snapshot_json!, previous.note!, previous.created_at!, Date.now())
      db.prepare(`INSERT INTO subagent_model_restorations VALUES(?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET
        fingerprint=excluded.fingerprint,snapshot_json=excluded.snapshot_json,note=excluded.note,created_at=excluded.created_at`)
        .run(agentId, fingerprint, JSON.stringify(candidate.snapshot), note, Date.now())
      db.prepare('INSERT OR IGNORE INTO subagent_model_source_reviews VALUES(?,?,?,?,?)').run(agentId, fingerprint, candidate.plan.actorId, note, Date.now())
      db.prepare('UPDATE subagent_threads SET parent_actor_id=? WHERE id=?').run(candidate.plan.actorId, agentId)
      db.prepare("UPDATE legacy_subagent_context SET state='model_prepared_reopen_required' WHERE agent_id=?").run(agentId)
      db.prepare('UPDATE subagent_threads SET updated_at=? WHERE id=?').run(Date.now(), agentId)
    })
  }
}
