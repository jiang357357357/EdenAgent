import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { JsonValue } from '@eden/api'
import type { ConnectorCatalog, ConnectorRepository, ConnectorEventRepository, ConnectorPermissions, ConnectorCredentials } from '../../modules/connectors/index.ts'
export function connectorRoutes(catalog: ConnectorCatalog, repository: ConnectorRepository, events: ConnectorEventRepository, permissions: ConnectorPermissions, credentials: ConnectorCredentials): Record<string, (raw: JsonValue) => JsonValue | Promise<JsonValue>> {
  return { 'connector.operations': contractHandler(rpcMethods['connector.operations'], input => repository.history(input)),
    'connector.credential.read': contractHandler(rpcMethods['connector.credential.read'], input => credentials.read(input)),
    'connector.credential.set': contractHandler(rpcMethods['connector.credential.set'], input => credentials.set(input)),
    'connector.credential.remove': contractHandler(rpcMethods['connector.credential.remove'], input => credentials.remove(input)),
    'connector.permissions.read': contractHandler(rpcMethods['connector.permissions.read'], input => permissions.read(input.id)),
    'connector.permissions.clear': contractHandler(rpcMethods['connector.permissions.clear'], input => permissions.clear(input)),
    'connector.permissions.set': contractHandler(rpcMethods['connector.permissions.set'], input => permissions.set(input)),
    'connector.event.read': contractHandler(rpcMethods['connector.event.read'], input => events.read(input.id, input.eventId)),
    'connector.events': contractHandler(rpcMethods['connector.events'], input => events.list(input.id, input.before)),
    'connector.catalog': contractHandler(rpcMethods['connector.catalog'], () => catalog.list()),
    'connector.list': contractHandler(rpcMethods['connector.list'], () => repository.list()),
    'connector.create': contractHandler(rpcMethods['connector.create'], input => repository.create(input)),
    'connector.update': contractHandler(rpcMethods['connector.update'], input => repository.update(input)) }
}
