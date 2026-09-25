import { z } from 'zod'

export const sessionPurposeSchema = z.enum(['user_chat', 'self_awake', 'subagent'])
export const sessionSourceChannelSchema = z.enum(['app', 'qq', 'internal'])

export type SessionPurpose = z.infer<typeof sessionPurposeSchema>
export type SessionSourceChannel = z.infer<typeof sessionSourceChannelSchema>
