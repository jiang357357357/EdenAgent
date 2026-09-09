import { serverVersion } from '../../version.ts'
import { ZodError } from 'zod'
import { initializeSchema, initializeResultSchema, protocolVersion, rpcRequestSchema, toJson } from '@eden/api'
import type { JsonValue, RuntimeOrigin } from '@eden/api'
import { RpcFailure } from './errors.ts'

export class RpcRouter {
  private initialized = false
  constructor(private readonly origin: RuntimeOrigin,
    private readonly routes: Record<string, (params: JsonValue) => JsonValue | Promise<JsonValue>>) {}

  async dispatch(raw: unknown): Promise<JsonValue | undefined> {
    let id: string | number | null = null
    try {
      const request = rpcRequestSchema.parse(raw)
      if (request.id === undefined) return undefined
      id = request.id
      let result: JsonValue
      if (request.method === 'initialize') {
        const params = initializeSchema.parse(request.params)
        if (params.runtimeOrigin !== this.origin) throw new RpcFailure(-32001, 'Runtime origin mismatch')
        result = toJson(initializeResultSchema.parse({ protocolVersion, serverName: 'eden-agent-server', serverVersion,
          agentCoreVersion: 'pi-0.82.0', runtimeOrigin: this.origin, capabilities: Object.keys(this.routes) }))
        this.initialized = true
      } else {
        if (!this.initialized) throw new RpcFailure(-32002, 'Initialize the connection first')
        const route = Object.hasOwn(this.routes, request.method) ? this.routes[request.method] : undefined
        if (!route) throw new RpcFailure(-32601, `Method not implemented: ${request.method}`)
        result = await route(request.params)
      }
      return { jsonrpc: '2.0', id, result, error: null }
    } catch (error) {
      const code = error instanceof RpcFailure ? error.code : error instanceof ZodError ? -32602 : -32000
      const message = error instanceof ZodError ? 'Invalid request parameters' : error instanceof Error ? error.message : 'Request failed'
      return toJson({ jsonrpc: '2.0', id, result: null, error: { code, message } })
    }
  }
}
