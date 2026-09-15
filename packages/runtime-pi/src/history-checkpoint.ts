import { randomUUID } from 'node:crypto'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
import { toJson } from '@eden/api'
import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import { parseCheckpoint } from './checkpoint-schema.ts'
import { publicHandoffHistory } from './model-prompts.ts'

export function publicHistoryCheckpoint(sessionId: string, history: JsonValue[], previous?: RuntimeCheckpoint): RuntimeCheckpoint {
  const entries = previous ? parseCheckpoint(previous, sessionId) : []
  const timestamp = new Date().toISOString()
  const entry: SessionTreeEntry = { type: 'custom_message', customType: 'eden.public_handoff_history', id: randomUUID(), parentId: null,
    timestamp, display: false, content: publicHandoffHistory(history) }
  return { format: 'eden.pi-harness.v1', runtimeVersion: '0.82.0', sessionId,
    createdAt: previous?.createdAt ?? timestamp, entries: [...entries, entry].map(toJson) }
}
