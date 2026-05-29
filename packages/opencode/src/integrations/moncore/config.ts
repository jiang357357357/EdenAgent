import { readStoredMoncoreAuthSync } from "./auth"
import type { MoncoreID, MoncoreOpencodeSettings } from "./types"

export type MoncoreConfig = {
  enabled: boolean
  baseUrl: string
  token?: string
  userID?: MoncoreID
  opencodeSettings?: MoncoreOpencodeSettings
}

const env = typeof process === "undefined" ? undefined : process.env

export function getMoncoreConfig(): MoncoreConfig {
  const stored = readStoredMoncoreAuthSync()
  const baseUrl = env?.MONCORE_BASE_URL?.trim() || stored?.baseUrl || ""
  const token = env?.MONCORE_TOKEN?.trim() || stored?.token || undefined
  const enabledFromEnv = env?.MONCORE_ENABLED === "1" || env?.MONCORE_ENABLED === "true"

  return {
    enabled: enabledFromEnv || Boolean(baseUrl && token),
    baseUrl,
    token,
    userID: stored?.userID,
    opencodeSettings: stored?.opencodeSettings,
  }
}
