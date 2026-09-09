import { z } from 'zod'
import { actorIdSchema } from '@eden/api'

const participantSchema = z.object({
  assistantId: actorIdSchema, assistantName: z.string().trim().default(''),
  characterName: z.string().trim().default(''), signature: z.string().default(''),
})
export type DirectorParticipant = z.infer<typeof participantSchema>

export function directorRoster(raw: unknown): DirectorParticipant[] {
  const roster = z.array(participantSchema).min(1).max(32).parse(raw)
  if (new Set(roster.map(actor => String(actor.assistantId))).size !== roster.length) throw new Error('Duplicate director participant')
  return roster
}

export function actorIdentities(roster: DirectorParticipant[]): Map<string, string | number> {
  const ids = new Map(roster.map(actor => [String(actor.assistantId).toLowerCase(), actor.assistantId]))
  const aliases = new Map<string, Set<string | number>>()
  for (const actor of roster) for (const name of [actor.assistantName, actor.characterName]) {
    if (!name) continue
    const key = name.toLowerCase()
    const matches = aliases.get(key) ?? new Set<string | number>()
    matches.add(actor.assistantId); aliases.set(key, matches)
  }
  for (const [name, matches] of aliases) if (!ids.has(name) && matches.size === 1) ids.set(name, [...matches][0]!)
  return ids
}
