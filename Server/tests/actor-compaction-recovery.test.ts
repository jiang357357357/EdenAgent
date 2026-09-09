import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { ActorExecutionService, ActorCompactionService } from '../src/modules/actors/index.ts'
import { parseDirectorPlan } from '../src/modules/director/index.ts'

test('both actors use their durable compaction summaries after closing and reopening the database', async () => {
  const first = await recordedModel([{ text: 'First long answer '.repeat(500) }, { text: 'FIRST_SAVED_SUMMARY' }, { text: 'First resumed' }])
  const second = await recordedModel([{ text: 'Second long answer '.repeat(500) }, { text: 'SECOND_SAVED_SUMMARY' }, { text: 'Second resumed' }])
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-actor-summary-'))
  const file = path.join(root, 'runtime.db')
  let db = new EdenDatabase(file, 'mon')
  let sessions = new SessionRepository(db, 'mon')
  let actors = new ActorExecutionService(sessions)
  const session = sessions.create('Recover summaries')
  const models = new Map([['1', first.config], ['2', second.config]])
  const input = { id: randomUUID(), sessionId: session.id, turnId: randomUUID(), text: 'Long context '.repeat(500), state: 'running' }
  const signal = new AbortController().signal
  try {
    for (const [assistantId, model] of models) {
      const participant = { assistantId }
      await actors.execute({ input, plan: parseDirectorPlan('{}', [participant], 'test'), beatIndex: 0,
        participant, model, tools: [], conversation: [], signal })
    }
    await actors.close()
    await new ActorCompactionService(sessions).compact({ ...input, id: randomUUID(), turnId: randomUUID(), text: 'Summarize', kind: 'compact' }, models, signal)
    db.close()
    db = new EdenDatabase(file, 'mon')
    sessions = new SessionRepository(db, 'mon')
    actors = new ActorExecutionService(sessions)
    for (const [assistantId, model] of models) {
      const participant = { assistantId }
      await actors.execute({ input: { ...input, id: randomUUID(), turnId: randomUUID(), text: 'Continue after restart' },
        plan: parseDirectorPlan('{}', [participant], 'test'), beatIndex: 0, participant, model, tools: [], conversation: [], signal })
    }
    assert.equal(first.requests.length, 3)
    assert.equal(second.requests.length, 3)
    assert.match(JSON.stringify(first.requests[2]?.messages), /FIRST_SAVED_SUMMARY/)
    assert.doesNotMatch(JSON.stringify(first.requests[2]?.messages), /SECOND_SAVED_SUMMARY/)
    assert.match(JSON.stringify(second.requests[2]?.messages), /SECOND_SAVED_SUMMARY/)
    assert.doesNotMatch(JSON.stringify(second.requests[2]?.messages), /FIRST_SAVED_SUMMARY/)
  } finally { await actors.close(); db.close(); await Promise.all([first.close(), second.close()]); await rm(root, { recursive: true, force: true }) }
})
