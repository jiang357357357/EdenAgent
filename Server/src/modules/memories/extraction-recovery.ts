import { setImmediate } from 'node:timers/promises'
import type { MemoryExtractionRepository } from './extraction-repository.ts'

/** Run before queue execution starts; repeated recovery preserves every existing job identity and terminal state. */
export async function recoverMemoryExtractions(jobs: Pick<MemoryExtractionRepository, 'recover' | 'completedInputs' | 'scheduleInput'>,
  signal: AbortSignal, pageSize = 50) {
  signal.throwIfAborted()
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid extraction recovery page size')
  const interrupted = jobs.recover()
  let cursor: string | null = '0'
  let inputs = 0
  let tasks = 0
  while (cursor !== null) {
    signal.throwIfAborted()
    const page = jobs.completedInputs(cursor, pageSize)
    for (const inputId of page.ids) {
      signal.throwIfAborted()
      tasks += jobs.scheduleInput(inputId).length
      inputs++
    }
    cursor = page.nextCursor
    if (cursor !== null) await setImmediate(undefined, { signal })
  }
  return { interrupted, inputs, tasks }
}
