import { monLegacyReplaySchema, monLegacyReplayResultSchema } from './mon-sync.ts'
import { modelReadSchema, modelCatalogSchema, modelSelectSchema } from './models.ts'
import { modelCatalogResultSchema } from './model-catalog.ts'
import { modelStatusSchema } from './model-status.ts'
import { monSyncStatusSchema, monSyncResultSchema, monLegacySyncResolveSchema, monLegacySyncResolveResultSchema } from './mon-sync.ts'
export const modelRpcMethods = {
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
