import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { QuestionService } from '../src/modules/questions/index.ts'
import { wireEvent } from '../src/transport/rpc/session.routes.ts'

test('existing frontend replays pending questions and removes answered and rejected requests', async () => {
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const questions = new QuestionService(sessions)
  const session = sessions.create('Question frontend')
  const script = fileURLToPath(new URL('../../Script/Project/verify_director_frontend.mjs', import.meta.url))
  const replay = () => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', script], {
    input: JSON.stringify({ sessionId: session.id, output: 'questions', events: sessions.events.list(session.id).map(wireEvent) }),
    encoding: 'utf8', timeout: 15000,
  }))
  const ask = { questions: [{ header: 'Output', question: 'Which format?', options: [{ label: 'JSON' }], custom: false }] }
  try {
    const waiting = questions.ask(session.id, randomUUID(), ask, new AbortController().signal)
    const request = questions.list()[0]!
    const pending = replay()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].id, request.id)
    assert.equal(pending[0].sessionID, session.id)
    assert.equal(pending[0].questions[0].question, 'Which format?')
    questions.resolve(request.id, [['JSON']]); await waiting
    assert.deepEqual(replay(), [])
    const rejected = assert.rejects(questions.ask(session.id, randomUUID(), ask, new AbortController().signal), /rejected/)
    questions.reject(questions.list()[0]!.id); await rejected
    assert.deepEqual(replay(), [])
  } finally { questions.close(); db.close() }
})
