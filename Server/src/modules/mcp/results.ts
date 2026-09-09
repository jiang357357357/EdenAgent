import { mcpResultReadSchema, mcpResultExportSchema, jsonValue, type JsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { BlobService } from '../blobs/index.ts'
function parts(result: JsonValue): JsonValue[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result === null ? [] : [result]
  const content = Array.isArray(result.content) ? result.content : Array.isArray(result.contents) ? result.contents : []
  return [...content, ...(result.structuredContent === undefined ? [] : [{ type: 'structured', value: result.structuredContent }])]
}
function resource(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: 'json', value }
  return value.resource && typeof value.resource === 'object' && !Array.isArray(value.resource) ? value.resource : value
}
export class McpResults {
  private closed = false
  private readonly pending = new Set<Promise<unknown>>()
  constructor(private readonly database: EdenDatabase, private readonly blobs: BlobService) {}
  private load(sessionId: string, operationId: string) {
    const row = this.database.connection.prepare('SELECT state,result_json FROM mcp_operations WHERE id=? AND session_id=?').get(operationId, sessionId)
    if (!row) throw new Error('MCP operation is not in this session and world')
    return { state: String(row.state), parts: parts(row.result_json === null ? null : jsonValue.parse(JSON.parse(String(row.result_json)))) }
  }
  read(raw: unknown) {
    const input = mcpResultReadSchema.parse(raw), result = this.load(input.sessionId, input.operationId)
    let remaining = 65536
    return { state: result.state, parts: result.parts.map((part, index) => {
      const value = resource(part), binary = typeof value.data === 'string' || typeof value.blob === 'string'
      const text = typeof value.text === 'string' ? value.text : binary ? null : JSON.stringify(value)
      const limit = Math.min(16000, remaining), preview = text === null ? null : text.slice(0, limit)
      remaining -= preview?.length ?? 0
      return { index, kind: typeof value.type === 'string' ? value.type : binary ? 'binary' : 'resource',
        mimeType: typeof value.mimeType === 'string' ? value.mimeType.slice(0, 255) : null, text: preview, truncated: text !== null && text.length > limit, binary }
    }) }
  }
  export(raw: unknown) {
    if (this.closed || this.pending.size >= 2) throw new Error('MCP result export is unavailable or busy')
    const input = mcpResultExportSchema.parse(raw), part = this.load(input.sessionId, input.operationId).parts[input.index]
    if (part === undefined) throw new Error('MCP result part does not exist')
    const value = resource(part), encoded = typeof value.data === 'string' ? value.data : value.blob
    let bytes: Buffer, mime: string
    if (typeof encoded === 'string') {
      if (encoded.length > 12 * 1024 * 1024 || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid MCP binary encoding')
      bytes = Buffer.from(encoded, 'base64')
      if (bytes.toString('base64') !== encoded) throw new Error('Noncanonical MCP binary encoding')
      mime = typeof value.mimeType === 'string' && /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(value.mimeType) ? value.mimeType : 'application/octet-stream'
    } else { bytes = Buffer.from(typeof value.text === 'string' ? value.text : JSON.stringify(value, null, 2)); mime = 'text/plain;charset=utf-8' }
    const task = this.blobs.put(bytes, mime)
    this.pending.add(task)
    void task.finally(() => this.pending.delete(task)).catch(() => {})
    return task
  }
  async close() { this.closed = true; await Promise.allSettled([...this.pending]) }
}
