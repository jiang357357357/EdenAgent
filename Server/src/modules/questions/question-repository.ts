import { randomUUID } from 'node:crypto'
import { questionAskSchema, toJson } from '@eden/api'
import type { QuestionItem, QuestionRequest } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'

export class QuestionRepository {
  constructor(readonly sessions: SessionRepository) {}

  create(sessionId: string, turnId: string, questions: QuestionItem[]) {
    this.sessions.read(sessionId)
    const request: QuestionRequest = { id: randomUUID(), sessionId, turnId, state: 'pending', questions, createdAt: Date.now() }
    const event = this.sessions.database.transaction(() => {
      const count = this.sessions.database.connection.prepare("SELECT COUNT(*) AS count FROM question_requests WHERE session_id=? AND state='pending'").get(sessionId)
      if (Number(count?.count) >= 64) throw new Error('Too many pending questions in this session')
      this.sessions.database.connection.prepare('INSERT INTO question_requests VALUES (?, ?, ?, ?, ?, NULL, ?, NULL)')
        .run(request.id, sessionId, turnId, request.state, JSON.stringify(questions), request.createdAt)
      return this.sessions.events.insert(sessionId, turnId, 'question.requested', toJson(request))
    })
    return { request, event }
  }

  read(id: string): QuestionRequest {
    const row = this.sessions.database.connection.prepare('SELECT * FROM question_requests WHERE id=?').get(id)
    if (!row) throw new Error('Question request not found')
    return { id: String(row.id), sessionId: String(row.session_id), turnId: String(row.turn_id), state: String(row.state),
      questions: questionAskSchema.parse({ questions: JSON.parse(String(row.questions_json)) }).questions, createdAt: Number(row.created_at) }
  }

  pending(sessionId?: string): QuestionRequest[] {
    if (sessionId) this.sessions.read(sessionId)
    return this.sessions.database.connection.prepare("SELECT id FROM question_requests WHERE state='pending' AND (? IS NULL OR session_id=?) ORDER BY created_at, id")
      .all(sessionId ?? null, sessionId ?? null).map(row => this.read(String(row.id)))
  }

  finish(id: string, state: 'answered' | 'rejected' | 'cancelled' | 'interrupted', answers?: string[][]) {
    const result = this.sessions.database.transaction(() => {
      const request = this.read(id)
      if (request.state !== 'pending') throw new Error('Question request already resolved')
      this.sessions.database.connection.prepare('UPDATE question_requests SET state=?, answers_json=?, resolved_at=? WHERE id=?')
        .run(state, answers ? JSON.stringify(answers) : null, Date.now(), id)
      const event = this.sessions.events.insert(request.sessionId, request.turnId, 'question.resolved', toJson({ requestId: id, state, answers }))
      return { request: { ...request, state }, event }
    })
    return result
  }
}
