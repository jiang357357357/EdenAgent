import { createModels, createProvider } from '@earendil-works/pi-ai'
import type { Api, Model, Models } from '@earendil-works/pi-ai'
import type { StreamOptions } from '@earendil-works/pi-ai'
import { toJson, configuredModelSchema } from '@eden/api'
import type { JsonValue } from '@eden/api'
import * as completions from '@earendil-works/pi-ai/api/openai-completions'
import type { RuntimeModel } from './contracts.ts'
import { randomUUID } from 'node:crypto'
import { durableResponseStream } from './response-stream.ts'

interface RequestControl { record(snapshot: JsonValue): Promise<void>; signal(): AbortSignal; response?(snapshot: JsonValue): Promise<void>; failed?(error: unknown): void }

export function createRuntimeModels(config: RuntimeModel, control: RequestControl): { models: Models; model: Model<'openai-completions'> } {
  configuredModelSchema.parse(config)
  const model: Model<'openai-completions'> = {
    id: config.id, name: config.id, api: 'openai-completions', provider: config.provider,
    baseUrl: config.baseUrl, reasoning: config.reasoning !== undefined && config.reasoning !== 'off', input: ['text', 'image'],
    cost: config.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow, maxTokens: config.maxTokens,
  }
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } })
  const observe = (start: (scoped: RequestControl) => ReturnType<typeof completions.stream>) => {
    const requestId = randomUUID()
    let admitted = false
    const source = start({ ...control, async record(snapshot) {
      await control.record(toJson({ ...(snapshot as Record<string, JsonValue>), requestId }))
      admitted = true
    } })
    return durableResponseStream(source, model, async message => {
      if (admitted) await control.response?.(toJson({ requestId, message, costConfigured: config.cost !== undefined }))
    }, error => control.failed?.(error))
  }
  models.setProvider(createProvider<'openai-completions'>({
    id: config.provider, models: [model], api: {
      stream: (selected, context, options) => { assertCompletions(selected); return observe(scoped => completions.stream(selected, context, controlledOptions(options, scoped, context.tools, config.cost !== undefined))) },
      streamSimple: (selected, context, options) => { assertCompletions(selected); return observe(scoped => completions.streamSimple(selected, context, controlledOptions(options, scoped, context.tools, config.cost !== undefined))) },
    },
    auth: { apiKey: { name: 'Eden configured credential', resolve: async () => ({ auth: { apiKey: config.apiKey ?? 'local' }, source: 'eden' }) } },
  }))
  return { models, model }
}

function assertCompletions(model: Model<Api>): asserts model is Model<'openai-completions'> {
  if (model.api !== 'openai-completions') throw new Error('Unexpected model API in completions provider')
}

function controlledOptions<T extends StreamOptions>(options: T | undefined, control: RequestControl, definitions: unknown, costConfigured: boolean): T & StreamOptions {
  return {
    ...options, maxRetries: 0,
    signal: AbortSignal.any([control.signal(), ...(options?.signal ? [options.signal] : [])]),
    async onPayload(payload, model) {
      const changed = await options?.onPayload?.(payload, model)
      const actual = changed === undefined ? payload : changed
      await control.record(toJson({ model: model.id, provider: model.provider, payload: actual, tools: definitions ?? [], costConfigured }))
      return actual
    },
  } as T & StreamOptions
}
