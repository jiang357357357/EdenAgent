import { createCustomMessage } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { DurableSessionStorage } from './durable-session.ts'
import type { RuntimeTool } from './contracts.ts'
import { runtimeContextSnapshot } from './model-prompts.ts'
import { RuntimePersistenceError } from './persistence-error.ts'
import { createHash } from 'node:crypto'

export const RUNTIME_CONTEXT_TYPE = 'eden.runtime_context'
type Section = { name: string; kind: string; content: string }

export function isRuntimeContextSnapshot(message: AgentMessage): boolean {
  return message.role === 'custom' && message.customType === RUNTIME_CONTEXT_TYPE
}

function snapshotDigest(message: AgentMessage | undefined): unknown {
  if (message?.role !== 'custom' || !message.details || typeof message.details !== 'object') return
  const source = 'source' in message.details ? message.details.source : undefined
  return source && typeof source === 'object' && 'contentHash' in source ? source.contentHash : undefined
}

/** Durable user-role snapshots, with change detection against the retained branch after compaction. */
export class RuntimeContextSnapshots {
  private sections: Section[] = []
  constructor(private readonly storage: DurableSessionStorage, private readonly environment: string | undefined) {}

  update(tools: readonly RuntimeTool[]): void {
    this.sections = [
      ...(this.environment ? [{ name: 'runtime', kind: 'environment', content: this.environment }] : []),
      ...tools.flatMap(tool => tool.contextHint ? [{ name: tool.name, ...tool.contextHint }] : []),
    ]
  }

  sources() {
    return this.sections.map(section => ({ kind: section.kind,
      title: section.kind === 'tools' ? '工具目录' : section.kind === 'skills' ? '技能目录' : '运行资料',
      content: section.content, placement: 'runtime-context' }))
  }

  async prepare(): Promise<void> {
    await this.apply((await this.storage.session().buildContext()).messages)
  }

  async apply(messages: AgentMessage[]): Promise<AgentMessage[]> {
    const previous = messages.findLast(isRuntimeContextSnapshot)
    if (!previous && !this.sections.length) return messages
    const content = runtimeContextSnapshot(this.sections)
    const contentHash = createHash('sha256').update(content).digest('hex')
    if (snapshotDigest(previous) === contentHash || previous?.role === 'custom' && previous.content === content) return messages
    const session = this.storage.session()
    const id = await session.appendCustomMessageEntry(RUNTIME_CONTEXT_TYPE, content, false, {
      source: { kind: 'runtime-context', contentHash, sections: this.sections.map(({ name, kind }) => ({ name, kind })) },
    })
    const entry = await session.getEntry(id)
    if (!entry || entry.type !== 'custom_message') throw new RuntimePersistenceError('运行资料快照提交后无法读取', new Error('检查点未保留已提交的快照条目'))
    const admitted = createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp)
    return [...messages, admitted]
  }
}
