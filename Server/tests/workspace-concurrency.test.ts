import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WorkspaceMutationQueue } from '../src/modules/workspace/mutation-queue.ts'

test('workspace effects stay serialized when a queued operation is cancelled', async () => {
  const queue = new WorkspaceMutationQueue()
  const live = new AbortController()
  const cancelled = new AbortController()
  let release!: () => void
  let started!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { started = resolve })
  const seen: string[] = []
  const first = queue.run(live.signal, async () => { seen.push('first'); started(); await blocked; seen.push('first end') })
  await entered
  const second = queue.run(cancelled.signal, async () => { seen.push('cancelled must not run') })
  const rejected = assert.rejects(second, /cancelled/)
  const third = queue.run(live.signal, async () => { seen.push('third') })
  cancelled.abort()
  await rejected
  assert.deepEqual(seen, ['first'])
  release()
  await Promise.all([first, third])
  assert.deepEqual(seen, ['first', 'first end', 'third'])
})
