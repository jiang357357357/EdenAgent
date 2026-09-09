import { z } from 'zod'
import { jsonValue } from './json.ts'
export const connectorEventListSchema = z.object({ id: z.string().uuid(), before: z.number().int().positive().safe().optional() }).strict()
export const connectorEventReadSchema = z.object({ id: z.string().uuid(), eventId: z.string().uuid() }).strict()
export const connectorEventResultSchema = z.object({ id: z.string().uuid(), payload: jsonValue })
export const connectorEventPageSchema = z.object({ items: z.array(z.object({ id: z.string().uuid(), connectorId: z.string().uuid(), externalId: z.string(),
  eventType: z.string(), sessionId: z.string().nullable(), jobId: z.string().nullable(), suppression: z.string().nullable(), createdAt: z.number() })), nextCursor: z.number().nullable() })
export type ConnectorEventPage = z.infer<typeof connectorEventPageSchema>
