/** Track asynchronous validation until it either commits an input or is cancelled. */
export class InputAdmissions {
  private readonly jobs = new Map<Promise<unknown>, { sessionId: string; controller: AbortController }>()
  private closed = false

  submit<T>(sessionId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Server is shutting down'))
    if (this.jobs.size >= 8) return Promise.reject(new Error('Input validation limit exceeded'))
    const controller = new AbortController()
    const task = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return work(controller.signal)
    }).finally(() => this.jobs.delete(task))
    this.jobs.set(task, { sessionId, controller })
    return task
  }

  has(sessionId: string): boolean { return [...this.jobs.values()].some(job => job.sessionId === sessionId) }

  cancel(sessionId: string): boolean {
    let cancelled = false
    for (const job of this.jobs.values()) {
      if (job.sessionId !== sessionId) continue
      job.controller.abort(new Error('Input validation cancelled'))
      cancelled = true
    }
    return cancelled
  }

  async wait(sessionId?: string): Promise<void> {
    const tasks = [...this.jobs].filter(([, job]) => sessionId === undefined || job.sessionId === sessionId).map(([task]) => task)
    await Promise.allSettled(tasks)
  }

  async close(): Promise<void> {
    this.closed = true
    for (const job of this.jobs.values()) job.controller.abort(new Error('Server is shutting down'))
    await this.wait()
  }
}
