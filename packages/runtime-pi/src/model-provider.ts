import { isDeepSeek, samplingPayload } from './sampling-parameters.ts'
import { createModels, createProvider } from '@earendil-works/pi-ai'
import type { Api, Model, Models } from '@earendil-works/pi-ai'
import type { StreamOptions } from '@earendil-works/pi-ai'
import { toJson, configuredModelSchema } from '@eden/api'
import type { JsonValue } from '@eden/api'
import * as completions from '@earendil-works/pi-ai/api/openai-completions'
import type { RuntimeModel } from './contracts.ts'
import { createHash, randomUUID } from 'node:crypto'
import { requestRetryStream } from './request-retry-stream.ts'
import { defaultModelRetryPolicy } from './model-retry.ts'
import type { ModelRetryPolicy } from './model-retry.ts'
import { observeTransport, type TransportDiagnostics } from './model-transport-diagnostics.ts'
import { durableResponseStream } from './response-stream.ts'

interface RequestControl { record(snapshot: JsonValue): Promise<void>; signal(): AbortSignal; response?(snapshot: JsonValue): Promise<void>; failed?(error: unknown): void; event?(kind: string, payload: JsonValue): Promise<void>; retry?: ModelRetryPolicy; diagnostics?: TransportDiagnostics }

export function createRuntimeModels(config: RuntimeModel, control: RequestControl, sessionId: string = randomUUID()): { models: Models; model: Model<'openai-completions'> } {
  configuredModelSchema.parse(config)
  const model: Model<'openai-completions'> = {
    id: config.id, name: config.id, api: 'openai-completions', provider: config.provider,
    baseUrl: config.baseUrl, reasoning: config.reasoning !== undefined && (config.reasoning !== 'off' || isDeepSeek(config)), input: ['text', 'image'],
    cost: config.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow, maxTokens: config.maxTokens,
    ...(isDeepSeek(config) ? { thinkingLevelMap: { minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'high', max: 'max' } } : {}),
    ...(['opencode-go', 'opencode_go'].includes(config.provider) ? { headers: { 'User-Agent': 'eden-agent/2.0.0-dev.0',
      'x-opencode-session': createHash('sha256').update(sessionId).digest('hex') } } : {}),
  }
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } })
  const observe = (start: (scoped: RequestControl) => ReturnType<typeof completions.stream>) => {
    const operationId = randomUUID()
    const emit = async (kind: string, payload: JsonValue) => { await control.event?.(kind, toJson({ operationId, ...(payload as object) })) }
    return requestRetryStream(attempt => {
      const requestId = randomUUID(), started = Date.now()
      const diagnostics: TransportDiagnostics = { causes: [], secrets: config.apiKey ? [config.apiKey] : [] }
      let admitted = false
      const source = observeTransport(diagnostics, () => start({ ...control, diagnostics, async record(snapshot) {
        await control.record(toJson({ ...(snapshot as Record<string, JsonValue>), requestId, operationId, attempt }))
        admitted = true
      } }))
      return durableResponseStream(source, model, async message => {
        if (!admitted) return
        await emit('model_transport', { requestId, attempt, provider: model.provider, model: model.id,
          endpoint: new URL(model.baseUrl).origin, durationMs: Date.now() - started,
          status: diagnostics.status ?? null, stopReason: message.stopReason, causes: diagnostics.causes })
        await control.response?.(toJson({ requestId, message, costConfigured: config.cost !== undefined }))
      }, error => control.failed?.(error))
    }, control.retry ?? defaultModelRetryPolicy, model, control.signal(), error => control.failed?.(error), emit)
  }

  models.setProvider(createProvider<'openai-completions'>({
    id: config.provider, models: [model], api: {
      stream: (selected, context, options) => { assertCompletions(selected); return observe(scoped => completions.stream(selected, context, controlledOptions(options, scoped, context.tools, config))) },
      streamSimple: (selected, context, options) => { assertCompletions(selected); return observe(scoped => completions.streamSimple(selected, context, controlledOptions(options, scoped, context.tools, config))) },
    },
    auth: { apiKey: { name: 'Eden configured credential', resolve: async () => ({ auth: { apiKey: config.apiKey ?? 'local' }, source: 'eden' }) } },
  }))
  return { models, model }
}

function assertCompletions(model: Model<Api>): asserts model is Model<'openai-completions'> {
  if (model.api !== 'openai-completions') throw new Error('Unexpected model API in completions provider')
}

function controlledOptions<T extends StreamOptions>(options: T | undefined, control: RequestControl, definitions: unknown, config: RuntimeModel): T & StreamOptions {
  return {
    ...options, maxRetries: 0,
    signal: AbortSignal.any([control.signal(), ...(options?.signal ? [options.signal] : [])]),
    async onResponse(response, model) {
      if (control.diagnostics) control.diagnostics.status = response.status
      await options?.onResponse?.(response, model)
    },
    async onPayload(payload, model) {
      const changed = await options?.onPayload?.(payload, model)
      const actual = samplingPayload(changed === undefined ? payload : changed, config)
      await control.record(toJson({ model: model.id, provider: model.provider, payload: actual, tools: definitions ?? [], costConfigured: config.cost !== undefined }))
      return actual
    },
  } as T & StreamOptions
}
