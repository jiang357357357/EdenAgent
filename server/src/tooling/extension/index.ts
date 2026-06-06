import type { ToolProvider } from "../types"

export interface ToolExtensionConfig {
  packageName: string
  enabled?: boolean
}

export function loadConfiguredToolExtensions(): ToolProvider[] {
  // Extension loading will be wired here. Builtin tools remain the only active source for now.
  return []
}
