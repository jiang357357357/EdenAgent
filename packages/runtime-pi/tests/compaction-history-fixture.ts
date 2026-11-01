import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import type { RuntimeCallbacks } from '../src/index.ts'

export function largeHistory(sessionId: string, count: number): RuntimeCheckpoint {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  const entries: JsonValue[] = Array.from({ length: count }, (_, index) => ({
    type: 'message', id: `history-${index}`, parentId: index ? `history-${index - 1}` : null,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: index % 2 === 0 ? { role: 'user', timestamp: index, content: `ITEM_${index} ` + '旧'.repeat(38) }
      : { role: 'assistant', timestamp: index, content: [{ type: 'text', text: `ANSWER_${index} ` + '答'.repeat(38) }],
        api: 'openai-completions', provider: 'recorded', model: 'recorded', stopReason: 'stop', usage },
  }))
  return { format: 'eden.pi-harness.v1', runtimeVersion: '0.82.0', sessionId,
    createdAt: '2026-01-01T00:00:00.000Z', entries }
}

export function compactionRecording() {
  let latest: RuntimeCheckpoint | undefined
  const events: { kind: string; payload: JsonValue }[] = []
  const handlers: RuntimeCallbacks = {
    async checkpoint(value) { latest = structuredClone(value) },
    async event(kind, payload) { events.push({ kind, payload }) },
    async request() {},
  }
  return { handlers, events, snapshot: () => latest! }
}

export function progressEntries(checkpoint: RuntimeCheckpoint) {
  return checkpoint.entries.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)
    && entry.type === 'custom' && entry.customType === 'eden.compaction_progress.v1')
}
