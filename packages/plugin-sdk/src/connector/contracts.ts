import type { z } from 'zod'
import type { JsonValue, connectorWorkerInitializeSchema, connectorWorkerHealthSchema } from '@eden/api/connector'

export type ConnectorInitialize = z.infer<typeof connectorWorkerInitializeSchema>
export type ConnectorHealth = z.infer<typeof connectorWorkerHealthSchema>
export interface ConnectorContext extends ConnectorInitialize {
  signal: AbortSignal
  publish(eventType: string, externalId: string, payload: JsonValue): void
  status(state: ConnectorHealth['state']): void
}
export interface ConnectorCall {
  capability: string
  payload: JsonValue
  operationId: string
}
export interface ConnectorSession {
  health(): ConnectorHealth | Promise<ConnectorHealth>
  query?(call: ConnectorCall): JsonValue | Promise<JsonValue>
  execute?(call: ConnectorCall): JsonValue | Promise<JsonValue>
  close(): void | Promise<void>
}
export interface ConnectorDefinition {
  id: string
  version: string
  events: readonly string[]
  queries: readonly string[]
  actions: readonly string[]
  initialize(context: ConnectorContext): ConnectorSession | Promise<ConnectorSession>
}
