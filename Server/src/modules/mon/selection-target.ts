import type { JsonValue, ModelSelectionTarget } from '@eden/api'

export function selectionTarget(target: ModelSelectionTarget | undefined, sessionId: string | undefined, participants: JsonValue[]) {
  const ids = participants.map(participant => participant && typeof participant === 'object' && !Array.isArray(participant) ? participant.assistantId : undefined)
  if (target?.kind === 'actor') {
    if (!sessionId || !ids.some(id => id !== undefined && String(id) === String(target.assistantId))) {
      throw new Error('Model selection actor must belong to the specified session')
    }
    return { assistantId: target.assistantId, forceCharacter: true }
  }
  if (target?.kind === 'director') {
    if (!sessionId || participants.length < 2) throw new Error('Director selection requires a multi-actor session')
    return { assistantId: undefined, forceCharacter: false }
  }
  if (participants.length > 1) throw new Error('Select an explicit actor or director target for a multi-actor session')
  const id = ids[0]
  return { assistantId: typeof id === 'string' || typeof id === 'number' ? id : undefined, forceCharacter: false }
}
