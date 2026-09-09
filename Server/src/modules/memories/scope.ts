import { memoryScopeSchema } from '@eden/api'
import type { MemoryScope } from '@eden/api'
import type { EdenDatabase } from '@eden/store'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return undefined
}

export class MemoryScopes {
  constructor(private readonly database: EdenDatabase) {}

  current(sessionId: string, turnId: string, actorId?: string | number): MemoryScope {
    const scope = this.optionalCurrent(sessionId, turnId, actorId)
    if (!scope) throw new Error('No current character bound for memory access')
    return scope
  }

  optionalCurrent(sessionId: string, turnId: string, actorId?: string | number): MemoryScope | undefined {
    const row = this.database.connection.prepare(`SELECT inputs.metadata_json FROM inputs JOIN sessions ON sessions.id=inputs.session_id
      WHERE inputs.session_id=? AND inputs.turn_id=? AND inputs.state='running' AND sessions.status='active'`).get(sessionId, turnId)
    if (!row) throw new Error('Memory access requires an active input')
    const metadata = object(JSON.parse(String(row.metadata_json)))
    const participants = Array.isArray(metadata.participants) ? metadata.participants.map(object) : []
    if (participants.length > 1 && actorId === undefined) throw new Error('Memory access requires the executing actor identity')
    const participant = actorId === undefined ? participants[0] : participants.find(item => scalar(item.assistantId) === String(actorId))
    if (!participant) return undefined
    const scopeKey = scalar(participant.characterId) ?? scalar(object(object(participant.profile).character).id)
    if (!scopeKey) return undefined
    return memoryScopeSchema.parse({ scopeType: 'agent_character', scopeKey })
  }
}
