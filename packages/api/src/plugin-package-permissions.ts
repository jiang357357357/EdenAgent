import { z } from 'zod'
export const packagePermissionDecisionSchema = z.object({ capability: z.string().min(1).max(128), resource: z.string().max(4096),
  access: z.string().max(128), decision: z.enum(['allowed', 'denied']) }).strict()
export const packagePermissionSetSchema = z.object({ id: z.union([z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/)]),
  revision: z.string().regex(/^[a-f0-9]{64}$/), decisions: z.array(packagePermissionDecisionSchema).max(256) }).strict()
export type PackagePermissionDecision = z.infer<typeof packagePermissionDecisionSchema>
