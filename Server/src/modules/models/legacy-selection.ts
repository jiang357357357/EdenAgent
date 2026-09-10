import type { EdenDatabase } from '@eden/store'
import type { JsonValue } from '@eden/api'
import type { ModelBindingSnapshot } from './binding-snapshot.ts'
import type { SQLOutputValue } from 'node:sqlite'

/** Reconcile old entity choices only after a valid current binding has been durably saved. */
export function reconcileLegacySelections(database: EdenDatabase, sessionId: string, participants: JsonValue[], snapshot: ModelBindingSnapshot): void {
  if (!database.inTransaction) throw new Error('Legacy model reconciliation requires the binding transaction')
  const rows = database.connection.prepare("SELECT * FROM legacy_model_selections WHERE session_id=? AND state='refresh_required'").all(sessionId)
  const assistantId = selectionAssistantId(participants)
  for (const row of rows) {
    const previousAssistant = String(row.assistant_id)
    const actor = snapshot.mode === 'multi' ? snapshot.actors.find(item => String(item.assistantId) === previousAssistant) : undefined
    const main = snapshot.mode === 'single' ? snapshot.main : actor?.main
    if (!main || (snapshot.mode === 'single' && previousAssistant && previousAssistant !== assistantId)) continue
    const { state, currentVision, visionKnown } = selectionResolution(row, main, snapshot, actor)
    database.connection.prepare('UPDATE legacy_model_selections SET state=?,resolution_json=?,resolved_at=? WHERE domain=? AND source_id=?')
      .run(state, JSON.stringify({
        mainEntityId: String(main.entityId), visionEntityId: currentVision === undefined ? null : currentVision,
        visionIdentityKnown: visionKnown, reason: state === 'replaced' ? 'Current binding differs from the historical entity selection' :
          state === 'refreshed' ? 'Current binding matches historical entity identities' : 'Vision entity identity remains unverified'
      }),
        state === 'refresh_required' ? null : Date.now(), row.domain!, row.source_id!)
  }
}

function selectionAssistantId(participants: JsonValue[]) {
  const first = participants[0]
  const assistantId = first && typeof first === 'object' && !Array.isArray(first) ? String(first.assistantId ?? '') : ''
  return assistantId
}

function selectionResolution(row: Record<string, SQLOutputValue>, main: { entityId: string | number }, snapshot: ModelBindingSnapshot, actor: Extract<ModelBindingSnapshot, { mode: 'multi' }>['actors'][number] | undefined) {
  const sameMain = String(row.ai_entity_id) === String(main.entityId)
  const oldVision = row.vision_ai_entity_id === null ? null : String(row.vision_ai_entity_id)
  const currentVision = snapshot.mode === 'multi' ? actor?.vision?.entityId ?? null :
    snapshot.vision === null ? null : snapshot.visionEntityId ?? undefined
  // Older single-mode snapshots may lack identity. Never infer equivalence from a model name.
  const visionKnown = currentVision !== undefined
  const sameVision = visionKnown && (oldVision === null ? currentVision == null : oldVision === String(currentVision))
  const state = !sameMain ? 'replaced' : !visionKnown ? 'refresh_required' : sameVision ? 'refreshed' : 'replaced'
  return { state, currentVision, visionKnown }
}
