import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { DatabaseSync } from 'node:sqlite'

export const publicationGroupSchema = z.object({ format: z.literal('eden.publication-group.v1'), id: z.uuid(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(['preparing', 'ready', 'blocked']),
  roots: z.object({ mon: z.string(), local: z.string() }),
  activationIds: z.object({ mon: z.uuid(), local: z.uuid() }).nullable(),
  rollbackNote: z.string().trim().min(1).max(4000).optional(),
}).strict()

export function readPublicationGroup(filename: string) {
  if (!path.isAbsolute(filename)) throw new Error('Publication group path must be absolute')
  const info = lstatSync(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw new Error('Invalid publication group file')
  return publicationGroupSchema.parse(JSON.parse(readFileSync(filename, 'utf8')))
}

export function assertPublicationGroup(db: DatabaseSync, filename: string, origin: 'mon' | 'local') {
  const row = db.prepare("SELECT value FROM realm_meta WHERE key='legacy_activation'").get()
  if (!row) return
  const receipt = JSON.parse(String(row.value))
  if (!receipt.publicationGroup) return
  const group = readPublicationGroup(receipt.publicationGroup.filename)
  if (group.id !== receipt.publicationGroup.id || group.state !== 'ready' || group.activationIds?.[origin] !== receipt.activationId ||
    realpathSync(group.roots[origin]) !== realpathSync(path.dirname(filename))) throw new Error('Both worlds must finish joint publication before this runtime can start')
}
