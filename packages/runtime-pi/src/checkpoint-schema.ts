import { z } from 'zod'
import { runtimeCheckpointSchema } from '@eden/api'
import type { RuntimeCheckpoint } from '@eden/api'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'

const content = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).passthrough(),
  z.object({ type: z.literal('thinking'), thinking: z.string() }).passthrough(),
  z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }).passthrough(),
  z.object({ type: z.literal('toolCall'), id: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }).passthrough(),
]))
const usage = z.object({
  input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), totalTokens: z.number(),
  cost: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), total: z.number() }),
})
const message = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.union([z.string(), content]), timestamp: z.number() }).passthrough(),
  z.object({ role: z.literal('assistant'), content, timestamp: z.number(), api: z.string(), provider: z.string(), model: z.string(),
    stopReason: z.enum(['stop', 'length', 'toolUse', 'error', 'aborted']), usage }).passthrough(),
  z.object({ role: z.literal('toolResult'), content, timestamp: z.number(), toolCallId: z.string(), toolName: z.string(), isError: z.boolean() }).passthrough(),
])
const base = { id: z.string().min(1), parentId: z.string().nullable(), timestamp: z.string() }
const entry = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('message'), message }).passthrough(),
  z.object({ ...base, type: z.literal('thinking_level_change'), thinkingLevel: z.string() }).passthrough(),
  z.object({ ...base, type: z.literal('model_change'), provider: z.string(), modelId: z.string() }).passthrough(),
  z.object({ ...base, type: z.literal('active_tools_change'), activeToolNames: z.array(z.string()) }).passthrough(),
  z.object({ ...base, type: z.literal('compaction'), summary: z.string(), tokensBefore: z.number(),
    firstKeptEntryId: z.string().optional(), retainedTail: z.array(message).optional(), usage: usage.optional() }).passthrough(),
  z.object({ ...base, type: z.literal('branch_summary'), fromId: z.string(), summary: z.string() }).passthrough(),
  z.object({ ...base, type: z.literal('custom'), customType: z.string() }).passthrough(),
  z.object({ ...base, type: z.literal('custom_message'), customType: z.string(), content: z.union([z.string(), content]), display: z.boolean() }).passthrough(),
  z.object({ ...base, type: z.literal('label'), targetId: z.string(), label: z.string().optional() }).passthrough(),
  z.object({ ...base, type: z.literal('session_info'), name: z.string().optional() }).passthrough(),
  z.object({ ...base, type: z.literal('leaf'), targetId: z.string().nullable() }).passthrough(),
])

export function parseCheckpoint(value: RuntimeCheckpoint, sessionId: string): SessionTreeEntry[] {
  const checkpoint = runtimeCheckpointSchema.parse(value)
  if (checkpoint.sessionId !== sessionId) throw new Error('Checkpoint session mismatch')
  const entries = z.array(entry).parse(checkpoint.entries)
  const ids = new Set<string>()
  for (const item of entries) {
    if (ids.has(item.id)) throw new Error('Checkpoint has duplicate entry IDs')
    if (item.parentId !== null && !ids.has(item.parentId)) throw new Error('Checkpoint has an invalid parent')
    if (item.type === 'leaf' && item.targetId !== null && !ids.has(item.targetId)) throw new Error('Checkpoint has an invalid leaf')
    if (item.type === 'label' && !ids.has(item.targetId)) throw new Error('Checkpoint has an invalid label target')
    ids.add(item.id)
  }
  // This cast is confined to the versioned disk boundary after discriminator validation.
  return entries as SessionTreeEntry[]
}
