import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { z } from 'zod'
import type { ServerConfig } from './config.ts'

/** Called under the realm process lock, closing the gap between launcher selection and process ownership. */
export function assertRuntimeSelection(config: ServerConfig) {
  if (!config.selection) return
  const file = lstatSync(config.selection.filename)
  if (!file.isFile() || file.isSymbolicLink() || file.size > 65536) throw new Error('Unsafe runtime selection file')
  const value = z.object({ format: z.literal('eden.runtime-selection.v1'), revision: z.uuid(),
    roots: z.object({ mon: z.string(), local: z.string() }) }).parse(JSON.parse(readFileSync(config.selection.filename, 'utf8')))
  if (value.revision !== config.selection.revision || realpathSync(value.roots[config.origin]) !== realpathSync(config.dataRoot)) throw new Error('Runtime selection changed before startup; restart the launcher')
}
