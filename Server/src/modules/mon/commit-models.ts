import type { JsonValue } from '@eden/api'
import { modelBindingSnapshotSchema } from '../models/index.ts'
import type { ModelService, ModelBindingSnapshot } from '../models/index.ts'
import type { SessionRepository } from '../sessions/index.ts'

export function commitMonModels(models: ModelService, sessions: SessionRepository, sessionId: string | undefined,
  value: ModelBindingSnapshot, kind: string, payload: JsonValue, saveConnection?: () => void): void {
  const snapshot = modelBindingSnapshotSchema.parse(value)
  const key = sessionId ?? 'default'
  const insert = () => { saveConnection?.(); return sessionId ? sessions.events.insert(sessionId, null, kind, payload) : undefined }
  let event
  if (models.hasPersistentBindings) event = models.commitBinding(key, snapshot, insert)
  else {
    event = sessions.database.transaction(insert)
    if (snapshot.mode === 'multi') models.bindActors(key, snapshot.actors.map(actor => ({ ...actor, vision: actor.vision ?? undefined })), snapshot.director ?? undefined)
    else { models.bind(sessionId, snapshot.main ?? undefined); if (sessionId) models.bindVision(sessionId, snapshot.vision ?? undefined, snapshot.visionEntityId) }
  }
  if (event) sessions.events.publish(event)
}
