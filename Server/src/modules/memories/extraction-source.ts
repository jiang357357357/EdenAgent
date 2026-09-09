import type { EdenDatabase } from '@eden/store'
import { memoryScopeSchema } from '@eden/api'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function identity(metadata: Record<string, unknown>, actorId?: string | number) {
  const participants = Array.isArray(metadata.participants) ? metadata.participants.map(object) : []
  if (participants.length > 1 && actorId === undefined) throw new Error('Memory extraction requires the actual actor')
  const participant = actorId === undefined ? participants[0] : participants.find(item => String(item.assistantId ?? '') === String(actorId))
  if (!participant) return undefined
  const selectedActor = String(participant.assistantId ?? '')
  const key = participant.characterId ?? object(object(participant.profile).character).id
  if ((typeof key !== 'string' && typeof key !== 'number') || !String(key).trim()) return undefined
  if (typeof key === 'number' && !Number.isSafeInteger(key)) throw new Error('Invalid character ID')
  const scope = memoryScopeSchema.parse({ scopeType: 'agent_character', scopeKey: String(key) })
  return { actorId: selectedActor, scopeKey: scope.scopeKey, multi: participants.length > 1 }
}

function assistantReply(database: EdenDatabase, sessionId: string, turnId: string, owner: { actorId: string; multi: boolean }): string {
  const messages = database.connection.prepare("SELECT payload_json FROM events WHERE session_id=? AND turn_id=? AND kind='agent.message_end' ORDER BY seq DESC")
    .all(sessionId, turnId)
  let assistantText = ''
  for (const event of messages) {
    const payload = object(JSON.parse(String(event.payload_json)))
    const message = object(payload.message)
    if (message.role !== 'assistant') continue
    if (owner.multi && String(object(payload.actor).assistantID) !== owner.actorId) continue
    const content = message.content
    assistantText = typeof content === 'string' ? content : Array.isArray(content) ? content.map(object).filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('\n') : ''
    if (assistantText.trim()) break
  }
  return assistantText
}

export function extractionSource(database: EdenDatabase, inputId: string, actorId?: string | number) {
  const row = database.connection.prepare(`SELECT inputs.*, sessions.status AS session_status, turns.state AS turn_state
    FROM inputs JOIN sessions ON sessions.id=inputs.session_id JOIN turns ON turns.id=inputs.turn_id WHERE inputs.id=?`).get(inputId)
  if (!row || row.state !== 'completed' || row.turn_state !== 'completed' || row.session_status !== 'active') throw new Error('Memory extraction requires a completed input in an active session')
  const metadata = object(JSON.parse(String(row.metadata_json)))
  if (metadata.job) return undefined
  if (row.kind !== 'prompt' || metadata.internalHandoff === true) return undefined
  const owner = identity(metadata, actorId)
  if (!owner) return undefined
  const assistantText = assistantReply(database, String(row.session_id), String(row.turn_id), owner)
  const userText = String(row.text)
  if (!userText.trim() || !assistantText.trim()) return undefined
  return { inputId, sessionId: String(row.session_id), turnId: String(row.turn_id), actorId: owner.actorId,
    scopeKey: owner.scopeKey, userText: Array.from(userText).slice(0, 6000).join(''), assistantText: Array.from(assistantText).slice(0, 6000).join('') }
}
