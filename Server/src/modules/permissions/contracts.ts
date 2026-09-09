import type { JsonValue, DurableEvent } from '@eden/api'

export interface PermissionContext { sessionId: string; turnId: string; callId: string; signal: AbortSignal }
export interface PermissionRequest {
  id: string; sessionId: string; turnId: string; operationId: string; capability: string
  resource: string; state: string; details: JsonValue; createdAt: number
}
export interface PermissionEventSink {
  insert(sessionId: string, turnId: string | null, kind: string, payload: JsonValue): DurableEvent
  publish(event: DurableEvent): void
}
