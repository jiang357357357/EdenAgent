import { questionListSchema, questionResolveSchema, questionIdSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { QuestionService } from '../../modules/questions/index.ts'

export function questionRoutes(questions: QuestionService): Record<string, (params: JsonValue) => JsonValue> {
  return {
    'question.list': params => toJson(questions.list(questionListSchema.parse(params).sessionId ?? undefined)),
    'question.resolve': params => { const value = questionResolveSchema.parse(params); return toJson(questions.resolve(value.requestId, value.answers)) },
    'question.reject': params => toJson(questions.reject(questionIdSchema.parse(params).requestId)),
  }
}
