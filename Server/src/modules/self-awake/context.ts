import { z } from 'zod'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { MonClient, acquireMonServiceToken } from '@eden/integrations'
import type { MonServiceIdentity } from '@eden/integrations'
import type { SessionRepository } from '../sessions/index.ts'
import type { SelfAwakeRepository } from './repository.ts'

export const selfAwakeContextSchema = z.object({
  section: z.enum(['request', 'desktop_window', 'desktop_session', 'audio_state', 'recent_events', 'recent_diaries', 'recent_contacts']).default('request'),
  limit: z.number().int().min(1).max(5).default(3),
}).strict()

export class SelfAwakeContext {
  constructor(private readonly repository: SelfAwakeRepository, private readonly sessions: SessionRepository, private readonly identity?: MonServiceIdentity) { }
  async read(sessionId: string, turnId: string, raw: unknown, signal: AbortSignal): Promise<JsonValue> {
    const input = selfAwakeContextSchema.parse(raw)
    signal.throwIfAborted()
    const session = this.sessions.read(sessionId)
    if (session.status !== 'active') throw new Error('Self-awake context requires an active session')
    if (input.section === 'request') return toJson(this.repository.context(sessionId, turnId))
    const environment = object(session.environment)
    const owner = this.sessions.origin === 'mon' && this.identity && environment.sessionPurpose === 'self_awake' && environment.selfAwakeUserId === this.identity.userId
      && this.repository.ownsBackgroundSession(sessionId, this.identity.userId) ? this.identity : undefined
    const user = owner?.userId ?? ''
    if (input.section === 'recent_diaries') return toJson({
      section: input.section, source: 'agent.diaries',
      diaries: this.repository.recentDiaries(sessionId, user, input.limit), interpretation: 'Historical attributed notes, not current observations. A different author’s experience is not your own.'
    })
    if (input.section === 'recent_contacts') return toJson({
      section: input.section, source: 'agent.contact_receipts',
      contacts: this.repository.recentContacts(sessionId, user, input.limit),
      interpretation: 'Local receipt summaries, not a remote inbox. Queued, accepted, delivered, displayed and dismissed are distinct; none proves a user response. Manual historical decisions are identified separately. Unknown outcomes require review before sending again.'
    })
    if (!owner) throw new Error('Personal activity context requires the owning Mon background session')
    return await activityContext(owner, signal, input)
  }
}
async function activityContext(owner: MonServiceIdentity, signal: AbortSignal, input: { section: "request" | "desktop_window" | "desktop_session" | "audio_state" | "recent_events" | "recent_diaries" | "recent_contacts"; limit: number }) {
  const token = await acquireMonServiceToken(owner, signal)
  const snapshot = object(await new MonClient(owner.coreBaseUrl, token).get('/api/users/me/activity-presence/', signal))
  const payload = object(snapshot.payload)
  const fields: Record<string, string[]> = { desktop_window: ['foreground_window'], desktop_session: ['system_input', 'session'], audio_state: ['media'], recent_events: ['recent_events'] }
  const data = Object.fromEntries(fields[input.section]!.map(key => [key, payload[key] ?? null]))
  if (input.section === 'audio_state') {
    const agent = object(payload.monagent)
    data.monagent = { voice_recording: agent.voice_recording ?? null, tts_playing: agent.tts_playing ?? null }
  }
  const captured = typeof snapshot.captured_at === 'string' ? Date.parse(snapshot.captured_at) : NaN
  const age = Number.isFinite(captured) ? Math.max(0, Date.now() - captured) : null
  return toJson({
    section: input.section, source: 'core.activity-presence', available: snapshot.available === true,
    captured_at: snapshot.captured_at ?? null, received_at: snapshot.received_at ?? null, ageMs: age, stale: age === null || age > 180000, data,
    interpretation: 'Last reported snapshot, not a live sensor probe. Null or unavailable means unknown. False means inactive only at capture time. No audio content is provided; do not infer speech or intent.'
  })
}

function object(value: unknown): Record<string, JsonValue> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {} }
