import { z } from 'zod'
import { jsonValue } from './json.ts'
export const connectorWorkerInitializeSchema = z.object({ protocolVersion: z.literal(1), connectorInstanceId: z.string().uuid(),
  connectorKey: z.string().min(1).max(64), packageVersion: z.string().max(128), settings: jsonValue,
  grantedPermissions: z.array(z.object({ capability: z.string().max(128), resource: z.string().max(4096), access: z.string().max(64) }).strict()).max(128),
  dataDirectory: z.string().min(1).max(4096) }).strict()
export const connectorWorkerReadySchema = z.object({ protocolVersion: z.literal(1), workerVersion: z.string().min(1).max(128), capabilities: z.array(z.string().min(1).max(128)).max(512).default([]) }).strict()
export const connectorPublishedEventSchema = z.object({ externalId: z.string().min(1).max(256), eventType: z.string().min(1).max(128), payload: jsonValue.default(null) }).strict()
export const connectorWorkerStatusSchema = z.object({ state: z.string().min(1).max(64), detail: z.string().max(4096).nullish() }).strict()

export const connectorWorkerHealthSchema = z.object({ state: z.enum(['starting', 'connecting', 'ready', 'connected', 'degraded', 'error', 'failed', 'disconnected']), initialized: z.boolean(), attached: z.boolean().optional(), bridgeSeen: z.boolean().optional() })
