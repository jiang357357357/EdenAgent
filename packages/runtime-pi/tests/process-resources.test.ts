import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createIsolatedRuntime, RuntimeCancellationError, RuntimeProcessError } from '../src/index.ts'
import type { RuntimeProcessDiagnostic } from '../src/index.ts'
import { resolveProcessPolicy } from '../src/process-policy.ts'
import { callbacks } from './recorded-model.ts'

const model = { provider: 'fixture', id: 'fixture', baseUrl: 'http://127.0.0.1:1', contextWindow: 32000, maxTokens: 2048 }
const entry = new URL('./process-resource-fixture.mjs', import.meta.url)
function fixture(mode: string, records: RuntimeProcessDiagnostic[], maxOldSpaceMb?: number) {
  return createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: mode, model, tools: [],
    callbacks: { ...callbacks().handlers, diagnostic: record => records.push(record) } }, { entry, ...(maxOldSpaceMb ? { maxOldSpaceMb } : {}) })
}

test('process budgets default to 2 GiB/10 seconds and validate config before spawning', () => {
  const defaults = resolveProcessPolicy({}, {})
  assert.equal(defaults.maxOldSpaceMb, 2048); assert.equal(defaults.abortTimeoutMs, 10000)
  assert.equal(resolveProcessPolicy({}, { EDEN_AGENT_RUNTIME_HEAP_MB: '3072' }).maxOldSpaceMb, 3072)
  assert.equal(resolveProcessPolicy({ maxOldSpaceMb: 1024 }, { EDEN_AGENT_RUNTIME_HEAP_MB: '3072' }).maxOldSpaceMb, 1024)
  assert.equal(resolveProcessPolicy({}, { EDEN_AGENT_RUNTIME_ABORT_TIMEOUT_MS: '12000' }).abortTimeoutMs, 12000)
  for (const value of ['', 'zero', '0', '-1', '12.5', '16385'])
    assert.throws(() => resolveProcessPolicy({}, { EDEN_AGENT_RUNTIME_HEAP_MB: value }), /must be an integer/)
  assert.throws(() => resolveProcessPolicy({ abortTimeoutMs: Number.NaN }, {}), /must be an integer/)
})

test('real worker can cross the former 512 MiB heap limit under the new default', { timeout: 15000 }, async t => {
  const records: RuntimeProcessDiagnostic[] = [], runtime = fixture('heap-600m', records)
  t.after(() => runtime.dispose())
  const value = await runtime.prompt('allocate controlled heap') as { heapUsed: number; execArgv: string[] }
  assert.ok(value.heapUsed > 512 * 1024 * 1024)
  assert.ok(value.execArgv.includes('--max-old-space-size=2048'))
  assert.equal(records[0]?.maxOldSpaceMb, 2048)
})

test('exit 134 retains bounded pipe tails and does not claim OOM without evidence', async t => {
  const records: RuntimeProcessDiagnostic[] = [], runtime = fixture('crash-output', records, 96)
  t.after(() => runtime.dispose())
  await assert.rejects(runtime.prompt('crash'), error => error instanceof RuntimeProcessError && error.kind === 'crashed')
  await runtime.dispose()
  const result = records.find(record => record.event === 'runtime.process.failed')!
  assert.equal(result.exitCode, 134); assert.equal(result.kind, 'crashed')
  assert.ok(result.stdoutBytes! > 256 * 1024)
  assert.ok(result.stdoutTail!.length <= 16 * 1024)
  assert.match(result.stdoutTail!, /stdout-final-marker/)
  assert.match(result.stderrTail!, /diagnostic-fatal-marker/)
  assert.ok(result.memory!.heapLimit > 0)
  assert.equal(result.lastMethod, 'prompt')
})

test('actual constrained V8 heap failure produces an OOM diagnostic and leaves the host usable', { timeout: 15000 }, async t => {
  const records: RuntimeProcessDiagnostic[] = [], runtime = fixture('heap-oom', records, 64)
  t.after(() => runtime.dispose())
  await assert.rejects(runtime.prompt('allocate until budget'), RuntimeProcessError)
  await runtime.dispose()
  const result = records.find(record => record.event === 'runtime.process.failed')!
  assert.equal(result.kind, 'out_of_memory')
  assert.match(result.stderrTail!, /heap out of memory|reached heap limit/i)
  const healthy = fixture('info', [], 96); t.after(() => healthy.dispose())
  assert.ok(await healthy.prompt('host still works'))
})

test('cooperative cancellation taking over two seconds now completes without killing the worker', { timeout: 15000 }, async t => {
  const records: RuntimeProcessDiagnostic[] = [], runtime = fixture('slow-abort', records)
  t.after(() => runtime.dispose())
  const work = runtime.prompt('wait'); await delay(150)
  const started = performance.now()
  await runtime.abort(); await work
  assert.ok(performance.now() - started >= 2000)
  assert.ok(await runtime.snapshot())
  assert.equal(records.some(record => record.event === 'runtime.process.failed'), false)
})

test('unresponsive cancellation has a typed cancellation outcome and a bounded forced stop', async t => {
  const records: RuntimeProcessDiagnostic[] = []
  const runtime = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'stall', model, tools: [],
    callbacks: { ...callbacks().handlers, diagnostic: record => records.push(record) } },
    { entry: new URL('./process-fault-fixture.mjs', import.meta.url), abortTimeoutMs: 100 })
  t.after(() => runtime.dispose())
  const task = assert.rejects(runtime.prompt('stall'), error => error instanceof RuntimeCancellationError && error.forced)
  await delay(150); await runtime.abort(); await task; await runtime.dispose()
  assert.equal(records.find(record => record.event === 'runtime.process.cancelled')?.kind, 'cancelled')
})
