import { randomUUID } from 'node:crypto'
import { createIsolatedRuntime } from './process-runtime.ts'
import { TextCompletionError } from './text-completion.ts'
import type { TextCompletionRequest } from './text-completion.ts'

export async function completeTextIsolated(request: TextCompletionRequest): Promise<string> {
  request.signal.throwIfAborted()
  const runtime = createIsolatedRuntime({ sessionId: randomUUID(), model: request.model, systemPrompt: request.systemPrompt,
    tools: [], callbacks: { checkpoint: async () => {}, event: async () => {}, request: request.record } })
  const abort = () => { void runtime.abort().catch(() => undefined) }
  request.signal.addEventListener('abort', abort, { once: true })
  try {
    request.signal.throwIfAborted()
    const result = await runtime.completeText(request.text)
    request.signal.throwIfAborted()
    return result
  } catch (error) {
    request.signal.throwIfAborted()
    if (error instanceof Error && error.name === 'TextCompletionError') throw new TextCompletionError(error.message, { cause: error })
    throw error
  } finally { request.signal.removeEventListener('abort', abort); await runtime.dispose() }
}
