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
  let revisions = new Map(options.tools.map(tool => [tool.name, tool.revision]))
  const healthy = () => {
    storage.assertHealthy()
    if (fatal) throw new Error('Runtime persistence failed; restore before continuing', { cause: fatal })
  }
  const fail = (error: unknown): never => { fatal = error; throw error }
  const tools = (items: RuntimeTool[]) => items.map(tool => adaptTool(tool, options.callbacks, healthy, fail, options.toolCallPrefix))
  const provider = createRuntimeModels(options.model, {
    signal: () => controller.signal,
    async record(snapshot) {
      healthy()
      if (++requests > (options.maxModelRequests ?? 128)) throw new Error('Model request budget exceeded')
      try {
        const value = snapshot as Record<string, JsonValue>
        const definitions = value.tools as Record<string, JsonValue>[]
        await options.callbacks.request(toJson({ ...value, tools: definitions.map(tool => ({ ...tool, revision: revisions.get(String(tool.name)) })) }))
      } catch (error) { fatal = error; throw error }
    },
  })
  const harness = new AgentHarness({
    session: storage.session(), ...provider, systemPrompt: options.systemPrompt,
    tools: tools(options.tools), thinkingLevel: 'off', streamOptions: { maxRetries: 0 },
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
  })
  harness.on('context', event => ({ messages: storage.transientContext(event.messages) }))
  harness.subscribe(async event => {
    healthy()
    try { await options.callbacks.event(event.type, toJson(event)) }
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
      healthy(); await active; await harness.waitForIdle(); await harness.setTools(tools(items))
      revisions = new Map(items.map(tool => [tool.name, tool.revision]))
    },
  }
}
