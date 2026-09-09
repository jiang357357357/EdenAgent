import type { JsonValue } from '@eden/api'

const fields = { assistantID: 'assistantId', assistantName: 'assistantName', characterID: 'characterId', characterName: 'characterName',
  signature: 'signature', avatarUrl: 'avatarUrl', standingImageUrl: 'standingImageUrl', ttsConfigID: 'ttsConfigId', sttConfigID: 'sttConfigId', position: 'position' }

export function publicParticipants(participants: JsonValue[]): JsonValue[] {
  return participants.map(participant => {
    const value = participant && typeof participant === 'object' && !Array.isArray(participant) ? participant : {}
    return Object.fromEntries(Object.values(fields).flatMap(key => typeof value[key] === 'string' || typeof value[key] === 'number' ? [[key, value[key]!]] : []))
  })
}

export function publicSpeaker(participant: JsonValue, beatIndex: number): JsonValue {
  const value = publicParticipants([participant])[0] as Record<string, JsonValue>
  return { ...Object.fromEntries(Object.entries(fields).map(([target, source]) => [target, value[source] ?? null])), turnIndex: beatIndex, beatIndex }
}
