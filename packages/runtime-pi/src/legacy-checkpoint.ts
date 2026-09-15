import { createHash } from 'node:crypto'
import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import { toJson } from '@eden/api'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
import { parseCheckpoint } from './checkpoint-schema.ts'
import { legacyConversationHistory } from './model-prompts.ts'

/** Historical transcript entries are model context, never pending executable tool calls or restored grants. */
export function legacyContextCheckpoint(sessionId: string, history: JsonValue[], createdAt: number): RuntimeCheckpoint {
  const timestamp = new Date(createdAt).toISOString(), entries: SessionTreeEntry[] = []
  let parentId: string | null = null, total = 0
  for (const [index, value] of history.entries()) {
    const text = JSON.stringify(value)
    total += Buffer.byteLength(text)
    if (total > 512 * 1024) throw new Error('Historical context requires explicit compaction before continuation')
    const id = createHash('sha256').update(`eden:legacy-context:${sessionId}:${index}:`).update(text).digest('hex')
    entries.push({ type: 'custom_message', customType: 'eden.legacy_history', id, parentId, timestamp, display: false,
      content: legacyConversationHistory(value) })
    parentId = id
  }
  const checkpoint: RuntimeCheckpoint = { format: 'eden.pi-harness.v1', runtimeVersion: '0.82.0', sessionId, createdAt: timestamp, entries: entries.map(toJson) }
  parseCheckpoint(checkpoint, sessionId)
  return checkpoint
}
