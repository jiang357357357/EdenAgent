import { createMoncoreSyncHooks, getMoncoreConfig } from "@/integrations/moncore"

export function createServerMoncoreIntegration() {
  const config = getMoncoreConfig()

  return {
    config,
    sync: createMoncoreSyncHooks(),
  }
}

