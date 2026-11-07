import { validateToolArguments } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { z } from 'zod'
import type { RuntimeTool } from './contracts.ts'

/** Resolve forwarding and validate UI arguments using the runtime's public model SDK. */
export function resolveRuntimeTool(tool: RuntimeTool, raw: unknown, callId: string) {
  const value = z.record(z.string(), z.unknown()).parse(raw)
  const resolved = tool.resolveCall?.(value) ?? { tool, input: value }
  const input = validateToolArguments({ name: resolved.tool.name, description: resolved.tool.description,
    parameters: Type.Unsafe(resolved.tool.parameters) },
  { type: 'toolCall', id: callId, name: resolved.tool.name, arguments: resolved.input }) as Record<string, unknown>
  return { tool: resolved.tool, input }
}
