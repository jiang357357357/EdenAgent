import { setTimeout as delay } from 'node:timers/promises'
import type { JsonValue } from '@eden/api'
import { mcpHttpMessages } from './http-body.ts'

export async function receiveMcpNotifications(endpoint: string, headers: () => Record<string, string>, authorize: () => void,
  message: (value: JsonValue) => Promise<void>, signal: AbortSignal) {
  let failures = 0
  while (!signal.aborted) {
    try {
      authorize()
      const response = await fetch(endpoint, { method: 'GET', headers: { ...headers(), Accept: 'text/event-stream' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]), redirect: 'error', credentials: 'omit' })
      if (response.status === 405) { await response.body?.cancel(); return }
      if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/event-stream') {
        await response.body?.cancel(); throw new Error('MCP notification stream unavailable')
      }
      const expected = headers()['Mcp-Session-Id'], received = response.headers.get('mcp-session-id')
      if (received && received !== expected) { await response.body?.cancel(); throw new Error('MCP notification session changed') }
      for await (const value of mcpHttpMessages(response)) {
        signal.throwIfAborted(); authorize(); await message(value); failures = 0
      }
    } catch {
      if (signal.aborted) return
      failures++
      if (failures >= 10) throw new Error('MCP notification stream repeatedly failed')
    }
    // Reconnect the GET stream only. Never replay a tools/call POST.
    try { await delay(Math.min(30000, 2000 * 2 ** Math.min(failures, 4)), undefined, { signal }) }
    catch { return }
  }
}
