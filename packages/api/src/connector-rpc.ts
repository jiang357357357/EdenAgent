import { z } from 'zod'
import { connectorCreateSchema, connectorUpdateSchema, connectorInfoSchema, connectorCatalogSchema } from './connectors.ts'
import { connectorCredentialReadSchema, connectorCredentialSetSchema, connectorCredentialRemoveSchema, connectorCredentialStatusSchema } from './connector-credentials.ts'
import { connectorPermissionReadSchema, connectorPermissionSetSchema, connectorPermissionSnapshotSchema } from './connector-permissions.ts'
import { connectorEventListSchema, connectorEventReadSchema, connectorEventResultSchema, connectorEventPageSchema } from './connector-events.ts'
import { connectorHistorySchema, connectorOperationPageSchema } from './connector-history.ts'
export const connectorRpcMethods = {
  'connector.create': { params: connectorCreateSchema, result: connectorInfoSchema },
  'connector.update': { params: connectorUpdateSchema, result: connectorInfoSchema },
  'connector.list': { params: z.object({}).strict(), result: z.array(connectorInfoSchema) },
  'connector.catalog': { params: z.object({}).strict(), result: connectorCatalogSchema },
  'connector.events': { params: connectorEventListSchema, result: connectorEventPageSchema },
  'connector.event.read': { params: connectorEventReadSchema, result: connectorEventResultSchema },
  'connector.operations': { params: connectorHistorySchema, result: connectorOperationPageSchema },
  'connector.credential.read': { params: connectorCredentialReadSchema, result: connectorCredentialStatusSchema },
  'connector.credential.set': { params: connectorCredentialSetSchema, result: connectorCredentialStatusSchema },
  'connector.credential.remove': { params: connectorCredentialRemoveSchema, result: connectorCredentialStatusSchema },
  'connector.permissions.read': { params: connectorPermissionReadSchema, result: connectorPermissionSnapshotSchema },
  'connector.permissions.set': { params: connectorPermissionSetSchema, result: connectorPermissionSnapshotSchema },
} as const
