import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createIsolatedRuntime, completeTextIsolated } from '../src/index.ts'
import { TextCompletionError } from '../src/text-completion.ts'
import { callbacks, recordedModel } from './recorded-model.ts'
import type { RuntimeTool } from '../src/contracts.ts'

test('process tools preserve authenticated context, resolved identity, projected results and durable ordering', async t => {
  const model = await recordedModel([{ tool: 'discover', input: { value: 'hello' } }, { text: 'done' }])
  t.after(() => model.close())
  const captured = callbacks(), order: string[] = []
  const context = new AsyncLocalStorage<string>()
  let executions = 0
  const target: RuntimeTool = { name: 'actual_write', description: 'fixture', revision: 'revision2',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
    modelResult: () => ({ projected: true }),
    async execute(input) {
      assert.equal(context.getStore(), 'account-A')
      assert.equal(input.value, 'hello')
      order.push('execute'); executions++
      return { privateResult: true }
    },
  }
  const runtime = context.run('account-A', () => createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'fixture',
    model: model.config, tools: [{ ...target, name: 'discover', resolveCall: input => ({ tool: target, input }) }],
    callbacks: { ...captured.handlers,
      beforeTool: async (name, id, revision) => { assert.equal(name, 'actual_write'); assert.equal(revision, 'revision2'); assert.match(id, /^prefix:/); order.push('before') },
      afterTool: async (_id, result, failed) => { assert.deepEqual(result, { privateResult: true }); assert.equal(failed, false); order.push('after') },
    }, toolCallPrefix: 'prefix:',
  }))
  t.after(() => runtime.dispose())
  await runtime.prompt('run')
  assert.equal(executions, 1)
  assert.deepEqual(order, ['before', 'execute', 'after'])
  assert.ok(captured.checkpoints.length > 0)
  assert.match(JSON.stringify(model.requests[1]), /projected/)
  assert.doesNotMatch(JSON.stringify(model.requests[1]), /privateResult/)
  assert.ok((await runtime.snapshot()).entries.length > 0)
})

test('stalled child is interrupted while another real runtime and host timer progress', async t => {
  const model = await recordedModel([{ text: 'healthy peer' }])
  t.after(() => model.close())
  const stalled = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'stall', model: model.config, tools: [], callbacks: callbacks().handlers },
    { entry: new URL('./process-fault-fixture.mjs', import.meta.url), heartbeatTimeoutMs: 300, startupTimeoutMs: 10_000 })
  const healthy = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'fixture', model: model.config, tools: [], callbacks: callbacks().handlers })
  t.after(async () => { await Promise.all([stalled.dispose(), healthy.dispose()]) })
  const interrupted = assert.rejects(stalled.prompt('stall'), /stopped responding/)
  let ticks = 0
  const interval = setInterval(() => ticks++, 20)
  try { await Promise.all([interrupted, healthy.prompt('continue')]) }
  finally { clearInterval(interval) }
  assert.ok(ticks >= 5)
  assert.equal(model.requests.length, 1)
})

test('crashed child rejects only its turn and a new runtime remains usable', async t => {
  const model = await recordedModel([{ text: 'recovered peer' }])
  t.after(() => model.close())
  const broken = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'crash', model: model.config, tools: [], callbacks: callbacks().handlers },
    { entry: new URL('./process-fault-fixture.mjs', import.meta.url) })
  const peer = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'fixture', model: model.config, tools: [], callbacks: callbacks().handlers })
  t.after(async () => { await Promise.all([broken.dispose(), peer.dispose()]) })
  await assert.rejects(broken.prompt('crash'), /exited \(23\)/)
  await peer.prompt('continue')
  assert.equal(model.requests.length, 1)
})

test('tool persistence failure faults the child turn without repeating a completed side effect', async t => {
  const model = await recordedModel([{ tool: 'write_once', input: {} }, { text: 'must not request' }])
  t.after(() => model.close())
  let writes = 0
  const runtime = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'fixture', model: model.config,
    tools: [{ name: 'write_once', description: 'fixture', revision: '1', parameters: { type: 'object', properties: {} },
      async execute() { writes++; return { written: true } } }],
    callbacks: { ...callbacks().handlers, afterTool: async () => { throw new Error('fixture durable commit failed') } },
  })
  t.after(() => runtime.dispose())
  await assert.rejects(runtime.prompt('run'), /persistence failed|durable commit failed/)
  assert.equal(writes, 1)
  assert.equal(model.requests.length, 1)
})

test('cancelling a model wait is local to its process', async t => {
  const waitingModel = await recordedModel([{ wait: true }]), peerModel = await recordedModel([{ text: 'done' }])
  t.after(async () => { await Promise.all([waitingModel.close(), peerModel.close()]) })
  const waiting = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'fixture', model: waitingModel.config, tools: [], callbacks: callbacks().handlers })
  const peer = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: 'fixture', model: peerModel.config, tools: [], callbacks: callbacks().handlers })
  t.after(async () => { await Promise.all([waiting.dispose(), peer.dispose()]) })
  const task = waiting.prompt('wait').catch(error => error)
  for (let attempt = 0; waitingModel.requests.length === 0 && attempt < 200; attempt++) await delay(20)
  assert.equal(waitingModel.requests.length, 1)
  await waiting.abort()
  await task
  await peer.prompt('continue')
  assert.equal(peerModel.requests.length, 1)
})

test('auxiliary text completion runs in a child and preserves domain failures', async t => {
  const model = await recordedModel([{ text: 'title' }, { tool: 'unexpected', input: {} }])
  t.after(() => model.close())
  let records = 0
  const request = { model: model.config, systemPrompt: 'fixture', text: 'title', signal: new AbortController().signal,
    record: async () => { records++ } }
  assert.equal(await completeTextIsolated(request), 'title')
  await assert.rejects(completeTextIsolated(request), TextCompletionError)
  assert.equal(records, 2)
})
