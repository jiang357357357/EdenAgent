import { toJson } from '@eden/api'
import type { DurableEvent, JsonValue } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
export function messageProjection(sessions: SessionRepository, event: DurableEvent): JsonValue | undefined {
  const payload = event.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const message = payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
  if (message.role !== 'user' && message.role !== 'assistant') return undefined
  let messageId = projectionMessageId(payload, event, sessions, message)
  const { assistant, character } = messageSpeaker(sessions, event)
  return toJson({
    external_message_id: messageId, external_parent_message_id: '', kind: message.role,
    message_payload: {
      info: {
        id: messageId, role: message.role, turnID: event.turnId,
        time: { created: event.createdAt, completed: event.createdAt },
        speaker: message.role === 'assistant' ? { assistantID: assistant, characterID: character } : null
      },
      message, parts: message.content ?? []
    }, speaker_assistant: message.role === 'assistant' ? assistant : null,
    speaker_character: message.role === 'assistant' ? character : null, turn_index: null, orchestration_payload: {}, tool_call_id: '', sync_status: 'synced'
  })
}

function messageSpeaker(sessions: SessionRepository, event: { id: string; sessionId: string; turnId: string | null; seq: string; kind: string; payload: JsonValue; createdAt: number }) {
  const actor = sessions.read(event.sessionId).participants[0]
  const participant = actor && typeof actor === 'object' && !Array.isArray(actor) ? actor : {}
  const assistant = participant.assistantId ?? null, character = participant.characterId ?? null
  return { assistant, character }
}

function projectionMessageId(payload: { [key: string]: JsonValue }, event: { id: string; sessionId: string; turnId: string | null; seq: string; kind: string; payload: JsonValue; createdAt: number }, sessions: SessionRepository, message: { [key: string]: JsonValue }) {
  let messageId = typeof payload.messageId === 'string' ? payload.messageId : event.id
  if (messageId === event.id) {
    const rows = sessions.database.connection.prepare(`SELECT id,kind,payload_json FROM events WHERE session_id=? AND turn_id IS ? AND seq<?
      AND kind IN ('agent.message_start','agent.message_end') ORDER BY seq DESC LIMIT 100`).all(event.sessionId, event.turnId, BigInt(event.seq))
    for (const row of rows) {
      const candidate = JSON.parse(String(row.payload_json))
      if (row.kind === 'agent.message_end' && candidate.message?.role !== 'toolResult') break
      if (row.kind === 'agent.message_start' && candidate.message?.role === message.role) messageId = String(row.id)
    }
  }
  return messageId
}
