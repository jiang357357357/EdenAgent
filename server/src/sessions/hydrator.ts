import type { CoreClient } from "../core"
import type { SessionStore } from "./store"

export interface RuntimeSessionHydratorOptions {
  coreClient: CoreClient
  store: SessionStore
  hydratedSessionIDs: Set<string>
}

export class RuntimeSessionHydrator {
  private readonly coreClient: CoreClient
  private readonly store: SessionStore
  private readonly hydratedSessionIDs: Set<string>

  constructor(options: RuntimeSessionHydratorOptions) {
    this.coreClient = options.coreClient
    this.store = options.store
    this.hydratedSessionIDs = options.hydratedSessionIDs
  }

  markHydrated(sessionID: string) {
    this.hydratedSessionIDs.add(sessionID)
  }

  async hydrate(token: string, sessionID: string) {
    const snapshot = await this.coreClient.getAgentSession(token, sessionID)
    this.store.upsertSessionInfo(snapshot.info)
    this.store.hydrateMessages(sessionID, snapshot.messages)
    this.markHydrated(sessionID)
    return snapshot
  }

  async ensure(token: string, sessionID: string) {
    try {
      const session = this.store.requireSession(sessionID)
      if (this.hydratedSessionIDs.has(sessionID)) return session
    } catch {
      // Fall through to hydrate from Core.
    }

    await this.hydrate(token, sessionID)
    return this.store.requireSession(sessionID)
  }
}
