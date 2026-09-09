import { z } from 'zod'
import { jsonValue, toJson, type JsonValue } from '@eden/api'
import type { McpChannel } from './stdio-channel.ts'
const tool = z.object({ name: z.string().min(1).max(256), description: z.string().max(16000).optional(),
  inputSchema: z.record(z.string(), jsonValue), annotations: jsonValue.optional() })
const resource = z.object({ uri: z.string().min(1).max(8192), name: z.string().max(256), description: z.string().max(16000).optional(), mimeType: z.string().max(256).optional() })
const template = z.object({ uriTemplate: z.string().min(1).max(8192), name: z.string().max(256), description: z.string().max(16000).optional(), mimeType: z.string().max(256).optional() })

export class McpClient {
  private capabilities: Record<string, JsonValue> | undefined
  private initializing = false
  constructor(private readonly channel: McpChannel) {}
  async initialize(signal: AbortSignal) {
    if (this.initializing || this.capabilities) throw new Error('MCP initialization already requested')
    this.initializing = true
    try {
      const result = z.object({ protocolVersion: z.enum(['2024-11-05', '2025-03-26', '2025-06-18']),
        capabilities: z.record(z.string(), jsonValue), serverInfo: z.object({ name: z.string().max(256), version: z.string().max(256) }) })
        .parse(await this.channel.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Eden Agent', version: '2.0.0' } }, signal, 15000))
      await this.channel.notify('notifications/initialized')
      this.capabilities = result.capabilities
      return result
    } catch (error) { this.close(); throw error }
  }
  async tools(signal: AbortSignal) { this.ready(); return this.capabilities!.tools ? this.pages('tools/list', 'tools', tool, signal) : [] }
  async resources(signal: AbortSignal) { this.ready(); return this.capabilities!.resources ? this.pages('resources/list', 'resources', resource, signal) : [] }
  async templates(signal: AbortSignal) { this.ready(); return this.capabilities!.resources ? this.pages('resources/templates/list', 'resourceTemplates', template, signal) : [] }
  async call(name: string, args: JsonValue, signal: AbortSignal) {
    this.ready()
    if (!this.capabilities!.tools) throw new Error('MCP server does not provide tools')
    return toJson(z.object({ content: z.array(jsonValue).max(1024), isError: z.boolean().optional(), structuredContent: jsonValue.optional() })
      .parse(await this.channel.request('tools/call', { name, arguments: args }, signal)))
  }
  async read(uri: string, signal: AbortSignal) {
    this.ready()
    if (!this.capabilities!.resources) throw new Error('MCP server does not provide resources')
    return toJson(z.object({ contents: z.array(z.object({ uri: z.string().max(8192), mimeType: z.string().max(256).optional(),
      text: z.string().optional(), blob: z.string().optional() }).refine(item => (item.text !== undefined) !== (item.blob !== undefined), 'Expected text or blob')).max(1024) })
      .parse(await this.channel.request('resources/read', { uri }, signal)))
  }
  close() { this.capabilities = undefined; this.channel.close() }
  private ready() { if (!this.capabilities) throw new Error('MCP client has not initialized') }
  private async pages<T>(method: string, field: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T[]> {
    const values: T[] = [], cursors = new Set<string>()
    let cursor: string | undefined, bytes = 0
    for (let page = 0; page < 32; page++) {
      const raw = await this.channel.request(method, cursor ? { cursor } : {}, signal, 30000)
      bytes += Buffer.byteLength(JSON.stringify(raw))
      if (bytes > 8 * 1024 * 1024) throw new Error('MCP catalog exceeds byte limit')
      const result = z.object({ [field]: z.array(schema).max(1024), nextCursor: z.string().min(1).max(8192).optional() }).parse(raw)
      values.push(...result[field] as T[])
      if (values.length > 1024) throw new Error('MCP catalog exceeds item limit')
      cursor = result.nextCursor as string | undefined
      if (!cursor) return values
      if (cursors.has(cursor)) throw new Error('MCP pagination cursor repeated')
      cursors.add(cursor)
    }
    throw new Error('MCP catalog exceeds page limit')
  }
}
