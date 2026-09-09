import { toJson } from '@eden/api'
import type { DirectorPlan, JsonValue } from '@eden/api'
import { publicSpeaker } from './public-speaker.ts'

export function actorMessage(payload: JsonValue, participant: JsonValue, plan: DirectorPlan, beatIndex: number): JsonValue {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const message = value.message
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.role !== 'assistant') return payload
  const beat = plan.beats[beatIndex]!
  return toJson({ ...value, message: { ...message, speaker: publicSpeaker(participant, beatIndex), orchestration: {
    planID: plan.planID, directorSource: plan.source, directorDiagnostic: plan.diagnostic ?? null,
    scene: plan.scene, execution: plan.execution, beatIndex, speechAct: beat.speechAct, addressTo: beat.addressTo,
    replyToBeat: beat.replyToBeat ?? null, intent: beat.intent,
  } } })
}
