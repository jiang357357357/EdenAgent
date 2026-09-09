import { serverVersion } from '../../version.ts'
import type { RequestListener } from 'node:http'
import type { RuntimeOrigin } from '@eden/api'

interface HealthChecks { model: boolean; sessionFaults: number; memoryExtraction: boolean; jobs?: boolean; selfAwake?: boolean }

export function healthHandler(origin: RuntimeOrigin, checks: () => HealthChecks): RequestListener {
  return (request, response) => {
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', 'no-store')
    if (request.method !== 'GET' || !['/healthz', '/readyz'].includes(request.url ?? '')) {
      response.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
      return
    }
    const current = checks()
    const ready = (origin === 'mon' || current.model) && !current.sessionFaults && current.memoryExtraction && current.jobs !== false && current.selfAwake !== false
    const unavailable = request.url === '/readyz' && !ready
    response.writeHead(unavailable ? 503 : 200).end(JSON.stringify({
      status: unavailable ? 'not_ready' : 'ok', runtimeOrigin: origin, serverVersion, checks: { database: true, ...current },
    }))
  }
}
