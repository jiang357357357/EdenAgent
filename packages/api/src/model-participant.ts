import type { JsonValue } from './json.ts'

const narrativeFields = new Set(('id name aliases signature description pronouns age species occupation personality values likes dislikes strengths weaknesses fears habits emotional_style user_relationship user_address self_address relationship_history social_relations relationship_boundaries background backstory setting_summary appearance current_situation goals responsibilities decision_principles initiative_level initiative_rules autonomy conflict_style memory_preferences behavioral_rules forbidden_behaviors speech_style language_preference response_length formality humor_style catchphrases emoji_usage example_dialogue forbidden_phrases voice_style voice_emotion system_prompt world_names origin_world_name').split(' '))
const normalize = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
const object = (value: unknown): Record<string, JsonValue> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {}
const internalField = /api_?key|token|secret|credential|password|^visual_|^spine_|^costumes?$|^devices$|^avatar|^tts_|^stt_|^vector_|^memory_config$/
function narrativeValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(narrativeValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !internalField.test(normalize(key))).map(([key, item]) => [key, narrativeValue(item)]))
}

/** Model-facing projection only. Never overwrite the persisted/UI participant with this. */
export function modelCharacterProfile(value: unknown): JsonValue {
  return Object.fromEntries(Object.entries(object(value)).filter(([key]) => narrativeFields.has(normalize(key))).map(([key, item]) => [key, narrativeValue(item)]))
}

export function modelParticipant(value: unknown): JsonValue {
  const participant = object(value), profile = object(participant.profile)
  const identity = Object.fromEntries(['assistantId', 'assistantName', 'characterId', 'characterName', 'signature', 'position']
    .filter(key => ['string', 'number'].includes(typeof participant[key])).map(key => [key, participant[key]!]))
  const projected = object(modelCharacterProfile(profile))
  if (profile.character && typeof profile.character === 'object' && !Array.isArray(profile.character)) projected.character = modelCharacterProfile(profile.character)
  const result: Record<string, JsonValue> = { ...identity, profile: projected }
  if (participant.character) result.character = modelCharacterProfile(participant.character)
  return result
}
