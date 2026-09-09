import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EdenDatabase } from '@eden/store'
import { attachWebsocket } from '../transport/websocket/upgrade.ts'
import type { ServerConfig } from './config.ts'
import { persistToken } from './config.ts'
import { acquireProcessLock } from './process-lock.ts'
import { pluginRoutes } from '../transport/rpc/plugin.routes.ts'
import { permissionRoutes } from '../transport/rpc/permission.routes.ts'
import { workspaceRoutes } from '../transport/rpc/workspace.routes.ts'
import { modelRoutes } from '../transport/rpc/model.routes.ts'
import { directorRoutes } from '../transport/rpc/director.routes.ts'
import { questionRoutes } from '../transport/rpc/question.routes.ts'
import { createServices } from './services.ts'
import { BlobHttp } from '../transport/http/blobs.ts'
import { healthHandler } from '../transport/http/health.ts'
import { memoryExtractionRoutes } from '../transport/rpc/memory-extraction.routes.ts'

export async function startServer(config: ServerConfig) {
  const releaseLock = acquireProcessLock(config.dataRoot)
  let database: EdenDatabase
  try { database = new EdenDatabase(config.databasePath, config.origin) }
  catch (error) { releaseLock(); throw error }
  let services: ReturnType<typeof createServices>
  try { services = createServices(database, config) }
  catch (error) { database.close(); releaseLock(); throw error }
  const { plugins, permissions, sessions, workspace, models, mon, directors, companion, questions, memoryExtractions } = services
  const blobHttp = new BlobHttp(services.blobs, config)
  const drainServices = () => Promise.allSettled([memoryExtractions.close(), blobHttp.close(), plugins.close(), sessions.close(),
    mon.close(), companion.close(), Promise.resolve().then(() => questions.close())])
  const health = healthHandler(config.origin, () => ({ model: Boolean(config.model), sessionFaults: sessions.faultCount(),
    memoryExtraction: memoryExtractions.fault === undefined }))
  const http = createServer((request, response) => {
    if (blobHttp.handle(request, response)) return
    health(request, response)
  })
  const websocket = attachWebsocket(http, config, sessions, {
    ...memoryExtractionRoutes(memoryExtractions),
    ...directorRoutes(directors),
    ...questionRoutes(questions),
    ...pluginRoutes(plugins), ...permissionRoutes(permissions), ...workspaceRoutes(workspace, sessions), ...modelRoutes(models, sessions, config.origin === 'mon' ? mon : undefined),
  })
  try {
    await memoryExtractions.start()
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(config.port, config.host, () => { http.removeListener('error', reject); resolve() })
    })
    persistToken(config)
    sessions.resumePending()
  } catch (error) {
    for (const client of websocket.clients) client.terminate()
    await drainServices()
    http.closeAllConnections(); http.close(); websocket.close(); database.close(); releaseLock(); throw error
  }
  const address = http.address() as AddressInfo
  let closing: Promise<void> | undefined
  return {
    port: address.port, sessions, plugins, permissions, memoryExtractions,
    close(): Promise<void> {
      closing ??= (async () => {
        for (const client of websocket.clients) client.terminate()
        const drained = await drainServices()
        websocket.close()
        http.closeAllConnections()
        await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()))
        database.close()
        releaseLock()
        const failures = drained.filter(result => result.status === 'rejected')
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Runtime shutdown completed with errors')
      })()
      return closing
    },
  }
}
