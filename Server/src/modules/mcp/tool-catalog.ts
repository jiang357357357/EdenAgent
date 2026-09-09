import { createHash } from 'node:crypto'
import type { McpClient } from '@eden/integrations'
type Definition = Awaited<ReturnType<McpClient['tools']>>[number]
export interface McpToolEntry { runtimeId: string; revision: string; name: string; remote: Definition; digest: string }
export class McpToolCatalog {
  private readonly entries = new Map<string, McpToolEntry[]>()
  replace(runtimeId: string, revision: string, pluginId: string, componentId: string, tools: Definition[]) {
    const names = new Set<string>()
    const incoming = tools.map(remote => {
      if (remote.inputSchema.type !== 'object') throw new Error('MCP tool input schema must describe an object')
      const segment = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
      const legacy = `mcp__${segment(pluginId)}__${segment(componentId)}__${segment(remote.name)}`
      const digest = createHash('sha256').update(JSON.stringify({ runtimeId, revision, remote })).digest('hex')
      const name = legacy.length <= 64 ? legacy : `${legacy.slice(0, 43)}_${createHash('sha256').update(JSON.stringify([runtimeId, remote.name])).digest('hex').slice(0, 20)}`
      if (names.has(name)) throw new Error('MCP tool names collide after normalization')
      names.add(name)
      return { runtimeId, revision, name, remote, digest }
    })
    for (const [owner, values] of this.entries) if (owner !== runtimeId && values.some(value => names.has(value.name))) throw new Error('MCP tool name collides with another component')
    this.entries.set(runtimeId, incoming)
  }
  list() { return [...this.entries.values()].flat() }
  remove(runtimeId: string) { this.entries.delete(runtimeId) }
  matches(entry: McpToolEntry) { return this.entries.get(entry.runtimeId)?.some(value => value.name === entry.name && value.digest === entry.digest) ?? false }
}
