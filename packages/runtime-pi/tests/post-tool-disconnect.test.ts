import assert from 'node:assert/strict'
import test from 'node:test'
import { createRuntime } from '../src/index.ts'
import { callbacks, recordedModel } from './recorded-model.ts'

test('an upstream stream disconnect after a tool returns a model error while the runtime stays usable', async t => {
  const fixture = await recordedModel([
    { tool: 'effect', input: {} },
    { error: 'terminated', partial: 'PARTIAL_AFTER_TOOL' },
    { text: '下一轮正常回复' },
  ])
  const record = callbacks()
  let executions = 0
  const outcomes: string[] = []
  try {
    const runtime = createRuntime({
      sessionId: 'post-tool-disconnect', systemPrompt: '', model: fixture.config,
      modelRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
      tools: [{ name: 'effect', revision: '1', description: '本地测试工具', parameters: { type: 'object' },
        async execute() { executions++; return { marker: 'TOOL_RESULT_CONFIRMED' } } }],
      callbacks: { ...record.handlers, async afterTool(_callId, _result, _failed, outcome) { outcomes.push(outcome ?? 'missing') } },
    })

    const failed = await runtime.prompt('执行本地测试工具') as Record<string, unknown>
    assert.equal(failed.stopReason, 'error')
    assert.match(String(failed.errorMessage), /terminated|socket|connection/i)
    assert.equal(executions, 1)
    assert.deepEqual(outcomes, ['completed'])
    assert.equal(fixture.requests.length, 2)
    assert.match(JSON.stringify(fixture.requests[1]), /TOOL_RESULT_CONFIRMED/)
    assert.match(JSON.stringify(record.events.filter(event => event.kind === 'model_transport')), /UND_ERR_SOCKET|ECONNRESET/)
    assert.equal(record.events.filter(event => event.kind === 'retry_scheduled' || event.kind === 'model_request_retry').length, 0)
    assert.ok(record.events.some(event => event.kind === 'agent_end'))

    const resumed = await runtime.prompt('继续回答') as Record<string, unknown>
    assert.equal(resumed.stopReason, 'stop')
    assert.equal(fixture.requests.length, 3)
    assert.equal(executions, 1)
    assert.match(JSON.stringify(fixture.requests[2]), /TOOL_RESULT_CONFIRMED/)
    t.diagnostic(JSON.stringify({ firstStopReason: failed.stopReason, error: failed.errorMessage,
      nextStopReason: resumed.stopReason, requests: fixture.requests.length, toolExecutions: executions,
      toolOutcome: outcomes[0], agentEndEvents: record.events.filter(event => event.kind === 'agent_end').length }))
  } finally { await fixture.close() }
})
