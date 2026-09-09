import { z } from 'zod'
import { jsonValue, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { MonClient } from '@eden/integrations'

const object = z.record(z.string(), jsonValue)
const remoteIdentity = z.object({ id: z.union([z.number().int().positive().safe(), z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)]) })
const externalId = z.string().min(1).max(1024)
export interface LegacyProjectionPlan {
  kind: 'session' | 'message' | 'director'
  session: Record<string, JsonValue>
  record: Record<string, JsonValue> | null
  assistants: (string | number)[] | null
}

/** Validate all local payloads before the first request; preserve original external identifiers. */
export function legacyProjectionPlan(kind: string, sessionId: string, raw: unknown): LegacyProjectionPlan {
  if (!['session', 'message', 'director'].includes(kind)) throw new Error('This historical delivery needs a dedicated channel adapter')
  const payload = object.parse(raw), session = kind === 'session' ? payload : object.parse(payload.session)
  if (session.source !== 'monagent' || session.external_session_id !== sessionId) throw new Error('Historical Core projection session identity mismatch')
  const metadata = session.session_payload === undefined ? {} : object.parse(session.session_payload)
  if (metadata.id !== undefined && metadata.id !== sessionId) throw new Error('Historical Core session metadata identity mismatch')
  const assistants = metadata.participantAssistantIDs === undefined ? null : z.array(z.union([
    z.string().min(1).max(128), z.number().int().positive().safe(),
  ])).max(32).parse(metadata.participantAssistantIDs)
  const record = kind === 'session' ? null : object.parse(payload[kind])
  if (kind === 'message') externalId.parse(record!.external_message_id)
  if (kind === 'director') externalId.parse(record!.external_plan_id)
  return { kind: kind as LegacyProjectionPlan['kind'], session, record, assistants }
}

/** Caller must persist an authorized replay intent and verify the Core principal before invoking. */
export async function deliverLegacyProjection(client: MonClient, plan: LegacyProjectionPlan, signal: AbortSignal,
  assertCurrent: () => void): Promise<JsonValue> {
  const check = () => { signal.throwIfAborted(); assertCurrent() }
  check()
  const response = await client.post('/api/agent/sessions/', plan.session, signal)
  const remoteId = String(remoteIdentity.parse(response).id)
  if (plan.kind === 'session') {
    if (plan.assistants !== null) {
      check()
      await client.put(`/api/agent/sessions/${encodeURIComponent(remoteId)}/participants/`, { assistant_ids: plan.assistants, mode: 'companion' }, signal)
    }
    return toJson({ kind: plan.kind, remoteSessionId: remoteId, status: 'confirmed' })
  }
  check()
  const endpoint = plan.kind === 'message' ? 'messages' : 'director-runs'
  const receipt = await client.post(`/api/agent/sessions/${encodeURIComponent(remoteId)}/${endpoint}/`, plan.record!, signal)
  if (plan.kind === 'message' && object.parse(receipt).sync_status === 'failed') throw new Error('Core retained the raw message but its projection failed')
  return toJson({ kind: plan.kind, remoteSessionId: remoteId, status: 'confirmed', receipt })
}
