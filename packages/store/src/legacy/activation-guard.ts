import { lstatSync } from 'node:fs'
import path from 'node:path'

function exists(filename: string): boolean {
  try { lstatSync(filename); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

/** Post-cutover assets share this root; the pre-cutover database must stay frozen. */
export function assertStagingMutable(target: string): void {
  if (exists(path.join(target, 'eden-agent.db'))) throw new Error('This staging root has a published runtime database; its pre-activation copy is frozen, including after rollback')
}

export function assertRuntimePublished(filename: string): void {
  if (path.basename(filename) === 'eden-agent.db' && !exists(filename) && exists(path.join(path.dirname(filename), 'agent.sqlite'))) {
    throw new Error('Staged migration requires explicit activation; refusing to create an empty runtime beside it')
  }
}
