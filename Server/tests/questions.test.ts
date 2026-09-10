import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { QuestionService, questionTool } from '../src/modules/questions/index.ts'
import { QuestionRepository } from '../src/modules/questions/question-repository.ts'
import { questionRoutes } from '../src/transport/rpc/question.routes.ts'
import { questionAskSchema } from '@eden/api'

const ask = { questions: [{ header: 'Format', question: 'Choose output format', options: [{ label: 'JSON', description: 'Structured' }, { label: 'Text', description: 'Plain' }], custom: false }] }

test('the model asks a durable question and continues only after a validated answer commits', async () => {
  const model = await recordedModel([{ tool: 'eden_question', input: ask }, { text: 'Selected JSON' }])
  const db = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(db, 'local')
  const questions = new QuestionService(repository)
  const routes = questionRoutes(questions)
  const sessions = new SessionService(repository, model.config, (sessionId, turnId) => [questionTool(questions, sessionId, turnId)])
  let entered!: () => void
  const requested = new Promise<void>(resolve => { entered = resolve })
  let timer: ReturnType<typeof setTimeout> | undefined
  repository.events.subscribe(event => { if (event.kind === 'question.requested') entered() })
  try {
    const session = repository.create('Questions')
    sessions.start(session.id, 'Ask me')
    await Promise.race([requested, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Question tool did not reach its wait state')), 5000) })])
    clearTimeout(timer)
    const question = questions.list(session.id)[0]!
    assert.equal(model.requests.length, 1)
    await assert.rejects(async () => routes['question.resolve']!({ requestId: question.id, answers: [['Unknown']] }), /listed option/)
    await assert.rejects(async () => routes['question.resolve']!({ requestId: question.id, answers: [['JSON', 'Text']] }), /one answer/)
    db.connection.exec("CREATE TRIGGER reject_answer BEFORE INSERT ON events WHEN NEW.kind='question.resolved' BEGIN SELECT RAISE(ABORT, 'answer disk failure'); END")
    await assert.rejects(async () => routes['question.resolve']!({ requestId: question.id, answers: [['JSON']] }), /answer disk failure/)
    assert.equal(questions.list().length, 1)
    assert.equal(model.requests.length, 1)
    db.connection.exec('DROP TRIGGER reject_answer')
    await routes['question.resolve']!({ requestId: question.id, answers: [['JSON']] })
    await sessions.waitForIdle(session.id)
    assert.equal(sessions.faultCount(), 0)
    assert.deepEqual(await routes['question.list']!({}), [])
    assert.equal(model.requests.length, 2)
    assert.match(JSON.stringify(model.requests[1]), /answers.*JSON/)
    assert.equal(db.connection.prepare('SELECT state FROM question_requests').get()?.state, 'answered')
    await assert.rejects(async () => routes['question.reject']!({ requestId: question.id }), /already resolved/)
  } finally { clearTimeout(timer); await sessions.close(); questions.close(); db.close(); await model.close() }
})

test('question cancellation, rejection and startup recovery leave no live pending requests', async () => {
  const db = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(db, 'mon')
  const session = repository.create('Question recovery')
  const service = new QuestionService(repository)
  try {
    const controller = new AbortController()
    const cancelled = assert.rejects(service.ask(session.id, randomUUID(), ask, controller.signal), /cancelled/)
    controller.abort(); await cancelled
    const rejecting = assert.rejects(service.ask(session.id, randomUUID(), ask, new AbortController().signal), /rejected/)
    service.reject(service.list()[0]!.id); await rejecting
    new QuestionRepository(repository).create(session.id, randomUUID(), questionAskSchema.parse(ask).questions)
    const restored = new QuestionService(repository)
    assert.deepEqual(restored.list(), [])
    assert.deepEqual(db.connection.prepare('SELECT state FROM question_requests ORDER BY rowid').all().map(row => row.state), ['cancelled', 'rejected', 'interrupted'])
    restored.close()
  } finally { service.close(); db.close() }
})

test('a committed answer wins over cancellation triggered by its resolved event', async () => {
  const db = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(db, 'local')
  const service = new QuestionService(repository)
  const session = repository.create('Answer race')
  const controller = new AbortController()
  repository.events.subscribe(event => {
    if (event.kind === 'question.requested') service.resolve(service.list()[0]!.id, [['JSON']])
    if (event.kind === 'question.resolved') controller.abort()
  })
  try {
    assert.deepEqual(await service.ask(session.id, randomUUID(), ask, controller.signal), [['JSON']])
    assert.deepEqual(service.list(), [])
  } finally { service.close(); db.close() }
})
