import { CoreClient } from "../core"
import { PermissionBroker, QuestionBroker } from "../interaction"
import { MonAgentRuntime } from "../runtime"
import { RuntimeSessionHydrator, SessionStore } from "../sessions"
import { EventBus, createLogger } from "../shared"
import type { AgentServerConfig } from "./config"

export function createAgentApp(config: AgentServerConfig) {
  const logger = createLogger("Server", config.logLevel)
  const runtimeLogger = createLogger("Runtime", config.logLevel)
  const coreLogger = createLogger("Core", config.logLevel)

  const events = new EventBus()
  const permissions = new PermissionBroker(events)
  const questions = new QuestionBroker(events)
  const store = new SessionStore()
  const hydratedSessionIDs = new Set<string>()
  const coreClient = new CoreClient({
    baseUrl: config.coreBaseUrl,
    logger: coreLogger,
  })
  const sessionHydrator = new RuntimeSessionHydrator({
    coreClient,
    store,
    hydratedSessionIDs,
  })

  const runtime = new MonAgentRuntime({
    workspaceRoot: config.workspaceRoot,
    events,
    permissions,
    questions,
    store,
    logger: runtimeLogger,
    coreClient,
    resolveCoreConfig: (token) => coreClient.resolveRuntimeConfig(token),
    syncCoreSession: async (token, sessionID, core) => {
      const session = store.requireSession(sessionID)
      await coreClient.syncAgentSession(token, session.info, core)
    },
    syncCoreMessage: async (token, sessionID, message, core) => {
      const session = store.requireSession(sessionID)
      await coreClient.syncAgentMessage(token, session.info, message, core)
    },
  })

  return {
    logger,
    events,
    permissions,
    questions,
    store,
    sessionHydrator,
    coreClient,
    runtime,
  }
}
