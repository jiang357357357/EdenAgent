import type { JsonValue, RuntimeOrigin } from '@eden/api'

export interface SessionSummary {
  id: string
  title: string
  titleSource: string
  status: 'active' | 'closed'
  runtimeOrigin: RuntimeOrigin
  participants: JsonValue[]
  environment: JsonValue
  createdAt: number
  updatedAt: number
}

export interface SessionInput {
  id: string
  sessionId: string
  turnId: string
  text: string
  state: string
  metadata?: JsonValue
  kind?: 'prompt' | 'compact'
}

export interface AcceptedInput {
  sessionId: string
  turnId: string
  inputId: string
  state: string
}

export interface SessionTurnExtension {
  snapshot(sessionId: string, participants: JsonValue[]): JsonValue | undefined
  execute(input: SessionInput, signal: AbortSignal): Promise<void>
  inject?(sessionId: string, text: string, kind: 'steer' | 'follow_up'): Promise<boolean>
}

export interface SessionBoundary {
  pendingSessions(): string[]
  run(sessionId: string, signal: AbortSignal): Promise<boolean>
}
