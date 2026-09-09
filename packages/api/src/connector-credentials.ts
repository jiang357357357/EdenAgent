import { z } from 'zod'
export const connectorCredentialReadSchema = z.object({ id: z.string().uuid() }).strict()
export const connectorCredentialSetSchema = z.object({ id: z.string().uuid(), generation: z.string().min(1).max(128),
  secret: z.string().min(1).max(16384).refine(value => !/[\r\n\0]/.test(value), 'Credential cannot contain line breaks or NUL') }).strict()
export const connectorCredentialRemoveSchema = z.object({ id: z.string().uuid(), generation: z.string().min(1).max(128) }).strict()
export const connectorCredentialStatusSchema = z.object({ id: z.string().uuid(), generation: z.string(), supported: z.boolean(), configured: z.boolean(), updatedAt: z.number().nullable() })
export type ConnectorCredentialStatus = z.infer<typeof connectorCredentialStatusSchema>
