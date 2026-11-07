import { AgentHarness } from '@earendil-works/pi-agent-core'
import { jsonSnapshot, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { EdenRuntime, RuntimeCallbacks, RuntimeOptions, RuntimeTool } from './contracts.ts'
import { DurableSessionStorage } from './durable-session.ts'
import { createRuntimeModels } from './model-provider.ts'
import { adaptTool } from './tool-adapter.ts'
import { modelTools } from './tool-presentation.ts'
import { runtimeImages } from './images.ts'
import { compactConversation } from './compaction.ts'
import { automaticCompactor } from './automatic-compaction.ts'
import { TurnContext } from './turn-context.ts'
import { importHistory } from './history-imports.ts'
import { defaultModelRetryPolicy, modelRetryDelay, retryableModelFailure, waitForModelRetry } from './model-retry.ts'
import { appendTrailingSystemMessage, hasTrailingSystemMessage, isTrailingSystemSource } from './trailing-system.ts'
import { RuntimeContextSnapshots } from './runtime-context-snapshots.ts'
import { requestMessageSources } from './request-message-sources.ts'
import { leadingSystemPrompt, isLeadingSystemSource, leadingSystemSources } from './system-prompt.ts'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

export function createRuntime(options: RuntimeOptions, toolAdapter: typeof adaptTool = adaptTool): EdenRuntime {
  const storage = new DurableSessionStorage(options.sessionId, options.callbacks.checkpoint, options.checkpoint, options.transientInput)
  const turnContext = new TurnContext(options.turnContext)
  const contextSources = (options.contextSources ?? []).filter(source => !isTrailingSystemSource(source) && !isLeadingSystemSource(source)
    && !(source && typeof source === 'object' && !Array.isArray(source) && source.placement === 'runtime-context'))
  const trailingSources = (options.contextSources ?? []).filter(isTrailingSystemSource)
  const leadingSources = (options.contextSources ?? []).filter(isLeadingSystemSource)
  const runtimeContext = new RuntimeContextSnapshots(storage, options.runtimeContext)
  let requestContext: AgentMessage[] = []
  let fatal: unknown
  let requests = 0
  let controller = new AbortController()
  let active: Promise<JsonValue> | undefined
  let presentedTools = modelTools(options.tools)
  runtimeContext.update(presentedTools)
  let presentedNames = new Set(presentedTools.map(tool => tool.name))
  let retryAttempt = 0
  let toolExecutionStarted = false
  const retryPolicy = { ...defaultModelRetryPolicy, ...options.modelRetry }
  if (![retryPolicy.maxRetries, retryPolicy.baseDelayMs, retryPolicy.maxDelayMs].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Model retry settings must be non-negative integers')
  let revisions = new Map(options.tools.map(tool => [tool.name, tool.revision]))
  const healthy = () => {
    storage.assertHealthy()
    if (fatal) throw fatal
  }
  const fail = (error: unknown): never => { fatal = error; throw error }
  const callbacks: RuntimeCallbacks = {
    ...options.callbacks,
    async event(kind, payload) {
      const message = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.message : undefined
      const role = message && typeof message === 'object' && !Array.isArray(message) ? message.role : undefined
      if (retryAttempt > 0 && kind.startsWith('message_') && role === 'user') return
      await options.callbacks.event(kind, payload)
    },
    async beforeTool(name, callId, revision, input) {
      toolExecutionStarted = true
      await options.callbacks.beforeTool?.(name, callId, revision, input)
    },
  }
  const tools = (items: RuntimeTool[]) => items.map(tool => toolAdapter<Record<string, never>>(tool, callbacks, healthy, fail, options.toolCallPrefix))
  const provider = createRuntimeModels(options.model, {
    signal: () => controller.signal,
    toolVisible: name => presentedNames.has(name),
    retry: retryPolicy,
    async event(kind, payload) {
      try { await callbacks.event(kind, payload) }
      catch (error) { fatal = error; controller.abort(); throw error }
    },
    failed(error) { fatal = error; controller.abort() },
    async response(snapshot) {
      try { await options.callbacks.response?.(snapshot) }
      catch (error) { fatal = error; controller.abort(); throw error }
    },
    async record(snapshot) {
      healthy()
      if (++requests > (options.maxModelRequests ?? 128)) throw new Error('Model request budget exceeded')
      try {
        const value = snapshot as Record<string, JsonValue>
        const definitions = value.tools as Record<string, JsonValue>[]
        const trailing = hasTrailingSystemMessage(value.payload, options.trailingSystemPrompt) ? trailingSources : []
        await options.callbacks.request(toJson({ ...value, systemPromptUpdatePolicy: 'leading-only-fallback',
          messageSources: requestMessageSources(value.payload, requestContext, options.turnContext),
          contextSources: [...contextSources, ...leadingSystemSources(value.payload, leadingSources), ...runtimeContext.sources(),
            ...presentedTools.flatMap(tool => tool.promptHint ? [{ kind: 'system', title: `工具指引：${tool.name}`, content: tool.promptHint }] : []), ...trailing],
          promptHints: presentedTools.flatMap(tool => tool.promptHint ? [{ name: tool.name, text: tool.promptHint }] : []),
          tools: definitions.map(tool => ({ ...tool, revision: revisions.get(String(tool.name)) })) }))
      } catch (error) { fatal = error; throw error }
    },
  }, options.sessionId)
  const harness: AgentHarness<Record<string, never>> = new AgentHarness<Record<string, never>>({
    session: storage.session(), ...provider,
    toolContext: async () => {
      healthy()
      if (options.refreshTools) {
        const items = await options.refreshTools()
        await harness.setTools(tools(items), items.map(tool => tool.name))
        presentedTools = modelTools(items)
        runtimeContext.update(presentedTools)
        presentedNames = new Set(presentedTools.map(tool => tool.name))
        revisions = new Map(items.map(tool => [tool.name, tool.revision]))
      }
      return {}
    },
    systemPrompt: () => leadingSystemPrompt(options.systemPrompt, presentedTools, options.systemPromptSuffix),
    tools: tools(options.tools), thinkingLevel: options.model.reasoning ?? 'off', streamOptions: { maxRetries: 0 },
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
  })
  if (options.trailingSystemPrompt) harness.on('before_provider_payload', event => ({
    payload: appendTrailingSystemMessage(event.payload, options.trailingSystemPrompt),
  }))
  harness.on('session_before_compact', async event => ({ compaction: await compactConversation(
    event.branchEntries, provider, options.model, controller.signal, storage, callbacks, event.customInstructions) }))
  const autoCompact = automaticCompactor(storage, provider, options.model, { ...options.callbacks,
    async event(kind, payload) { try { await options.callbacks.event(kind, payload) } catch (error) { fail(error) } },
  }, () => ({
    system: leadingSystemPrompt(options.systemPrompt, presentedTools, options.systemPromptSuffix), tools: presentedTools, signal: controller.signal,
    ...(options.turnContext ? { turnContext: options.turnContext } : {}),
    ...(options.trailingSystemPrompt ? { trailingSystemPrompt: options.trailingSystemPrompt } : {}),
  }))
  harness.on('context', async event => {
    const contextual = await runtimeContext.apply(storage.transientContext(event.messages))
    requestContext = storage.transientContext(await autoCompact(contextual))
    return { messages: turnContext.apply(requestContext) }
  })
  harness.subscribe(async event => {
    healthy()
    try { await callbacks.event(event.type, jsonSnapshot({ ...event, costConfigured: options.model.cost !== undefined })) }
    catch (error) { fatal = error; throw error }
  })
  const run = (work: () => Promise<unknown>): Promise<JsonValue> => {
    healthy()
    if (active) return Promise.reject(new Error('Runtime is busy'))
    requests = 0
    retryAttempt = 0
    toolExecutionStarted = false
    controller = new AbortController()
    active = (async () => { const result = await work(); healthy(); return toJson(result) })()
      .finally(() => { storage.endTransientInput(); active = undefined })
    return active
  }
  return {
    async prompt(text, images) {
      const copied = runtimeImages(images)
      return run(async () => {
        turnContext.reset()
        await importHistory(storage, options.history)
        await runtimeContext.prepare()
        const originalLeaf = await storage.getLeafId()
        const prompt = options.inputContext ? `${text}\n\n${options.inputContext}` : text
        for (;;) {
          const result = toJson(await harness.prompt(prompt, { images: copied }))
          const error = retryableModelFailure(result)
          if (!error || toolExecutionStarted || retryAttempt >= retryPolicy.maxRetries) {
            if (retryAttempt > 0) await callbacks.event('retry_finished', { operation: 'model', success: !error, attempt: retryAttempt, error: error ?? null })
            return result
          }
          retryAttempt += 1
          const delayMs = modelRetryDelay(retryPolicy, retryAttempt)
          await storage.setLeafId(originalLeaf)
          await callbacks.event('retry_scheduled', { operation: 'model', attempt: retryAttempt, maxAttempts: retryPolicy.maxRetries, delayMs, errorMessage: error })
          await waitForModelRetry(delayMs, controller.signal)
          await callbacks.event('retry_attempt_start', { operation: 'model', attempt: retryAttempt })
        }
      })
    },
    async steer(text, images) { healthy(); await harness.steer(text, { images: runtimeImages(images) }) },
    async followUp(text, images) { healthy(); await harness.followUp(text, { images: runtimeImages(images) }) },
    async abort() { controller.abort(); await harness.abort(); await active?.catch(() => undefined) },
    async waitForIdle() { await active; await harness.waitForIdle() },
    async compact(instructions) { return run(() => harness.compact(instructions)) },
    snapshot: () => storage.snapshot(),
    async replaceTools(items) {
      healthy(); await active; await harness.waitForIdle(); await harness.setTools(tools(items), items.map(tool => tool.name))
      presentedTools = modelTools(items)
      runtimeContext.update(presentedTools)
      presentedNames = new Set(presentedTools.map(tool => tool.name))
      revisions = new Map(items.map(tool => [tool.name, tool.revision]))
    },
  }
}
