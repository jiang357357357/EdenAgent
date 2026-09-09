import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { parseCoreAssistant } from './model-schema.ts'

const profileFields = new Set(('aliases signature description pronouns age species occupation personality values likes dislikes strengths weaknesses fears habits emotional_style user_relationship user_address self_address relationship_history social_relations relationship_boundaries background setting_summary appearance current_situation goals responsibilities decision_principles initiative_level initiative_rules autonomy conflict_style memory_preferences behavioral_rules forbidden_behaviors speech_style language_preference response_length formality humor_style catchphrases emoji_usage example_dialogue forbidden_phrases voice_style voice_emotion system_prompt world_names origin_world_name visual_preference').split(' '))
const normalize = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
function clean(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(clean)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/api.?key|token|secret|credential|password/i.test(key)).map(([key, item]) => [key, clean(item)]))
}

export function assistantParticipant(detail: unknown): JsonValue {
  const assistant = parseCoreAssistant(detail)
  const character = assistant.character
  const text = (key: string) => typeof character[key] === 'string' ? character[key] : ''
  const identifier = (key: string) => typeof character[key] === 'string' || typeof character[key] === 'number' ? character[key] : null
  const profile = { id: assistant.id, name: assistant.name, character: {
    id: character.id, name: character.name,
    ...Object.fromEntries(Object.entries(character).filter(([key]) => profileFields.has(normalize(key))).map(([key, value]) => [key, clean(toJson(value))])),
  } }
  const participant = toJson({ assistantId: assistant.id, assistantName: assistant.name || character.name,
    characterId: character.id, characterName: character.name, signature: text('signature'), avatarUrl: text('avatar_url'),
    standingImageUrl: text('default_standing_image_url'), ttsConfigId: identifier('tts_config_id'), sttConfigId: identifier('stt_config_id'), position: 0, profile })
  if (Buffer.byteLength(JSON.stringify(participant)) > 65536) throw new Error('Assistant profile exceeds the handoff size limit')
  return participant
}
