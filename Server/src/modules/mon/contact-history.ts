import { z } from 'zod'
import { contactHistorySchema, toJson, jsonValue } from '@eden/api'
import type { MonClient } from '@eden/integrations'
import { ownerQqTarget } from './qq-contact.ts'
const id = z.union([z.number().int().safe(), z.string().max(128)])
const messageSchema = z.object({ id, role: z.string().max(64).optional(), content: jsonValue.optional(),
  created_at: z.union([z.string().max(128), z.number()]).nullish(), timestamp: z.union([z.string().max(128), z.number()]).nullish(),
  direction: z.string().max(64).optional(), message_type: z.string().max(64).optional(),
})
export async function readOwnerQqHistory(client: MonClient, raw: unknown, signal: AbortSignal) {
  const input = contactHistorySchema.parse(raw)
  const target = await ownerQqTarget(client, signal)
  const query = new URLSearchParams({ target_type: 'user', target_qq_number: target.number, limit: String(input.limit) })
  if (input.beforeId !== undefined) query.set('before_id', String(input.beforeId))
  const result = await client.get(`/api/devices/qq_bot/${target.bot}/messages/?${query}`, signal)
  const envelope = z.record(z.string(), z.unknown()).parse(result)
  if (envelope.success === false) throw new Error('Core could not read owner QQ history')
  const data = z.object({ messages: z.array(messageSchema).max(100), has_more: z.boolean().default(false), next_before_id: id.nullish() }).parse(envelope.data ?? result)
  // Keep the chronological order expected by the old agent tool; omit management credentials and unrelated target metadata.
  const messages = data.messages.reverse()
  if (Buffer.byteLength(JSON.stringify(messages)) > 256 * 1024) throw new Error('QQ history exceeds 256 KiB; request fewer messages')
  return toJson({ channel: 'qq', targetType: 'user', messages, hasMore: data.has_more, nextBeforeId: data.next_before_id ?? null })
}
