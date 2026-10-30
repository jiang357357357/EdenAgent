import { z } from 'zod'

export const sharedSshTargetSchema = z.object({
  host: z.string().trim().min(1).max(253).refine(value => /^[a-zA-Z0-9._:-]+$/.test(value), '请填写 SSH IP 或域名'),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1).max(128).refine(value => !/[\r\n\0]/.test(value)),
}).strict()
export const sharedHostDeploymentSchema = sharedSshTargetSchema.extend({
  fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
  auth: z.discriminatedUnion('type', [
    z.object({ type: z.literal('password'), password: z.string().min(1).max(4096) }).strict(),
    z.object({ type: z.literal('key'), privateKey: z.string().min(1).max(32768), passphrase: z.string().max(4096).optional() }).strict(),
  ]),
  directory: z.string().trim().max(2048).refine(value => !/[\r\n\0]/.test(value)).default(''),
  name: z.string().trim().min(1).max(120),
  servicePort: z.number().int().min(1).max(65535).default(40195),
  publicAddress: z.string().trim().min(1).max(200),
  installService: z.boolean().default(true),
}).strict()
export const sharedHostDeploymentJobSchema = z.object({
  id: z.string().uuid(), state: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  phase: z.enum(['connecting', 'dependencies', 'preflight', 'uploading', 'starting', 'pairing', 'done']),
  message: z.string(), updatedAt: z.number(), hostStarted: z.boolean(),
  address: z.string().optional(), deviceId: z.string().uuid().optional(), pairingCode: z.string().optional(),
  directory: z.string().optional(), bootService: z.boolean().optional(),
})
export type SharedSshTarget = z.infer<typeof sharedSshTargetSchema>
export type SharedHostDeploymentInput = z.infer<typeof sharedHostDeploymentSchema>
export type SharedHostDeploymentJob = z.infer<typeof sharedHostDeploymentJobSchema>
