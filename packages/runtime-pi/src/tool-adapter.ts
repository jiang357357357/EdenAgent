import { runtimeImages } from './images.ts'
import type { RuntimeImage } from './contracts.ts'
import { Type } from 'typebox'
import { z } from 'zod'
import type { AgentHarnessTool } from '@earendil-works/pi-agent-core'
import { toJson } from '@eden/api'
import type { RuntimeCallbacks, RuntimeTool } from './contracts.ts'

export function adaptTool(tool: RuntimeTool, callbacks: RuntimeCallbacks, healthy: () => void, fail: (error: unknown) => never, callPrefix = ''): AgentHarnessTool<undefined> {
  if (tool.parameters.type !== 'object') throw new Error('Tool parameters must have an object root')
  return {
    name: tool.name, label: tool.name, description: tool.description,
    parameters: Type.Unsafe<Record<string, unknown>>(tool.parameters),
    executionMode: tool.executionMode ?? 'sequential',
    async execute(callId, rawInput, signal) {
      const invocationId = `${callPrefix}${callId}`
      const input = z.record(z.string(), z.unknown()).parse(rawInput)
      healthy()
      const cancellation = signal ?? new AbortController().signal
      cancellation.throwIfAborted()
      try { await callbacks.beforeTool?.(tool.name, invocationId, tool.revision, input) }
      catch (error) { fail(error) }
      healthy()
      cancellation.throwIfAborted()
      let result
      let images: RuntimeImage[] = []
      try {
        result = await tool.execute(input, { callId: invocationId, signal: cancellation })
        cancellation.throwIfAborted()
        if (tool.resultImages) images = runtimeImages(await tool.resultImages(toJson(result), cancellation))
        cancellation.throwIfAborted()
      }
      catch (error) {
        try { await callbacks.afterTool?.(invocationId, { error: error instanceof Error ? error.message : String(error) }, true) }
        catch (commitError) { fail(commitError) }
        throw error
      }
      const output = toJson(result)
      try { await callbacks.afterTool?.(invocationId, output, false) }
      catch (error) { fail(error) }
      return { content: [{ type: 'text', text: JSON.stringify(output) }, ...images], details: output }
    },
  }
}
