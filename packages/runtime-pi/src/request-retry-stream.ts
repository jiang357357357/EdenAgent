import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { AssistantMessage, AssistantMessageEventStream, Model } from '@earendil-works/pi-ai'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { modelRetryDelay, retryableModelFailure, waitForModelRetry } from './model-retry.ts'
import type { ModelRetryPolicy } from './model-retry.ts'

export function requestRetryStream(start: (attempt: number) => AssistantMessageEventStream, policy: ModelRetryPolicy,
  model: Model<'openai-completions'>, signal: AbortSignal, failed: (error: unknown) => void, event: (kind: string, payload: JsonValue) => Promise<void>): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream()
  void (async () => {
    let last: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: Date.now(), stopReason: 'error' }
    try {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted()
        let emittedContent = false
        let retry = false
        for await (const item of start(attempt)) {
          if ('partial' in item) last = item.partial
          if (item.type !== 'done' && item.type !== 'error') {
            if (item.type !== 'start') emittedContent = true
            output.push(item); continue
          }
          last = item.type === 'done' ? item.message : item.error
          const error = retryableModelFailure(toJson(last))
          if (canRetry(error, emittedContent, signal)) {
            if (attempt < policy.maxRetries) {
              const delayMs = modelRetryDelay(policy, attempt + 1)
              await event('model_request_retry', { attempt: attempt + 1, maxRetries: policy.maxRetries, delayMs })
              await waitForModelRetry(delayMs, signal)
              retry = true; break
            }
            // The turn-level fallback must not multiply this request's retry budget.
            last = { ...last, errorMessage: `${last.errorMessage} [request retries exhausted]` }
          }
          if (attempt) await event('model_request_retry_finished', { attempts: attempt + 1, success: item.type === 'done' })
          output.push(item.type === 'done' ? { ...item, message: last } : { ...item, error: last })
          output.end(last); return
        }
        if (!retry) throw new Error('Provider stream ended without terminal result')
      }
    } catch (error) {
      const message = failedMessage(last, signal, error, failed)
      output.push({ type: 'error', reason: message.stopReason as 'aborted' | 'error', error: message }); output.end(message)
    }
  })()
  return output
}

function canRetry(error: string | undefined, emittedContent: boolean, signal: AbortSignal): boolean {
  return Boolean(error) && !emittedContent && !signal.aborted
}

function failedMessage(last: AssistantMessage, signal: AbortSignal, error: unknown, failed: (error: unknown) => void): AssistantMessage {
  if (!signal.aborted) failed(error)
  return { ...last, stopReason: signal.aborted ? 'aborted' : 'error',
    errorMessage: signal.aborted ? 'Request aborted' : 'Model retry logging failed; inspect persistence' }
}
