/** Serializes Eden mutations to one workspace; external editors do not participate in this queue. */
export class WorkspaceMutationQueue {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    const previous = this.tail
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    this.tail = previous.then(() => gate)
    try {
      await waitForPrevious(previous, signal)
      signal.throwIfAborted()
      return await work()
    } finally { release() }
  }
}

async function waitForPrevious(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Workspace operation cancelled while queued'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try { await Promise.race([previous, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}
