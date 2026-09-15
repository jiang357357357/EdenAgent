import { InMemorySessionStorage, Session } from '@earendil-works/pi-agent-core'
import type { SessionTreeEntry, AgentMessage } from '@earendil-works/pi-agent-core'
import { toJson } from '@eden/api'
import type { RuntimeCheckpoint } from '@eden/api'
import { parseCheckpoint } from './checkpoint-schema.ts'

export class DurableSessionStorage extends InMemorySessionStorage {
  private failed: unknown
  private transientMessage: AgentMessage | undefined
  private transientIndex = 0
  private readonly commit: (snapshot: RuntimeCheckpoint) => Promise<void>

  constructor(sessionId: string, commit: (snapshot: RuntimeCheckpoint) => Promise<void>, checkpoint?: RuntimeCheckpoint, private transientNextUser = false) {
    super({
      metadata: { id: sessionId, createdAt: checkpoint?.createdAt ?? new Date().toISOString() },
      entries: checkpoint ? parseCheckpoint(checkpoint, sessionId) : [],
    })
    this.commit = commit
  }

  assertHealthy(): void {
    if (this.failed) throw new Error('Runtime storage is unavailable; recreate from the durable checkpoint', { cause: this.failed })
  }

  async snapshot(entries?: SessionTreeEntry[]): Promise<RuntimeCheckpoint> {
    const metadata = await this.getMetadata()
    return {
      format: 'eden.pi-harness.v1', runtimeVersion: '0.82.0', sessionId: metadata.id,
      createdAt: metadata.createdAt, entries: (entries ?? await this.getEntries()).map(toJson),
    }
  }

  override async appendEntry(entry: SessionTreeEntry): Promise<void> {
    this.assertHealthy()
    const transient = this.transientNextUser && entry.type === 'message' && entry.message.role === 'user'
    if (transient && entry.type === 'message') this.transientMessage = entry.message
    const stored: SessionTreeEntry = transient ? { type: 'custom', customType: 'eden.transient_input',
      id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, data: { message: entry.message } } : entry
    const snapshot = await this.snapshot([...await this.getEntries(), stored])
    try { await this.commit(snapshot) }
    catch (error) { this.failed = error; throw error }
    await super.appendEntry(stored)
    if (transient) this.transientNextUser = false
  }

  transientContext(messages: AgentMessage[]): AgentMessage[] {
    const transient = this.transientMessage
    if (!transient) return messages
    const found = messages.findIndex(message => JSON.stringify(message) === JSON.stringify(transient))
    if (found >= 0) { this.transientIndex = found; return messages }
    const next = [...messages]
    next.splice(Math.min(this.transientIndex, next.length), 0, transient)
    return next
  }

  persistentContext(messages: AgentMessage[]): AgentMessage[] {
    const transient = this.transientMessage
    return transient ? messages.filter(message => JSON.stringify(message) !== JSON.stringify(transient)) : messages
  }

  endTransientInput(): void { this.transientMessage = undefined }

  override async setLeafId(targetId: string | null): Promise<void> {
    this.assertHealthy()
    if (targetId !== null && !await this.getEntry(targetId)) throw new Error('Unknown session leaf')
    await this.appendEntry({
      type: 'leaf', id: await this.createEntryId(), parentId: await this.getLeafId(),
      targetId, timestamp: new Date().toISOString(),
    })
  }

  session(): Session { return new Session(this) }
}
