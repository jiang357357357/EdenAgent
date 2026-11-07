import { z } from 'zod'
import { qqGroupContextSchema } from './qq-group-context.ts'
import { replyLengthSchema } from './ui-preferences.ts'

export const QQ_SHARED_HISTORY_PROTOCOL = 'qq-group-shared.v1'
const qq = z.string().regex(/^\d{5,20}$/)
const permission = z.enum(['none', 'allowed', 'admin', 'super_admin', 'blocked', 'unknown'])
export const qqSharedMessageSchema = z.object({
  source_key: z.string().min(1).max(128), sequence: z.number().int().positive(),
  message_id: z.string().max(128), role: z.enum(['user', 'assistant']),
  sender_qq: z.union([qq, z.literal('')]), sender_name: z.string().max(128),
  sender_permission: permission, timestamp: z.string().max(64), content: z.string().max(6000),
  reply_to_input: z.string().max(128).optional(),
  kind: z.enum(['message', 'progress']).optional(),
}).strict()
export const qqSharedContextSchema = z.object({
  schema_version: z.literal(QQ_SHARED_HISTORY_PROTOCOL), bot_qq: qq, group_qq: qq, operator_qq: qq,
  speaker_name: z.string().max(128), speaker_permission: permission,
  source_key: z.string().min(1).max(128), sequence: z.number().int().positive(),
  previous_source_key: z.string().max(128).nullable(),
  quote: qqGroupContextSchema.shape.quote,
  messages: z.array(qqSharedMessageSchema).max(200).default([]),
  reply_length: replyLengthSchema.optional(),
  prompt_mode_enabled: z.boolean().optional(),
}).strict()
export type QqSharedContext = z.infer<typeof qqSharedContextSchema>
export type QqSharedMessage = z.infer<typeof qqSharedMessageSchema>
