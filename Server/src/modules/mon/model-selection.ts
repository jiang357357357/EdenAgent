import type { MonClient } from '@eden/integrations'
import { parseCoreAssistant, coreIdSchema, resolveCoreModel } from './model-schema.ts'

export async function prepareModelSelection(client: MonClient, entityId: string | number, assistantId: string | number | undefined, signal: AbortSignal, forceCharacter = false) {
  const id = coreIdSchema.parse(entityId)
  const binding = resolveCoreModel(await client.get(`/api/ai/entities/${encodeURIComponent(String(id))}/`, signal))
  if (String(binding.entityId) !== String(id)) throw new Error('Mon model detail identity mismatch')
  const assistantPath = assistantId === undefined ? '/api/assistants/current/' : `/api/assistants/${encodeURIComponent(String(assistantId))}/`
  const assistant = parseCoreAssistant(await client.get(assistantPath, signal), assistantId)
  return forceCharacter || assistant.character.ai_talk_entity_id != null ? {
    endpoint: `/api/characters/${encodeURIComponent(String(assistant.character.id))}/`, body: { ai_talk_entity_id: id },
  } : { endpoint: '/api/agent/settings/my/', body: { default_model: String(id) } }
}
