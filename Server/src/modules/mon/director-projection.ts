import { directorRunSchema, toJson } from '@eden/api'
import type { DurableEvent, JsonValue } from '@eden/api'
const kinds = new Set(['director.planned', 'director.beat.started', 'director.beat.completed', 'director.failed'])
export function directorProjection(event: DurableEvent): JsonValue | undefined {
  if (!kinds.has(event.kind)) return undefined
  const run = directorRunSchema.parse(event.payload)
  return toJson({ external_plan_id: run.planID, external_user_message_id: run.userMessageID ?? null,
    source: run.source, diagnostic: run.diagnostic ?? null, scene_payload: run.scene,
    execution_payload: run.execution, beats_payload: run.beats, status: run.status,
    active_beat_index: run.activeBeatIndex ?? null, completed_beat_indexes: run.completedBeatIndexes,
    participant_count: run.participantCount, error: run.error ?? null })
}
