import type { JsonValue } from '@eden/api'
import type { MonClient } from '@eden/integrations'
import type { ActorModelBinding } from '../models/index.ts'
import { coreIdSchema } from './model-schema.ts'
import { loadMonCatalog } from './model-catalog.ts'

export async function loadActorCatalog(client: MonClient, participants: JsonValue[], signal: AbortSignal) {
  if (participants.length > 32) throw new Error('A session supports at most 32 actors')
  const ids = participants.map(participant => coreIdSchema.parse(
    participant && typeof participant === 'object' && !Array.isArray(participant) ? participant.assistantId : undefined,
  ))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('Duplicate assistantId in session participants')
  const bindings: ActorModelBinding[] = []
  const actors = []
  let first: Awaited<ReturnType<typeof loadMonCatalog>> | undefined
  for (const id of ids) {
    signal.throwIfAborted()
    const result = await loadMonCatalog(client, id, signal)
    first ??= result
    if (!result.binding) throw new Error(`No active model configured for actor ${id}`)
    bindings.push({ assistantId: id, characterId: result.catalog.character.id, main: result.binding, vision: result.visionBinding })
    actors.push({ assistantId: id, assistantName: result.catalog.assistant.name, characterId: result.catalog.character.id, main: result.catalog.current, vision: result.catalog.vision })
  }
  const director = await loadMonCatalog(client, undefined, signal)
  if (!director.binding) throw new Error('No active model configured for the session director')
  return { bindings, actors, directorBinding: director.binding, catalog: { source: 'core', serviceType: 'ai',
    vendors: first?.catalog.vendors ?? {}, assistant: null, character: null, current: null, vision: null,
    director: director.catalog.current, selectionSource: 'actors', options: first?.catalog.options.map(option => ({ ...option, selected: false })) ?? [], actors } }
}
