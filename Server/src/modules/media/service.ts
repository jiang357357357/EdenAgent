import { cameraRequestSchema, screenRequestSchema, mediaResolveSchema, mediaResultSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { AttachmentService } from '../attachments/index.ts'
import type { SessionRepository } from '../sessions/index.ts'
import { MediaRepository } from './repository.ts'
export class MediaService {
  private readonly repository: MediaRepository
  private readonly waiters = new Map<string, { resolve(value: JsonValue): void; reject(error: unknown): void }>()
  private closed = false
  constructor(sessions: SessionRepository, private readonly attachments: AttachmentService) {
    this.repository = new MediaRepository(sessions)
    const rows = sessions.database.connection.prepare("SELECT id FROM media_requests WHERE state='pending'").all()
    for (const row of rows) this.repository.finish(String(row.id), 'expired', null, 'Host restarted')
  }
  async images(raw: JsonValue, signal: AbortSignal) {
    signal.throwIfAborted()
    const result = mediaResultSchema.parse(raw)
    const snapshots = await this.attachments.snapshot([{ blobId: result.blobId, mime: result.mime, filename: 'approved-media-capture' }])
    const images = await this.attachments.images(snapshots)
    signal.throwIfAborted()
    return images
  }
  list(kind?: string | null) { return this.repository.list(kind) }
  async ask(sessionId: string, turnId: string, kind: 'screen' | 'camera', raw: unknown, signal: AbortSignal): Promise<JsonValue> {
    signal.throwIfAborted()
    if (this.closed) throw new Error('Media service is shutting down')
    const input = (kind === 'screen' ? screenRequestSchema : cameraRequestSchema).parse(raw)
    const { request, event } = this.repository.create(sessionId, turnId, kind, toJson(input))
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener('abort', abort); this.waiters.delete(request.id) }
      const abort = () => { try { this.finish(request.id, 'cancelled', null, 'Capture cancelled') } catch (error) { cleanup(); reject(error) } }
      this.waiters.set(request.id, { resolve: value => { cleanup(); resolve(value) }, reject: error => { cleanup(); reject(error) } })
      signal.addEventListener('abort', abort, { once: true })
      this.repository.sessions.events.publish(event)
      if (signal.aborted) abort()
    })
  }
  async resolve(raw: unknown) {
    const input = mediaResolveSchema.parse(raw)
    const request = this.repository.read(input.id)
    if (request.state !== 'pending') throw new Error('Media request is no longer pending')
    this.repository.sessions.read(request.sessionId)
    if (input.result) {
      await this.attachments.snapshot([{ blobId: input.result.blobId, mime: input.result.mime, filename: request.kind + '-capture' }])
    }
    return this.finish(input.id, input.error ? 'rejected' : 'resolved', input.result ? toJson(input.result) : null, input.error ?? null)
  }
  private finish(id: string, state: string, result: JsonValue | null, error: string | null) {
    const record = this.repository.finish(id, state, result, error)
    const waiter = this.waiters.get(id)
    if (state === 'resolved') waiter?.resolve(result)
    else waiter?.reject(new Error(error ?? `Media ${state}`))
    return record
  }
  close() {
    this.closed = true
    const failures: unknown[] = []
    for (const [id, waiter] of this.waiters) {
      try { this.finish(id, 'expired', null, 'Host shutting down') } catch (error) { waiter.reject(error); failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Media shutdown persistence failed')
  }
}
