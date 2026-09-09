import { monLegacyReplaySchema, monLegacyReplayResultSchema } from './mon-sync.ts'
import { configuredModelSchema, modelReadSchema, modelCatalogSchema, modelSelectSchema } from './models.ts'
import { modelCatalogResultSchema } from './model-catalog.ts'
import { modelStatusSchema } from './model-status.ts'
import { modelPricingTargetSchema, modelPricingInfoSchema, modelPricingSetSchema } from './model-pricing.ts'
import { monSyncStatusSchema, monSyncResultSchema, monLegacySyncResolveSchema, monLegacySyncResolveResultSchema } from './mon-sync.ts'
export const modelRpcMethods = {
  'model.mon.children.list': { params: z.object({ sessionId: z.uuid() }).strict(), result: z.array(z.object({ key: z.string(), entityId: z.string(), revision: z.uuid(), current: z.boolean() })) },
  'model.mon.children.catalog': { params: z.object({ sessionId: z.uuid() }).strict(), result: z.array(z.object({ key: z.string(), entityId: z.string(), label: z.string() })) },
  'model.mon.children.bind': { params: z.object({ sessionId: z.uuid(), entityId: z.string().min(1).max(200), expectedRevision: z.uuid().nullable(), confirmBinding: z.literal(true) }).strict(), result: z.object({ key: z.string(), entityId: z.string(), revision: z.uuid() }) },
  'model.mon.children.remove': { params: z.object({ sessionId: z.uuid(), key: z.string().min(1).max(601), expectedRevision: z.uuid(), confirmRemoval: z.literal(true) }).strict(), result: z.object({ key: z.string() }) },
  'model.local.profiles.list': { params: z.object({}).strict(), result: z.array(z.object({ key: z.string(), revision: z.uuid(), model: configuredModelSchema, hasCredential: z.boolean() })) },
  'model.local.profiles.save': { params: z.object({ model: configuredModelSchema, expectedRevision: z.uuid().nullable(), confirmConfiguration: z.literal(true) }).strict(), result: z.object({ key: z.string(), revision: z.uuid() }) },
  'model.local.profiles.remove': { params: z.object({ key: z.string().min(1).max(601), expectedRevision: z.uuid(), confirmRemoval: z.literal(true) }).strict(), result: z.object({ key: z.string() }) },
  'model.pricing.read': { params: modelPricingTargetSchema, result: modelPricingInfoSchema },
  'model.pricing.set': { params: modelPricingSetSchema, result: modelPricingInfoSchema },
  'model.catalog': { params: modelCatalogSchema, result: modelCatalogResultSchema },
  'model.select': { params: modelSelectSchema, result: modelCatalogResultSchema },
  'mon.operation.list': { params: monOperationListSchema, result: z.array(monOperationInfoSchema) },
  'model.read': { params: modelReadSchema, result: modelStatusSchema },
  'mon.sync.legacy.resolve': { params: monLegacySyncResolveSchema, result: monLegacySyncResolveResultSchema },
  'mon.sync.legacy.replay': { params: monLegacyReplaySchema, result: monLegacyReplayResultSchema },
  'mon.sync.status': { params: monSyncStatusSchema, result: monSyncResultSchema },
} as const
import { z } from 'zod'
import { monOperationListSchema, monOperationInfoSchema } from './mon-operations.ts'
