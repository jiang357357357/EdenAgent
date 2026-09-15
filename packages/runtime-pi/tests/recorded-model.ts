import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import type { RuntimeOptions } from '../src/index.ts'

export type RecordedReply = { text: string; thinking?: string } | { tool: string; input: Record<string, unknown> } | { wait: true } |
  { error: string; partial?: string } | { status: number; error: string }

export async function recordedModel(replies: RecordedReply[]) {
  const requests: Record<string, unknown>[] = []
  const headers: import('node:http').IncomingHttpHeaders[] = []
  const active = new Set<ServerResponse>()
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    requests.push(JSON.parse(body))
    headers.push(request.headers)
    const reply = replies[requests.length - 1]
    if (reply && 'status' in reply) {
      response.writeHead(reply.status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: reply.error, type: reply.error } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    active.add(response)
    response.on('close', () => active.delete(response))
    if (reply && 'wait' in reply) { response.flushHeaders(); return }
    const chunk = (delta: unknown, finish_reason: string | null = null) => {
      response.write(`data: ${JSON.stringify({ id: `response-${requests.length}`, object: 'chat.completion.chunk',
        created: 1, model: 'recorded', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    }
    chunk({ role: 'assistant' })
    if (reply && 'error' in reply) {
      if (reply.partial) chunk({ content: reply.partial })
      response.flushHeaders()
      setTimeout(() => response.destroy(new Error(reply.error)), 10)
    } else if (reply && 'tool' in reply) {
      chunk({ tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function', function: { name: reply.tool, arguments: JSON.stringify(reply.input) } }] })
      chunk({}, 'tool_calls')
    } else {
      if (reply && 'thinking' in reply && reply.thinking) chunk({ reasoning_content: reply.thinking })
      chunk({ content: reply && 'text' in reply ? reply.text : 'No more recorded replies' })
      chunk({}, 'stop')
    }
    if (!(reply && 'error' in reply)) response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    requests, headers,
    config: { provider: 'recorded', id: 'recorded', baseUrl: `http://127.0.0.1:${port}/v1`, contextWindow: 32000, maxTokens: 1024 },
    async close() {
      for (const response of active) response.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

export function callbacks() {
  const checkpoints: RuntimeCheckpoint[] = []
  const events: { kind: string; payload: JsonValue }[] = []
  const requests: JsonValue[] = []
  const handlers: RuntimeOptions['callbacks'] = {
    checkpoint: async value => { checkpoints.push(structuredClone(value)) },
    event: async (kind, payload) => { events.push({ kind, payload }) },
    request: async value => { requests.push(value) },
  }
  return { checkpoints, events, requests, handlers }
}
