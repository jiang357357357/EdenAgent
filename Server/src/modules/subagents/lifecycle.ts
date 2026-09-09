import type { SubagentService } from './service.ts'
export class SubagentLifecycle {
  private timer: ReturnType<typeof setTimeout> | undefined
  private task: Promise<void> | undefined
  private closed = false
  private error: string | undefined
  constructor(private readonly service: SubagentService) {}
  get fault() { return this.error }
  start(): Promise<void> { if (!this.closed && !this.timer && !this.task) this.pump(); return this.task ?? Promise.resolve() }
  async close() { this.closed = true; clearTimeout(this.timer); await this.task }
  private pump() {
    if (this.closed) return
    this.task = this.sweep().catch(error => { this.error = error instanceof Error ? error.message : String(error); this.closed = true })
      .finally(() => { this.task = undefined; if (!this.closed) { this.timer = setTimeout(() => { this.timer = undefined; this.pump() }, 1000); this.timer.unref() } })
  }
  private async sweep() {
    this.service.repository.settle()
    for (const thread of this.service.repository.active()) {
      if (this.closed) return
      if (thread.deadlineAt !== null && Number(thread.deadlineAt) <= Date.now()) await this.service.interrupt(thread.id, 'Subagent deadline reached')
      else if (!this.service.parentActive(thread.childSessionId)) await this.service.interrupt(thread.id, 'Parent session is no longer active')
    }
  }
}
