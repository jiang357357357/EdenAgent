import { randomUUID } from 'node:crypto'
import { DesktopError } from './contracts.ts'

/** Explicitly start/revive one driver-owned session. No input operation is retried here. */
export class NativeDesktopSession {
  readonly name = `eden-${randomUUID()}`
  private generation = 0
  private ready = false
  private created = false
  get started() { return this.created }
  constructor(private readonly start: (session: string, signal: AbortSignal) => Promise<{ active: boolean; revived: boolean }>) {}

  async prepare(signal: AbortSignal): Promise<number> {
    signal.throwIfAborted()
    const state = await this.start(this.name, signal)
    if (!state.active) {
      this.ready = false
      throw new DesktopError('桌面驱动会话未能启动，请稍后重新观察窗口', 'DRIVER_SESSION_UNAVAILABLE', 'failed',
        { operation: 'start_session', recovery: ['observe_window'] })
    }
    if (!this.ready || state.revived) this.generation++
    this.created = true
    this.ready = true
    signal.throwIfAborted()
    return this.generation
  }

  failed(code: string) { if (code === 'session_ended' || code === 'session_not_found') this.ready = false }
}
