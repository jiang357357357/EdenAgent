import { gsvPreviewSchema, gsvSttTestSchema } from '@eden/api'
import type { BlobService } from '../blobs/index.ts'
import { synthesizeGsv } from './gsv-synthesis.ts'
import { discoverGsv } from './gsv-discovery.ts'
import { gsvResponse } from './gsv-client.ts'
export class VoiceService {
  private readonly abort = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  constructor(private readonly blobs: BlobService) {}
  preview(raw: unknown) {
    const input = gsvPreviewSchema.parse(raw)
    this.abort.signal.throwIfAborted()
    if (this.pending.size >= 2) throw new Error('Voice synthesis concurrency limit reached')
    const start = Date.now()
    const task = synthesizeGsv(input.config, input.text, this.abort.signal).then(async audio => {
      this.abort.signal.throwIfAborted()
      const blob = await this.blobs.put(audio.bytes, audio.mime)
      return { ok: true, audioBlobId: blob.id, mime: audio.mime, durationMs: audio.durationMs, latencyMs: Date.now() - start, roleId: audio.roleId }
    })
    this.pending.add(task)
    void task.finally(() => this.pending.delete(task)).catch(() => {})
    return task
  }
  discover(raw: unknown) { return this.request(() => discoverGsv(raw, this.abort.signal)) }
  testStt(raw: unknown) {
    const { config } = gsvSttTestSchema.parse(raw)
    return this.request(async () => {
      const started = Date.now()
      await gsvResponse({ ...config, timeoutSeconds: Math.min(config.timeoutSeconds, 12) }, '/health', this.abort.signal)
      return { ok: true, latencyMs: Date.now() - started }
    })
  }
  private request<T>(operation: () => Promise<T>): Promise<T> {
    this.abort.signal.throwIfAborted()
    if (this.pending.size >= 2) throw new Error('Voice request concurrency limit reached')
    const task = operation()
    this.pending.add(task)
    void task.finally(() => this.pending.delete(task)).catch(() => {})
    return task
  }
  async close() { this.abort.abort(); await Promise.allSettled([...this.pending]) }
}
