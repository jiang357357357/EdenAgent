import { operationRoutes } from '../transport/rpc/operation.routes.ts'
import { commandRoutes } from '../transport/rpc/command.routes.ts'
import { mcpRoutes } from '../transport/rpc/mcp.routes.ts'
import { connectorRoutes } from '../transport/rpc/connector.routes.ts'
import { mediaRoutes } from '../transport/rpc/media.routes.ts'
import { voiceRoutes } from '../transport/rpc/voice.routes.ts'
import { subagentRoutes } from '../transport/rpc/subagent.routes.ts'
import { pluginAssetRoutes } from '../transport/rpc/plugin-assets.routes.ts'
import { pluginMarketRoutes } from '../transport/rpc/plugin-market.routes.ts'
import { skillRoutes } from '../transport/rpc/skill.routes.ts'
import { SelfAwakeHttp } from '../transport/http/self-awake.ts'
import { notificationRoutes } from '../transport/rpc/notification.routes.ts'
import { selfAwakeRoutes } from '../transport/rpc/self-awake.routes.ts'
import { jobRoutes } from '../transport/rpc/job.routes.ts'
import { memoRoutes } from '../transport/rpc/memo.routes.ts'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EdenDatabase, readLegacyConversionStatus } from '@eden/store'
import { rpcMethods, toJson } from '@eden/api'
import { contractHandler } from '../transport/rpc/contract-handler.ts'
import { acquireReviewLock } from './review-lock.ts'
import { attachWebsocket } from '../transport/websocket/upgrade.ts'
import type { ServerConfig } from './config.ts'
import { persistToken } from './config.ts'
import { acquireProcessLock } from './process-lock.ts'
import { assertRuntimeSelection } from './runtime-selection.ts'
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
  const releaseProcessLock = acquireProcessLock(config.dataRoot)
  try { assertRuntimeSelection(config) } catch (error) { releaseProcessLock(); throw error }
  let releaseReviewLock: (() => void) | undefined
  try { if (config.migrationReview) releaseReviewLock = acquireReviewLock(config.dataRoot) }
  catch (error) { releaseProcessLock(); throw error }
  const releaseLock = () => { try { releaseReviewLock?.() } finally { releaseProcessLock() } }
  let database: EdenDatabase
  try { database = new EdenDatabase(config.databasePath, config.origin, config.migrationReview ? 'migration-review' : 'runtime') }
  catch (error) { releaseLock(); throw error }
  let services: ReturnType<typeof createServices>
  try { services = createServices(database, config) }
  catch (error) { database.close(); releaseLock(); throw error }
  const { plugins, permissions, sessions, workspace, models, mon, directors, companion, questions, memoryExtractions } = services
  const selfAwakeHttp = new SelfAwakeHttp(config.origin, services.selfAwakeBridge)
  const blobHttp = new BlobHttp(services.blobs, config)
  const drainServices = () => { services.realtimeVoice.close(); services.scheduler.close(); services.pluginHooks.close(); services.selfAwake.close(); return Promise.allSettled([services.mcpResults.close(), services.mcp.close(), services.connectorLifecycle.close(), services.speech.close(), services.voice.close(), services.subagentLifecycle.close(), services.packageAssets.close(), services.pluginMarket.close(), services.skills.close(), selfAwakeHttp.close(), services.selfAwakeActions.close(), memoryExtractions.close(), blobHttp.close(), plugins.close(), sessions.close(),
    mon.close(), companion.close(), Promise.resolve().then(() => services.media.close()), Promise.resolve().then(() => questions.close())]) }
  const health = healthHandler(config.origin, () => ({ migrationReview: Boolean(config.migrationReview), model: Boolean(config.model), sessionFaults: sessions.faultCount(),
    memoryExtraction: memoryExtractions.fault === undefined, jobs: services.scheduler.fault === undefined, pluginHooks: services.pluginHooks.fault === undefined, subagents: services.subagentLifecycle.fault === undefined, selfAwake: services.selfAwake.fault === undefined && services.selfAwakeActions.fault === undefined }))
  const http = createServer((request, response) => {
    if (!config.migrationReview && selfAwakeHttp.handle(request, response)) return
    if ((!config.migrationReview || ['GET','OPTIONS'].includes(request.method ?? '')) && blobHttp.handle(request, response)) return
    health(request, response)
  })
  const websocket = attachWebsocket(http, config, sessions, {
    'memo.job.resubmit': contractHandler(rpcMethods['memo.job.resubmit'], input => services.memoJobRecovery.resubmit(input.id, input.expectedUpdatedAt, input.note)),
    'plugin.hook.resubmit': contractHandler(rpcMethods['plugin.hook.resubmit'], input => services.pluginHooks.resubmit(input.id, input.expectedUpdatedAt, input.note)),
    'runtime.status': contractHandler(rpcMethods['runtime.status'], () => ({ mode: config.migrationReview ? 'migration-review' : 'runtime', runtimeOrigin: config.origin, automaticExecution: !config.migrationReview })),
    'migration.status': contractHandler(rpcMethods['migration.status'], async () => {
      if (!config.migrationReview) throw new Error('Migration status requires review mode')
      return toJson(await readLegacyConversionStatus(config.dataRoot, config.origin))
    }),
    ...operationRoutes(services.repository), ...commandRoutes(services.commands), ...mcpRoutes(services.mcp, database, services.mcpResults), ...connectorRoutes(services.connectorCatalog, services.connectors, services.connectorEvents, services.connectorPermissions, services.connectorCredentials), ...mediaRoutes(services.media), ...voiceRoutes(services.voiceConfig, services.voice, services.speech), ...subagentRoutes(services.subagents), ...memoryExtractionRoutes(memoryExtractions), ...memoRoutes(services.memos, services.memoNotifications),
    ...notificationRoutes(services.desktopReminders),
    ...selfAwakeRoutes(services.selfAwake.repository, services.selfAwakeActions, services.selfAwake),
    ...directorRoutes(directors), ...jobRoutes(services.jobs),
    ...questionRoutes(questions),
    ...pluginAssetRoutes(services.packageAssets), ...pluginMarketRoutes(services.pluginMarket), ...skillRoutes(services.skills), ...pluginRoutes(plugins, services.pluginMarket.installed), ...permissionRoutes(permissions), ...workspaceRoutes(workspace, sessions), ...modelRoutes(models, sessions, config.origin === 'mon' ? mon : undefined),
  }, config.migrationReview ? undefined : sessionId => services.realtimeVoice.prepare(sessionId))
  try {
    if (!config.migrationReview) await services.skills.start()
    if (!config.migrationReview) await memoryExtractions.start()
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(config.port, config.host, () => { http.removeListener('error', reject); resolve() })
    })
    persistToken(config)
    if (!config.migrationReview) {
    await services.subagentLifecycle.start()
    sessions.resumePending()
    services.memos.recoverSchedules()
    services.selfAwakeActions.start()
    services.selfAwake.start()
    services.pluginHooks.start()
    services.scheduler.start()
    services.mon.startSync()
    services.mcp.start()
    services.connectorLifecycle.start()
    }
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
