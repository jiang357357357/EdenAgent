import { z } from 'zod'
import { sessionEnvironmentSchema } from './environment.ts'
import { jsonValue } from './json.ts'
import { runtimeOriginSchema } from './runtime.ts'
import { attachmentRefsSchema } from './attachments.ts'

export const protocolVersion = 2
export const websocketProtocol = 'eden-agent-rpc-v2'
export const tokenProtocolPrefix = 'eden-agent-token.'
export const rpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number().int(), z.null()]).optional(),
  method: z.string().min(1), params: jsonValue.optional().default({}),
}).strict()
export const initializeSchema = z.object({
  protocolVersion: z.literal(protocolVersion), runtimeOrigin: runtimeOriginSchema,
  clientName: z.string(), clientVersion: z.string(), capabilities: z.array(z.string()),
}).strict()
export const sessionIdSchema = z.object({ sessionId: z.string().uuid() }).strict()
export const sessionTitleSchema = sessionIdSchema.extend({ title: z.string().min(1).max(500) })
export const sessionCompactSchema = sessionIdSchema.extend({ instructions: z.string().max(10000).default('') })
export const turnQueueSchema = sessionIdSchema.extend({ text: z.string().trim().min(1).max(1_000_000) })
export const workspaceSwitchSchema = sessionIdSchema.extend({ path: z.string().min(1).max(4096) })
export const workspacePathSchema = z.object({ path: z.string().max(4096) }).strict()
export const sessionParticipantsSchema = sessionIdSchema.extend({ participants: z.array(jsonValue).max(32) })
export const messageListSchema = sessionIdSchema.extend({ before: z.string().uuid().nullish(), limit: z.number().int().min(1).max(100).default(50) })
export const sessionCreateSchema = z.object({
  title: z.string().max(500).default('New conversation'), participants: z.array(jsonValue).default([]),
  environment: sessionEnvironmentSchema.optional(),
}).strict()
export const sessionListSchema = z.object({ limit: z.number().int().min(1).max(1000).default(100), includeClosed: z.boolean().default(false), includeBackground: z.boolean().default(false) }).strict()
export const turnStartSchema = z.object({
  sessionId: z.string().uuid(), text: z.string().max(1_000_000), attachments: attachmentRefsSchema.default([]),
  environment: sessionEnvironmentSchema.optional(), idempotencyKey: z.string().min(1).max(200).optional(),
}).strict().refine(value => Boolean(value.text.trim() || value.attachments.length), { message: 'Provide text or an attachment' })
export const eventListSchema = z.object({
  sessionId: z.string().uuid(), afterSeq: z.union([z.string().regex(/^\d+$/), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]).default(0),
  limit: z.number().int().min(1).max(1000).default(100),
}).strict()
