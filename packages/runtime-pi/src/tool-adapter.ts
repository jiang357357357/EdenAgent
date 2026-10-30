import { runtimeImages } from './images.ts'
import type { RuntimeImage } from './contracts.ts'
import { validateToolArguments } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { z } from 'zod'
import type { AgentHarnessTool } from '@earendil-works/pi-agent-core'
import { toolFailureOutcome } from './tool-outcome.ts'
import { jsonValue, toJson } from '@eden/api'
import type { RuntimeCallbacks, RuntimeTool } from './contracts.ts'
import { isRuntimePersistenceFailure } from './persistence-error.ts'

export function adaptTool<TContext extends object | undefined = undefined>(tool: RuntimeTool, callbacks: RuntimeCallbacks, healthy: () => void, fail: (error: unknown) => never, callPrefix = ''): AgentHarnessTool<TContext> {
  if (tool.parameters.type !== 'object') throw new Error(`Tool "${tool.name}" parameters must have an object root`)
  return {
    name: tool.name, label: tool.name, description: tool.description,
    parameters: Type.Unsafe<Record<string, unknown>>(tool.parameters),
    executionMode: tool.executionMode ?? 'sequential',
    async execute(callId, rawInput, signal) {
      const invocationId = `${callPrefix}${callId}`
      const raw = z.record(z.string(), z.unknown()).parse(rawInput)
      const { tool: selected, input: resolved } = tool.resolveCall?.(raw) ?? { tool, input: raw }
      const input = validateToolArguments({ name: selected.name, description: selected.description, parameters: Type.Unsafe(selected.parameters) },
        { type: 'toolCall', id: invocationId, name: selected.name, arguments: resolved }) as Record<string, unknown>
      healthy()
      const cancellation = signal ?? new AbortController().signal
      cancellation.throwIfAborted()
      try { await callbacks.beforeTool?.(selected.name, invocationId, selected.revision,
        selected.auditInput ? z.record(z.string(), z.unknown()).parse(selected.auditInput(input)) : input) }
      catch (error) { fail(error) }
      let result
      try {
        healthy()
        cancellation.throwIfAborted()
        result = toJson(await selected.execute(input, { callId: invocationId, signal: cancellation, ...(selected.assertCurrent ? { assertCurrent: selected.assertCurrent } : {}) }))
        cancellation.throwIfAborted()
      }
      catch (error) {
        const outcome = selected.failureOutcome?.(error) ?? toolFailureOutcome(error, cancellation)
        try { await callbacks.afterTool?.(invocationId, { error: error instanceof Error ? error.message : String(error) }, true, outcome) }
        catch (commitError) { fail(commitError) }
        if (isRuntimePersistenceFailure(error)) fail(error)
        throw error
      }
      const output = toJson(result)
      const outcome = selected.outcome?.(output) ?? 'completed'
      try { await callbacks.afterTool?.(invocationId, output, outcome !== 'completed', outcome) }
      catch (error) { fail(error) }
      const projected = projectResult(selected, output, input, fail)
      if (outcome !== 'completed') throw new Error(JSON.stringify({ outcome, result: projected }))
      const images = await projectImages(selected, output, cancellation, fail)
      return { content: [{ type: 'text', text: JSON.stringify(projected) }, ...images], details: projected }
    },
  }
}

/** Image projection failure must not erase the already committed raw receipt. */
async function projectImages(tool: RuntimeTool, output: import('@eden/api').JsonValue, signal: AbortSignal, fail: (error: unknown) => never): Promise<RuntimeImage[]> {
  try {
    const images = tool.resultImages ? runtimeImages(await tool.resultImages(output, signal)) : []
    signal.throwIfAborted()
    return images
  } catch (error) { return fail(error) }
}

function projectResult(tool: RuntimeTool, output: import('@eden/api').JsonValue, input: Record<string, unknown>, fail: (error: unknown) => never) {
  try { return tool.modelResult ? jsonValue.parse(tool.modelResult(output, input)) : output }
  catch (error) { return fail(error) }
}
