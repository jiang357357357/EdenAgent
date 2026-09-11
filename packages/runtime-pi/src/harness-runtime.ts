import { AgentHarness } from '@earendil-works/pi-agent-core'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { EdenRuntime, RuntimeOptions, RuntimeTool } from './contracts.ts'
import { DurableSessionStorage } from './durable-session.ts'
import { createRuntimeModels } from './model-provider.ts'
import { adaptTool } from './tool-adapter.ts'
import { runtimeImages } from './images.ts'

export function createRuntime(options: RuntimeOptions): EdenRuntime {
  const storage = new DurableSessionStorage(options.sessionId, options.callbacks.checkpoint, options.checkpoint, options.transientInput)
  let fatal: unknown
  let requests = 0
  let controller = new AbortController()
  let active: Promise<JsonValue> | undefined
  let currentTools = options.tools
  let revisions = new Map(options.tools.map(tool => [tool.name, tool.revision]))
  const healthy = () => {
    storage.assertHealthy()
    if (fatal) throw new Error('Runtime persistence failed; restore before continuing', { cause: fatal })
  }
  const fail = (error: unknown): never => { fatal = error; throw error }
  const tools = (items: RuntimeTool[]) => items.map(tool => adaptTool<Record<string, never>>(tool, options.callbacks, healthy, fail, options.toolCallPrefix))
  const provider = createRuntimeModels(options.model, {
    signal: () => controller.signal,
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
        await options.callbacks.request(toJson({ ...value, promptHints: currentTools.flatMap(tool => tool.promptHint ? [{ name: tool.name, text: tool.promptHint }] : []), tools: definitions.map(tool => ({ ...tool, revision: revisions.get(String(tool.name)) })) }))
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
        currentTools = items
        revisions = new Map(items.map(tool => [tool.name, tool.revision]))
      }
      return {}
    },
    systemPrompt: () => [options.systemPrompt, ...currentTools.flatMap(tool => tool.promptHint ? [tool.promptHint] : [])].join('\n\n'),
    tools: tools(options.tools), thinkingLevel: options.model.reasoning ?? 'off', streamOptions: { maxRetries: 0 },
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
  })
  harness.on('context', event => ({ messages: storage.transientContext(event.messages) }))
  harness.subscribe(async event => {
    healthy()
    try { await options.callbacks.event(event.type, toJson({ ...event, costConfigured: options.model.cost !== undefined })) }
    catch (error) { fatal = error; throw error }
  })
  const run = (work: () => Promise<unknown>): Promise<JsonValue> => {
    healthy()
    if (active) return Promise.reject(new Error('Runtime is busy'))
    requests = 0
    controller = new AbortController()
    active = (async () => { const result = await work(); healthy(); return toJson(result) })()
      .finally(() => { storage.endTransientInput(); active = undefined })
    return active
  }
  return {
    async prompt(text, images) { const copied = runtimeImages(images); return run(() => harness.prompt(text, { images: copied })) },
    async steer(text, images) { healthy(); await harness.steer(text, { images: runtimeImages(images) }) },
    async followUp(text, images) { healthy(); await harness.followUp(text, { images: runtimeImages(images) }) },
    async abort() { controller.abort(); await harness.abort(); await active?.catch(() => undefined) },
    async waitForIdle() { await active; await harness.waitForIdle() },
    async compact(instructions) { return run(() => harness.compact(instructions)) },
    snapshot: () => storage.snapshot(),
    async replaceTools(items) {
      healthy(); await active; await harness.waitForIdle(); await harness.setTools(tools(items), items.map(tool => tool.name))
      currentTools = items
      revisions = new Map(items.map(tool => [tool.name, tool.revision]))
    },
  }
}
