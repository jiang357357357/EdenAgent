import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { AssistantMessage, AssistantMessageEventStream, Model } from '@earendil-works/pi-ai'

/** Persist every provider completion, including compaction, before the harness sees it. */
export function durableResponseStream(source: AssistantMessageEventStream, model: Model<'openai-completions'>,
  record: (message: AssistantMessage) => Promise<void>, failed: (error: unknown) => void): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream()
  let last: AssistantMessage | undefined
  void (async () => {
    try {
      for await (const event of source) {
        if ('partial' in event) last = event.partial
        if (event.type === 'done' || event.type === 'error') {
          const message = event.type === 'done' ? event.message : event.error
          last = message
          await record(message)
          output.push(event)
          output.end(message)
          return
        }
        output.push(event)
      }
      throw new Error('Provider stream ended without a terminal response')
    } catch (error) {
      failed(error)
      const message: AssistantMessage = { ...(last ?? { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() }),
        stopReason: 'error', errorMessage: 'Model response could not be durably recorded; inspect request recovery before continuing' }
      output.push({ type: 'error', reason: 'error', error: message })
      output.end(message)
    }
  })()
  return output
}
