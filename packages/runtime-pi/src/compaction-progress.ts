import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { DurableSessionStorage } from './durable-session.ts'

export const compactionProgressType = 'eden.compaction_progress.v1'
const count = z.number().int().nonnegative()
const usage = z.object({ input: count, output: count, cacheRead: count, cacheWrite: count, totalTokens: count,
  cost: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), total: z.number() }) })
const progressSchema = z.object({ key: z.string(), completed: count, prefix: z.string(),
  summary: z.string().min(1).max(131072), usage }).strict()
export type CompactionProgress = z.infer<typeof progressSchema>

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]))
  return value
}

export function compactionKey(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function compactionPrefixes(messages: AgentMessage[]): string[] {
  const hash = createHash('sha256'), result = [hash.copy().digest('hex')]
  for (const message of messages) {
    hash.update(JSON.stringify(canonical(message))).update('\n')
    result.push(hash.copy().digest('hex'))
  }
  return result
}

export async function restoreCompactionProgress(storage: DurableSessionStorage, key: string, prefixes: string[]): Promise<CompactionProgress | undefined> {
  const entries = await storage.getEntries()
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!
    if (entry.type !== 'custom' || entry.customType !== compactionProgressType) continue
    const parsed = progressSchema.safeParse(entry.data)
    if (parsed.success && parsed.data.key === key && parsed.data.completed > 0
      && prefixes[parsed.data.completed] === parsed.data.prefix) return parsed.data
  }
  return undefined
}

export async function saveCompactionProgress(storage: DurableSessionStorage, value: CompactionProgress): Promise<void> {
  await storage.session().appendCustomEntry(compactionProgressType, progressSchema.parse(value))
}
