import { getMoncoreConfig } from "./config"

export type MoncoreSyncHooks = {
  onSessionCreated?: (sessionID: string) => Promise<void> | void
  onMessageUpdated?: (sessionID: string, messageID: string) => Promise<void> | void
}

export function createMoncoreSyncHooks(hooks: MoncoreSyncHooks = {}) {
  const config = getMoncoreConfig()

  return {
    enabled: config.enabled,
    async sessionCreated(sessionID: string) {
      if (!config.enabled) return
      await hooks.onSessionCreated?.(sessionID)
    },
    async messageUpdated(sessionID: string, messageID: string) {
      if (!config.enabled) return
      await hooks.onMessageUpdated?.(sessionID, messageID)
    },
  }
}

