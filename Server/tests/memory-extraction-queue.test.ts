import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { MemoryExtractionQueue } from '../src/modules/memories/index.ts'
import type { MemoryExtractionJob } from '../src/modules/memories/index.ts'

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check() && Date.now() < deadline) await delay(5)
  assert.ok(check(), 'Queue boundary not reached')
}

function fixture(count: number, fail = false) {
  const pending = new Set(Array.from({ length: count }, (_, index) => String(index + 1)))
  const calls: string[] = []
  const releases = new Map<string, () => void>()
  const errors: string[] = []
  let peak = 0
  const jobs = { queued(after = '0') {
    const ids = [...pending].filter(id => Number(id) > Number(after))
    return { items: ids.slice(0, 1).map(id => ({ id }) as MemoryExtractionJob), nextCursor: ids.length > 1 ? ids[0]! : null }
  } }
  const runner = {
    async run(id: string, signal: AbortSignal) {
      calls.push(id)
      if (fail) throw new Error('Binding missing')
      await new Promise<void>(resolve => {
        const finish = () => { signal.removeEventListener('abort', finish); releases.delete(id); resolve() }
        releases.set(id, finish)
        peak = Math.max(peak, releases.size)
        signal.addEventListener('abort', finish, { once: true })
        if (signal.aborted) finish()
      })
      pending.delete(id)
      return []
    }, async close() {},
  }
  const queue = new MemoryExtractionQueue(jobs, runner, id => { errors.push(id) }, 2)
  return { queue, calls, releases, errors, get peak() { return peak } }
}

test('queue fills bounded slots, continues after completion and coalesces repeated wakes for active jobs', async () => {
  const f = fixture(5)
  try {
    f.queue.wake()
    await until(() => f.calls.length === 2)
    f.queue.wake(); f.queue.wake()
    assert.equal(f.queue.runningCount, 2)
    f.releases.get('1')!()
    await until(() => f.calls.includes('3'))
    f.releases.get('2')!()
    await until(() => f.calls.includes('4'))
    f.releases.get('3')!()
    await until(() => f.calls.includes('5'))
    f.releases.get('4')!(); f.releases.get('5')!()
    await until(() => f.queue.runningCount === 0)
    assert.deepEqual(f.calls, ['1', '2', '3', '4', '5'])
    assert.equal(f.peak, 2)
  } finally { await f.queue.close() }
})

test('unresolved jobs are attempted once per scan and retry only after a new wake', async () => {
  const f = fixture(4, true)
  try {
    f.queue.wake()
    await until(() => f.errors.length === 4)
    await delay(20)
    assert.equal(f.calls.length, 4)
    f.queue.wake()
    await until(() => f.errors.length === 8)
    assert.deepEqual(f.calls, ['1', '2', '3', '4', '1', '2', '3', '4'])
  } finally { await f.queue.close() }
})

test('close drains active jobs and cancels scheduled work without starting the remaining queue', async () => {
  const f = fixture(5)
  f.queue.wake()
  await until(() => f.calls.length === 2)
  await f.queue.close()
  assert.equal(f.queue.runningCount, 0)
  f.queue.wake()
  await delay(10)
  assert.equal(f.calls.length, 2)
  const stopped = fixture(2)
  stopped.queue.wake()
  await stopped.queue.close()
  assert.deepEqual(stopped.calls, [])
})

test('queue read failure is latched and propagated by close instead of silently losing scheduling', async () => {
  const failure = new Error('Queue storage failure')
  const queue = new MemoryExtractionQueue({ queued() { throw failure } }, {
    async run() { assert.fail('Must not execute after read failure') }, async close() {},
  }, () => {})
  queue.wake()
  await until(() => queue.fault === failure)
  await assert.rejects(queue.close(), /Queue storage failure/)
})

test('explicit resumes share capacity and cannot let an already scheduled pump exceed its bound', async () => {
  const f = fixture(3)
  const job = (id: string) => ({ id, sessionId: 'source-session' }) as MemoryExtractionJob
  try {
    f.queue.wake()
    f.queue.resume(job('1'))
    f.queue.resume(job('1'))
    f.queue.resume(job('2'))
    assert.throws(() => f.queue.resume(job('3')), /busy/)
    await until(() => f.calls.length === 2)
    await delay(10)
    assert.equal(f.peak, 2)
    f.releases.get('1')!()
    await until(() => f.calls.includes('3'))
    f.releases.get('2')!(); f.releases.get('3')!()
    await until(() => f.queue.runningCount === 0)
    assert.deepEqual(f.calls, ['1', '2', '3'])
  } finally { await f.queue.close() }
  assert.throws(() => f.queue.resume(job('1')), /closed/)
})
