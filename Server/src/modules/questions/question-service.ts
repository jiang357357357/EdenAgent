import { questionAskSchema, questionResolveSchema } from '@eden/api'
import type { QuestionItem } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
import { QuestionRepository } from './question-repository.ts'

interface Waiter { resolve(answers: string[][]): void; reject(error: unknown): void }

export class QuestionService {
  private readonly repository: QuestionRepository
  private readonly pending = new Map<string, Waiter>()
  private closed = false
  constructor(sessions: SessionRepository) {
    this.repository = new QuestionRepository(sessions)
    for (const request of this.repository.pending()) this.finish(request.id, 'interrupted')
  }

  async ask(sessionId: string, turnId: string, raw: unknown, signal: AbortSignal): Promise<string[][]> {
    if (this.closed) throw new Error('Question service is shutting down')
    signal.throwIfAborted()
    const { questions } = questionAskSchema.parse(raw)
    validateQuestions(questions)
    const { request, event } = this.repository.create(sessionId, turnId, questions)
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener('abort', abort); this.pending.delete(request.id) }
      const abort = () => {
        try { this.finish(request.id, 'cancelled') }
        catch (error) { cleanup(); reject(error) }
      }
      this.pending.set(request.id, { resolve: answers => { cleanup(); resolve(answers) }, reject: error => { cleanup(); reject(error) } })
      signal.addEventListener('abort', abort, { once: true })
      this.repository.sessions.events.publish(event)
      if (signal.aborted && this.pending.has(request.id)) abort()
    })
  }

  list(sessionId?: string) { return this.repository.pending(sessionId) }

  resolve(id: string, rawAnswers: string[][]) {
    const answers = questionResolveSchema.parse({ requestId: id, answers: rawAnswers }).answers
    const request = this.repository.read(id)
    if (answers.length !== request.questions.length) throw new Error('Answer every question in this request')
    for (const [index, question] of request.questions.entries()) {
      const selected = answers[index]!
      if (!question.multiple && selected.length !== 1) throw new Error('This question accepts one answer')
      if (new Set(selected).size !== selected.length) throw new Error('Duplicate question answer')
      if (!question.custom && selected.some(answer => !question.options.some(option => option.label === answer))) throw new Error('Answer must match a listed option')
    }
    return this.finish(id, 'answered', answers)
  }

  reject(id: string) { return this.finish(id, 'rejected') }

  private finish(id: string, state: 'answered' | 'rejected' | 'cancelled' | 'interrupted', answers?: string[][]) {
    const { request, event } = this.repository.finish(id, state, answers)
    const waiter = this.pending.get(id)
    if (state === 'answered') waiter?.resolve(answers!)
    else waiter?.reject(new Error(`Question ${state}`))
    this.repository.sessions.events.publish(event)
    return request
  }

  close(): void {
    this.closed = true
    const failures: unknown[] = []
    for (const [id, waiter] of this.pending) {
      try { this.finish(id, 'interrupted') }
      catch (error) { waiter.reject(error); failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Question shutdown persistence failed')
  }
}

function validateQuestions(questions: QuestionItem[]): void {
  for (const question of questions) {
    if (!question.custom && !question.options.length) throw new Error('A question requires options or a custom answer')
    if (new Set(question.options.map(option => option.label)).size !== question.options.length) throw new Error('Duplicate question option')
  }
}
