import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Replaced by esbuild; direct source execution uses the development artifact tree.
declare const EDEN_BUNDLED_SERVER: boolean
export function officialConnectorPackage(key: string) {
  if (!['hoi4', 'victoria3', 'lichess', 'openttd'].includes(key)) throw new Error('Unknown official connector')
  if (typeof EDEN_BUNDLED_SERVER !== 'undefined' && EDEN_BUNDLED_SERVER) {
    return fileURLToPath(new URL(`../connectors/${key}/`, import.meta.url))
  }
  const built = fileURLToPath(new URL(`../../../../dist/connectors/${key}/`, import.meta.url))
  if (existsSync(built)) return built
  // Allow catalog browsing before native artifacts are built. Missing workers remain unavailable.
  return path.resolve(fileURLToPath(new URL(`../../../../Connectors/official/${key}/package/`, import.meta.url)))
}
