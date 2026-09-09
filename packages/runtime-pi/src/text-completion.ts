import type { JsonValue } from '@eden/api'
import type { RuntimeModel } from './contracts.ts'
import { createRuntimeModels } from './model-provider.ts'

export interface TextCompletionRequest {
  model: RuntimeModel
  systemPrompt: string
  text: string
  signal: AbortSignal
  record(snapshot: JsonValue): Promise<void>
}

export class TextCompletionError extends Error {}

export async function completeText(request: TextCompletionRequest): Promise<string> {
  request.signal.throwIfAborted()
  let recordingFailed = false
  let recordingError: unknown
  const { models, model } = createRuntimeModels(request.model, {
    signal: () => request.signal,
    async record(snapshot) {
      request.signal.throwIfAborted()
      try { await request.record(snapshot) }
      catch (error) { recordingFailed = true; recordingError = error; throw error }
    },
  })
  const response = await models.completeSimple(model, {
    systemPrompt: request.systemPrompt,
    messages: [{ role: 'user', content: request.text, timestamp: Date.now() }], tools: [],
  }, { maxTokens: request.model.maxTokens, temperature: 0, maxRetries: 0 }).catch(error => {
    if (recordingFailed) throw new Error('Model request persistence failed', { cause: recordingError })
    request.signal.throwIfAborted()
    throw new TextCompletionError('Model text request failed', { cause: error })
  })
  if (recordingFailed) throw new Error('Model request persistence failed', { cause: recordingError })
  request.signal.throwIfAborted()
  if (response.stopReason !== 'stop') throw new TextCompletionError('Model did not complete a text response')
  if (response.content.some(block => block.type !== 'text')) throw new TextCompletionError('Model returned non-text content')
  return response.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}
