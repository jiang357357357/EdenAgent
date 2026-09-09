import { z } from 'zod'
import { questionAskSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { QuestionService } from './question-service.ts'

export function questionTool(questions: QuestionService, sessionId: string, turnId: string): RuntimeTool {
  return {
    name: 'eden_question', revision: 'eden.question.v1', description: 'Ask the user one to three questions and wait for answers. Provide choices or allow a custom answer. This does not grant tool permissions.',
    parameters: toJson(z.toJSONSchema(questionAskSchema, { io: 'input' })) as Record<string, JsonValue>, executionMode: 'sequential',
    async execute(input, context) { return toJson({ answers: await questions.ask(sessionId, turnId, input, context.signal) }) },
  }
}
