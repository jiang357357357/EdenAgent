import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createRuntime, removeCheckpointMessages } from '../src/index.ts'
import { recordedModel } from './recorded-model.ts'
import { compactionRecording, largeHistory, progressEntries } from './compaction-history-fixture.ts'

test('5,828 stored entries compact across more than 32 model requests without losing original entries or the new input', async () => {
  const model = await recordedModel(Array.from({ length: 128 }, () => ({ text: 'SUMMARY: retain task facts' })))
  const record = compactionRecording(), checkpoint = largeHistory('large-5828', 5828)
  try {
    const runtime = createRuntime({ sessionId: checkpoint.sessionId, checkpoint, systemPrompt: '',
      model: { ...model.config, contextWindow: 10000 }, tools: [], callbacks: record.handlers })
    await runtime.prompt('CURRENT_INPUT_MARKER')
    assert.ok(model.requests.length > 33)
    assert.ok(model.requests.length < 128)
    assert.match(JSON.stringify(model.requests.at(-1)), /CURRENT_INPUT_MARKER/)
    assert.match(JSON.stringify(model.requests.at(-1)), /SUMMARY: retain task facts/)
    const result = await runtime.snapshot()
    assert.ok(result.entries.length > checkpoint.entries.length)
    assert.equal(result.entries.filter(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction').length, 1)
    assert.ok(progressEntries(result).length > 32)
    assert.deepEqual(result.entries.slice(0, checkpoint.entries.length), checkpoint.entries)
    assert.ok(record.events.some(e => e.kind === 'compaction_progress' && e.payload && typeof e.payload === 'object'
      && !Array.isArray(e.payload) && e.payload.processed === e.payload.total))
  } finally { await model.close() }
})

test('exhausting the existing turn request budget preserves progress that a restarted runtime resumes', async () => {
  const model = await recordedModel(Array.from({ length: 128 }, () => ({ text: 'SAVED_PROGRESS_SUMMARY' })))
  const record = compactionRecording(), checkpoint = largeHistory('compaction-resume', 2400)
  const config = { ...model.config, contextWindow: 8000 }
  try {
    const initial = createRuntime({ sessionId: checkpoint.sessionId, checkpoint, systemPrompt: '',
      model: config, tools: [], callbacks: record.handlers, maxModelRequests: 4 })
    await initial.prompt('First current input').catch(() => undefined)
    assert.equal(model.requests.length, 4)
    const interrupted = record.snapshot()
    assert.ok(progressEntries(interrupted).length > 0)
    assert.ok(!interrupted.entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction'))
    const resumedRecord = compactionRecording()
    const restored = createRuntime({ sessionId: checkpoint.sessionId, checkpoint: interrupted, systemPrompt: '',
      model: config, tools: [], callbacks: resumedRecord.handlers })
    await restored.prompt('Retry without repeating old summaries')
    const firstAfterRestart = JSON.stringify(model.requests[4])
    assert.match(firstAfterRestart, /SAVED_PROGRESS_SUMMARY/)
    assert.doesNotMatch(firstAfterRestart, /ITEM_0\b/)
    assert.ok(resumedRecord.events.some(e => e.kind === 'compaction_progress' && e.payload && typeof e.payload === 'object'
      && !Array.isArray(e.payload) && e.payload.resumed === true && Number(e.payload.processed) > 0))
    assert.ok((await restored.snapshot()).entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction'))
  } finally { await model.close() }
})

test('editing a summarized prefix invalidates saved work rather than reusing an unrelated summary', async () => {
  const model = await recordedModel(Array.from({ length: 128 }, () => ({ text: 'OLD_PREFIX_SUMMARY' })))
  const record = compactionRecording(), checkpoint = largeHistory('changed-prefix', 900)
  const config = { ...model.config, contextWindow: 8000 }
  try {
    const initial = createRuntime({ sessionId: checkpoint.sessionId, checkpoint, systemPrompt: '', model: config,
      tools: [], callbacks: record.handlers, maxModelRequests: 1 })
    await initial.prompt('Initial current input').catch(() => undefined)
    const edited = structuredClone(record.snapshot())
    const first = edited.entries[0] as { message: { content: string } }
    first.message.content = 'EDITED_PREFIX_FACT'
    const restored = createRuntime({ sessionId: checkpoint.sessionId, checkpoint: edited, systemPrompt: '',
      model: config, tools: [], callbacks: compactionRecording().handlers })
    await restored.prompt('Continue with the edited history')
    assert.match(JSON.stringify(model.requests[1]), /EDITED_PREFIX_FACT/)
    assert.doesNotMatch(JSON.stringify(model.requests[1]), /OLD_PREFIX_SUMMARY/)
  } finally { await model.close() }
})

test('deleting historical context also removes intermediate summaries that may contain the deleted material', async () => {
  const model = await recordedModel([{ text: 'INTERMEDIATE_PRIVATE_SUMMARY' }])
  const record = compactionRecording(), checkpoint = largeHistory('delete-progress', 900)
  try {
    const runtime = createRuntime({ sessionId: checkpoint.sessionId, checkpoint, systemPrompt: '',
      model: { ...model.config, contextWindow: 8000 }, tools: [], callbacks: record.handlers, maxModelRequests: 1 })
    await runtime.prompt('Current input').catch(() => undefined)
    assert.ok(progressEntries(record.snapshot()).length)
    const clean = removeCheckpointMessages(record.snapshot(), { matchesMessage: (_message, entryId) => entryId === 'history-1',
      projectHistory: history => history, invalidateSummariesBefore: Date.now() + 1000 })
    assert.equal(progressEntries(clean).length, 0)
    assert.doesNotMatch(JSON.stringify(clean), /INTERMEDIATE_PRIVATE_SUMMARY/)
  } finally { await model.close() }
})

test('manual compaction uses the same resumable bounded-input path for oversized history', async () => {
  const model = await recordedModel(Array.from({ length: 128 }, () => ({ text: 'MANUAL_HISTORY_SUMMARY' })))
  const record = compactionRecording(), checkpoint = largeHistory('manual-large', 3000)
  try {
    const runtime = createRuntime({ sessionId: checkpoint.sessionId, checkpoint, systemPrompt: '',
      model: { ...model.config, contextWindow: 8000 }, tools: [], callbacks: record.handlers })
    await runtime.compact()
    assert.ok(model.requests.length > 32)
    const result = await runtime.snapshot()
    assert.ok(result.entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction'))
    assert.deepEqual(result.entries.slice(0, checkpoint.entries.length), checkpoint.entries)
    assert.ok(model.requests.every(request => JSON.stringify(request).length < 40000))
  } finally { await model.close() }
})

test('cancelling a later batch retains finished summaries and a new runtime resumes after the saved prefix', async () => {
  const model = await recordedModel([{ text: 'CANCEL_RESUME_SUMMARY' }, { text: 'CANCEL_RESUME_SUMMARY' },
    { text: 'CANCEL_RESUME_SUMMARY' }, { wait: true }, ...Array.from({ length: 40 }, () => ({ text: 'CANCEL_RESUME_SUMMARY' }))])
  const record = compactionRecording(), checkpoint = largeHistory('cancel-resume', 900)
  const config = { ...model.config, contextWindow: 8000 }
  try {
    const runtime = createRuntime({ sessionId: checkpoint.sessionId, checkpoint, systemPrompt: '',
      model: config, tools: [], callbacks: record.handlers })
    const running = runtime.prompt('Current input before cancellation').catch(() => undefined)
    for (let index = 0; index < 400 && model.requests.length < 4; index++) await delay(5)
    assert.equal(model.requests.length, 4)
    await runtime.abort(); await running
    const partial = record.snapshot()
    assert.equal(progressEntries(partial).length, 3)
    const resumed = createRuntime({ sessionId: checkpoint.sessionId, checkpoint: partial, systemPrompt: '',
      model: config, tools: [], callbacks: compactionRecording().handlers })
    await resumed.prompt('Continue the saved compaction')
    assert.match(JSON.stringify(model.requests[4]), /CANCEL_RESUME_SUMMARY/)
    assert.doesNotMatch(JSON.stringify(model.requests[4]), /ITEM_0\b/)
    assert.ok((await resumed.snapshot()).entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction'))
  } finally { await model.close() }
})
