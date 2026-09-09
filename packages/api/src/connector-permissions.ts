import { z } from 'zod'
export const connectorPermissionReadSchema = z.object({ id: z.string().uuid() }).strict()
export const connectorPermissionSetSchema = z.object({ id: z.string().uuid(), generation: z.string().min(1).max(128),
  revision: z.string().regex(/^[a-f0-9]{64}$/), decisions: z.array(z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), allowed: z.boolean() }).strict()).max(128) }).strict()
export const connectorPermissionSnapshotSchema = z.object({ id: z.string().uuid(), generation: z.string(), revision: z.string(), ready: z.boolean(),
  worker: z.object({ available: z.boolean(), sha256: z.string().nullable(), error: z.string().nullable() }),
  permissions: z.array(z.object({ key: z.string(), capability: z.string(), resource: z.string(), resolvedResource: z.string().nullable(),
    access: z.string(), required: z.boolean(), description: z.string(), allowed: z.boolean() })) })
export type ConnectorPermissionSnapshot = z.infer<typeof connectorPermissionSnapshotSchema>
