import { createHash } from 'node:crypto'
import { z } from 'zod'
import { assistantTargetSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { PermissionService } from '../permissions/index.ts'
import { assistantParticipant } from '../mon/index.ts'
import type { MonBindingService } from '../mon/index.ts'
import type { HandoffRepository } from './handoff-repository.ts'

export function handoffTools(mon: MonBindingService, handoffs: HandoffRepository, permissions: PermissionService, sessionId: string, turnId: string): RuntimeTool[] {
  return [{
    name: 'list_assistants', revision: 'eden.assistants.v1', description: 'List available assistants by stable ID and short name. Requires permission to read the Mon assistant directory.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_input, context) {
      await permissions.request({ sessionId, turnId, ...context }, 'mon.assistants.read', 'assistants', {})
      context.signal.throwIfAborted()
      return toJson({ assistants: await mon.listAssistants(sessionId, context.signal) })
    },
  }, {
    name: 'switch_assistant', revision: 'eden.assistant-handoff.v1', executionMode: 'sequential',
    description: 'Schedule an assistant switch for the next root turn, preserving public history. Resolve an exact ID or unambiguous name, then ask permission for that target. The current turn retains its identity.',
    parameters: toJson(z.toJSONSchema(assistantTargetSchema, { io: 'input' })) as Record<string, JsonValue>,
    async execute(input, context) {
      const target = assistantTargetSchema.parse(input)
      const permissionContext = { sessionId, turnId, ...context }
      await permissions.request(permissionContext, 'mon.assistants.read', 'assistant-target', toJson(target))
      context.signal.throwIfAborted()
      const resolved = await mon.resolveAssistant(sessionId, target, context.signal)
      const participant = assistantParticipant(resolved.detail)
      const revision = createHash('sha256').update(JSON.stringify(participant)).digest('hex')
      await permissions.request(permissionContext, 'assistant.handoff', `assistant:${resolved.summary.id}`,
        { assistantId: resolved.summary.id, assistantName: resolved.summary.name, targetRevision: revision })
      context.signal.throwIfAborted()
      const job = handoffs.schedule(sessionId, turnId, participant)
      return toJson({ assistant: resolved.summary, participant: { assistantId: resolved.summary.id, assistantName: resolved.summary.name,
        characterId: resolved.summary.character?.id ?? null, characterName: resolved.summary.character?.name ?? '' },
      jobId: job.id, historyPreserved: true, effectiveFrom: 'next_root_run', status: 'scheduled' })
    },
  }]
}
