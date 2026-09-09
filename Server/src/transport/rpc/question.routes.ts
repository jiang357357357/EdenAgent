import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import { questionListSchema, questionResolveSchema, questionIdSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { QuestionService } from '../../modules/questions/index.ts'

export function questionRoutes(questions: QuestionService): Record<string, (params: JsonValue) => JsonValue | Promise<JsonValue>> {
  const handlers: Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> = {
    'question.list': params => toJson(questions.list(questionListSchema.parse(params).sessionId ?? undefined)),
    'question.resolve': params => { const value = questionResolveSchema.parse(params); return toJson(questions.resolve(value.requestId, value.answers)) },
    'question.reject': params => toJson(questions.reject(questionIdSchema.parse(params).requestId)),
  }
  return Object.fromEntries(Object.entries(handlers).map(([method, handler]) => {
    const contract = rpcMethods[method as keyof typeof rpcMethods]
    return [method, contractHandler(contract, input => handler(toJson(input)))]
  }))
}
