import { z } from 'zod'
import { deliverContact } from './contact-delivery.ts'
import type { MonClient } from '@eden/integrations'
import type { EdenDatabase } from '@eden/store'
export const emailContactSchema = z.object({ requestId: z.string().min(1).max(256),
  title: z.string().trim().min(1).max(256), message: z.string().trim().min(1).max(16000) }).strict()
/** Uses Core's default owner recipient; model-supplied recipient addresses are not accepted. */
export async function deliverOwnerEmail(database: EdenDatabase, client: MonClient, sessionId: string, raw: unknown, signal: AbortSignal) {
  const input = emailContactSchema.parse(raw)
  const payload = JSON.stringify({ subject: input.title, content: input.message, html: '', request_id: input.requestId })
  return deliverContact(database, client, sessionId, input.requestId, 'email', '/api/agent/external-email/send/', payload, signal)
}
