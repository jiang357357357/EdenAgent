import type { JsonValue } from '@eden/api'
import { McpRemoteError, type McpChannel } from './stdio-channel.ts'
import { mcpHttpMessages } from './http-body.ts'
import { receiveMcpNotifications } from './http-notifications.ts'

export class McpHttpChannel implements McpChannel {
  private readonly abort = new AbortController()
  private session: string | undefined
  private version: string | undefined
  private next = 1
  private active = 0
  private notifications: Promise<void> | undefined
  private disposal: Promise<void> | undefined
  private readonly idle = new Set<() => void>()
  constructor(private readonly endpoint: string, private readonly authorize: () => void,
    private readonly onNotification: (method: string, params: JsonValue) => void = () => {}) {
    const url = new URL(endpoint)
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Invalid MCP HTTP endpoint')
  }
  async request(method: string, params: JsonValue, signal: AbortSignal, timeoutMs = 120000): Promise<JsonValue> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Invalid MCP timeout')
    if (this.active >= 32) throw new Error('MCP HTTP concurrency limit reached')
    const combined = AbortSignal.any([signal, this.abort.signal, AbortSignal.timeout(timeoutMs)])
    combined.throwIfAborted(); this.authorize()
    this.active++
    const id = this.next++
    try {
      const response = await this.post({ jsonrpc: '2.0', id, method, params }, combined)
      const session = response.headers.get('mcp-session-id')
      if (session && (!/^[\x21-\x7e]{1,1024}$/.test(session) || (this.session && session !== this.session))) {
        await response.body?.cancel(); throw new Error('MCP server changed its session identity')
      }
      if (method === 'initialize') this.session = session ?? undefined
      for await (const value of mcpHttpMessages(response)) {
        this.authorize(); combined.throwIfAborted()
        if (!value || typeof value !== 'object' || Array.isArray(value) || value.jsonrpc !== '2.0') throw new Error('Invalid MCP HTTP envelope')
        if (typeof value.method === 'string') {
          if (Object.hasOwn(value, 'id')) {
            if (typeof value.id !== 'string' && typeof value.id !== 'number') throw new Error('Invalid MCP server request ID')
            await this.sendOne(value.method === 'ping' ? { jsonrpc: '2.0', id: value.id, result: {} }
              : { jsonrpc: '2.0', id: value.id, error: { code: -32601, message: 'Client capability is not available' } }, combined)
          } else this.onNotification(value.method, value.params ?? {})
          continue
        }
        if (value.id !== id || Object.hasOwn(value, 'result') === Object.hasOwn(value, 'error')) throw new Error('Unexpected MCP HTTP response')
        if (Object.hasOwn(value, 'error')) {
          const error = value.error
          if (!error || typeof error !== 'object' || Array.isArray(error) || typeof error.code !== 'number' || !Number.isInteger(error.code)) throw new Error('Invalid MCP remote error')
          throw new McpRemoteError(error.code)
        }
        if (method === 'initialize') {
          const result = value.result
          if (!result || typeof result !== 'object' || Array.isArray(result) || !['2025-03-26', '2025-06-18'].includes(String(result.protocolVersion))) throw new Error('Unsupported MCP HTTP protocol version')
          this.version = String(result.protocolVersion)
        }
        return value.result!
      }
      throw new Error('MCP stream ended without its response')
    } catch (error) {
      if (error instanceof McpRemoteError) throw error
      this.close()
      throw new Error('MCP HTTP request was not confirmed; remote effects may be unknown')
    } finally { this.active--; if (!this.active) { for (const resolve of this.idle) resolve(); this.idle.clear() } }
  }
  async notify(method: string, params: JsonValue = {}) {
    await this.sendOne({ jsonrpc: '2.0', method, params }, AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]))
  }
  close() { this.abort.abort() }
  get closedSignal() { return this.abort.signal }
  startNotifications() {
    if (this.notifications || this.abort.signal.aborted || !this.version) return
    this.notifications = receiveMcpNotifications(this.endpoint, () => this.headers(), this.authorize, async value => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') throw new Error('Unexpected MCP notification envelope')
      if (Object.hasOwn(value, 'id')) {
        if (typeof value.id !== 'number' && typeof value.id !== 'string') throw new Error('Invalid MCP server request ID')
        await this.sendOne(value.method === 'ping' ? { jsonrpc: '2.0', id: value.id, result: {} }
          : { jsonrpc: '2.0', id: value.id, error: { code: -32601, message: 'Client capability is not available' } },
          AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]))
      } else this.onNotification(value.method, value.params ?? {})
    }, this.abort.signal).catch(() => { this.close() })
  }
  dispose(): Promise<void> {
    return this.disposal ??= this.disposeSession()
  }
  private async disposeSession() {
    let permitted = false
    try { this.authorize(); permitted = true } catch { /* Revoked endpoints must not receive cleanup traffic. */ }
    const headers = this.headers(), session = this.session
    this.close()
    await this.notifications
    if (this.active) await new Promise<void>(resolve => this.idle.add(resolve))
    if (!session || !permitted) return
    try {
      const response = await fetch(this.endpoint, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000), redirect: 'error', credentials: 'omit' })
      await response.body?.cancel()
      if (!response.ok && response.status !== 404 && response.status !== 405) throw new Error('MCP session termination was not acknowledged')
    } catch { process.stderr.write('MCP remote session cleanup was not confirmed\n') }
    this.session = undefined
  }
  private headers(): Record<string, string> {
    return { ...(this.session ? { 'Mcp-Session-Id': this.session } : {}), ...(this.version ? { 'MCP-Protocol-Version': this.version } : {}) }
  }
  private async sendOne(value: JsonValue, signal: AbortSignal) {
    const response = await this.post(value, signal)
    await response.body?.cancel()
    if (response.status !== 202 && response.status !== 204) throw new Error('MCP notification was not acknowledged')
  }
  private async post(value: JsonValue, signal: AbortSignal) {
    signal.throwIfAborted(); this.authorize()
    const body = JSON.stringify(value)
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('MCP HTTP request exceeds limit')
    const headers = { ...this.headers(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    const response = await fetch(this.endpoint, { method: 'POST', headers, body, signal, redirect: 'error', credentials: 'omit' })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`MCP HTTP request rejected (${response.status})`) }
    return response
  }
}
