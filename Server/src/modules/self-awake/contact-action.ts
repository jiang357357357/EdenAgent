import { z } from 'zod'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { ContactNotDeliveredError } from '../mon/index.ts'
import type { PermissionService } from '../permissions/index.ts'
import type { SessionRepository } from '../sessions/index.ts'
const channelSchema = z.enum(['desktop', 'qq', 'email'])
const payloadSchema = z.object({
  channel: z.enum(['desktop', 'qq', 'email', 'auto']).default('desktop'),
  fallbackChannels: z.array(channelSchema).max(3).default([]), title: z.string().trim().min(1).max(256).default('角色消息'),
  message: z.string().trim().min(1).max(16000), expiresAt: z.number().int().safe().nonnegative().optional(),
}).passthrough()
export interface ContactActionContext { id: string; sessionId: string; turnId: string; author: JsonValue }
export type ExternalContact = (channel: 'email' | 'qq', sessionId: string, input: { requestId: string; title: string; message: string }, signal: AbortSignal) => Promise<JsonValue>
export async function executeContactAction(action: ContactActionContext, raw: JsonValue, sessions: SessionRepository,
  permissions: PermissionService, external: ExternalContact, desktop: () => Promise<JsonValue>, signal: AbortSignal): Promise<JsonValue> {
  const payload = payloadSchema.parse(raw)
  const channels = [...new Set(payload.channel === 'auto' ? ['qq', 'email', 'desktop'] as const : [payload.channel, ...payload.fallbackChannels])]
  const attempts: JsonValue[] = []
  for (const channel of channels) {
    signal.throwIfAborted()
    if (payload.expiresAt !== undefined && Date.now() >= payload.expiresAt) return toJson({ status: 'suppressed', reason: 'contact_expired', attempts })
    if (channel !== 'desktop' && sessions.read(action.sessionId).runtimeOrigin !== 'mon') {
      attempts.push({ channel, status: 'unavailable' }); continue
    }
    await permissions.request({ sessionId: action.sessionId, turnId: action.turnId, callId: `self-awake:${action.id}:${channel}`, signal },
      channel === 'desktop' ? 'desktop.notify' : `contact.${channel}`, action.sessionId,
      toJson({ runId: action.id, channel, title: payload.title, message: payload.message, author: action.author, selectedChannels: channels }))
    signal.throwIfAborted()
    assertContactAuthor(sessions, action)
    if (payload.expiresAt !== undefined && Date.now() >= payload.expiresAt) return toJson({ status: 'suppressed', reason: 'contact_expired', attempts })
    try {
      const receipt = channel === 'desktop' ? await desktop() : await external(channel, action.sessionId,
        { requestId: `self-awake:${action.id}:${channel}`, title: payload.title, message: payload.message }, signal)
      return toJson({ status: 'accepted', deliveredChannel: channel, receipt, attempts })
    } catch (error) {
      signal.throwIfAborted()
      if (!(error instanceof ContactNotDeliveredError)) throw error
      attempts.push({ channel, status: 'not_delivered' })
    }
  }
  throw new Error('None of the selected contact channels accepted the notification')
}

function assertContactAuthor(sessions: SessionRepository, action: ContactActionContext) {
  const session = sessions.read(action.sessionId)
  if (session.status !== 'active' || JSON.stringify(session.participants[0] ?? {}) !== JSON.stringify(action.author)) throw new Error('Self-awake author changed during contact approval')
}
