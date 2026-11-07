import { createHash } from 'node:crypto'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
import type { RuntimeOptions } from './contracts.ts'
import type { DurableSessionStorage } from './durable-session.ts'

/** Entry keys survive compaction and make checkpoint commit the atomic import boundary. */
export async function importHistory(storage: DurableSessionStorage, history: RuntimeOptions['history']): Promise<void> {
  if (!history?.length) return
  const known = new Set((await storage.getEntries()).map(entry => entry.id))
  const entries: SessionTreeEntry[] = []
  let parentId = await storage.getLeafId()
  for (const item of history) {
    const id = 'qq-' + createHash('sha256').update(item.key).digest('hex')
    if (known.has(id)) continue
    const entry: SessionTreeEntry = { type: 'custom_message', customType: 'eden.qq.public_message', id, parentId,
      timestamp: item.timestamp, content: item.text, display: false, details: { source: 'qq-public-history' } }
    entries.push(entry); known.add(id); parentId = id
  }
  await storage.appendHistory(entries)
}
