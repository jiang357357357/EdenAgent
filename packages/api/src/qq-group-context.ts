import { z } from 'zod'
import { replyLengthSchema } from './ui-preferences.ts'

export const QQ_GROUP_CONTEXT_PROTOCOL = 'qq-group-context.v2'
export const QQ_GROUP_CONTEXT_LEGACY_PROTOCOL = 'qq-group-context.v1'
export const QQ_GROUP_CONTEXT_MAX_CHARS = 96_000
export const QQ_GROUP_TURN_MAX_JSON_BYTES = 256 * 1024

const qq = z.string().regex(/^\d{5,20}$/)
const permission = z.enum(['none', 'allowed', 'admin', 'super_admin', 'blocked', 'unknown'])
const message = z.object({
  message_id: z.string().max(128), role: z.enum(['user', 'assistant']),
  sender_qq: z.union([qq, z.literal('')]), sender_name: z.string().max(128),
  sender_permission: permission.optional(),
  timestamp: z.string().max(64), content: z.string().max(6000),
}).strict()

/** Public records supplied by Core; these never grant execution or approval authority. */
export const qqGroupContextSchema = z.object({
  schema_version: z.enum([QQ_GROUP_CONTEXT_LEGACY_PROTOCOL, QQ_GROUP_CONTEXT_PROTOCOL]), bot_qq: qq, group_qq: qq, operator_qq: qq,
  speaker_name: z.string().max(128), speaker_permission: permission.optional(), messages: z.array(message).max(200),
  summaries: z.array(z.string().max(6000)).max(3), quote: message.optional(),
  reply_length: replyLengthSchema.optional(),
  prompt_mode_enabled: z.boolean().optional(),
}).strict().refine(value => value.schema_version !== QQ_GROUP_CONTEXT_PROTOCOL || value.speaker_permission !== undefined
  && value.messages.every(item => item.sender_permission !== undefined)
  && (!value.quote || value.quote.sender_permission !== undefined), 'QQ group identity context requires personal permission levels')
  .refine(value => JSON.stringify(value).length <= QQ_GROUP_CONTEXT_MAX_CHARS,
  'QQ group context exceeds its reference budget')

export type QqGroupContext = z.infer<typeof qqGroupContextSchema>
