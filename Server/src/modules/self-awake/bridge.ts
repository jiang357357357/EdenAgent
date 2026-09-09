import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MonClient, acquireMonServiceToken } from '@eden/integrations'
import type { MonServiceIdentity } from '@eden/integrations'
import { jsonValue, toJson } from '@eden/api'
import type { SessionService } from '../sessions/index.ts'
import { assistantParticipant } from '../mon/index.ts'
import type { MonBindingService } from '../mon/index.ts'
import { SelfAwakeBridgeRepository } from './bridge-repository.ts'

const userId = z.union([z.string().min(1).max(128), z.number().int()]).transform(String)
const submission = z.object({ user_id: userId, schema_version: z.literal('self-awake.v1'), idempotency_key: z.string().min(1).max(256),
  event_id: z.string().min(1).max(256), context: jsonValue }).strict()
const status = z.object({ user_id: userId, job_id: z.uuid() }).strict()

export class SelfAwakeBridge {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly abort = new AbortController()
  constructor(readonly identity: MonServiceIdentity, readonly repository: SelfAwakeBridgeRepository,
    private readonly sessions: SessionService, private readonly mon: MonBindingService) {}
  async close(): Promise<void> { this.abort.abort(); await this.tail.catch(() => {}) }
  readStatus(raw: unknown) {
    const input = status.parse(raw)
    if (input.user_id !== this.identity.userId) throw new Error('Self-awake user mismatch')
    return toJson(this.repository.status(input.user_id, input.job_id))
  }
  submit(raw: unknown) {
    const input = submission.parse(raw)
    if (input.user_id !== this.identity.userId) throw new Error('Self-awake user mismatch')
    const task = this.tail.then(async () => {
      this.abort.signal.throwIfAborted()
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
      let job = this.repository.existing(input.user_id, input.idempotency_key, hash)
      if (!job) {
        const token = await acquireMonServiceToken(this.identity, this.abort.signal)
        const client = new MonClient(this.identity.coreBaseUrl, token)
        const author = assistantParticipant(await client.get('/api/assistants/current/', this.abort.signal))
        // Each external wake captures its own duty identity; it never mutates an active character's session.
        const session = this.sessions.repository.create('后台自醒', [author], { sessionPurpose: 'self_awake', selfAwakeUserId: input.user_id, timezone: 'Asia/Shanghai', locale: 'zh-CN' })
        try {
          await this.mon.catalog({ sessionId: session.id, coreBaseUrl: this.identity.coreBaseUrl, coreToken: token })
          this.abort.signal.throwIfAborted()
          job = this.repository.submit(input.user_id, input.idempotency_key, hash, { kind: 'self_awake', sessionId: session.id, dueAt: Date.now(),
            payload: { schemaVersion: 'self-awake.v1', scheduler: 'monos', eventId: input.event_id, userId: input.user_id, trigger: input.context,
              prompt: '按当前角色的意愿与处境决定本轮行动，按需使用工具，最后记录经历。' },
            key: `self-awake:${input.user_id}:${input.idempotency_key}`, causationId: input.event_id, depth: 0 })
        } catch (error) {
          // Keep the failed preparation auditable without leaving an active empty background session.
          await this.sessions.endSession(session.id, 'closed')
          throw error
        }
      }
      return toJson({ accepted: true, async_run_id: job.id, job_id: job.id, event_id: input.event_id, idempotency_key: input.idempotency_key, status: job.state })
    })
    this.tail = task.catch(() => {})
    return task
  }
}
