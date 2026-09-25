import { z } from 'zod'

export const terminalTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('host') }).strict(),
  z.object({ kind: z.literal('wsl'), distribution: z.string().trim().min(1).max(128)
    .regex(/^[^\u0000-\u001f\u007f-\u009f-][^\u0000-\u001f\u007f-\u009f]*$/) }).strict(),
])
export const terminalGetSchema = z.object({ sessionId: z.string().uuid().optional() }).strict()
export const terminalSetSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('device'), target: terminalTargetSchema }).strict(),
  z.object({ scope: z.literal('session'), sessionId: z.string().uuid(), target: terminalTargetSchema.nullable() }).strict(),
])
export const terminalInfoSchema = z.object({
  platform: z.string(), hostShell: z.string(), hostAvailable: z.boolean(),
  wslDistributions: z.array(z.string()), deviceDefault: terminalTargetSchema,
  sessionOverride: terminalTargetSchema.nullable(), effective: terminalTargetSchema,
})

export type TerminalTarget = z.infer<typeof terminalTargetSchema>
export type TerminalInfo = z.infer<typeof terminalInfoSchema>
