import { createHash, randomUUID } from 'node:crypto'
import { open, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { activateLegacyImport, syncActivationDirectory } from './activation.ts'
import { withActivationLock } from './activation-plan.ts'
import { readPublicationGroup } from './publication-group.ts'

const entry = z.object({ snapshot: z.string(), root: z.string(), confirmation: z.string() }).strict()
const requestSchema = z.object({ mon: entry, local: entry, confirmJointActivation: z.literal(true) }).strict()

export async function publishGroup(filename: string, value: unknown) {
  const temporary = `${filename}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync() }
  finally { await file.close() }
  try { await rename(temporary, filename); await syncActivationDirectory(path.dirname(filename)) }
  finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
}

export async function activateLegacyPair(groupFile: string, raw: unknown) {
  const request = requestSchema.parse(raw)
  if (!path.isAbsolute(groupFile)) throw new Error('Publication group filename must be absolute')
  groupFile = path.join(await realpath(path.dirname(groupFile)), path.basename(groupFile))
  for (const origin of ['mon', 'local'] as const) {
    for (const field of ['snapshot', 'root', 'confirmation'] as const) {
      if (!path.isAbsolute(request[origin][field])) throw new Error('Joint activation requires absolute source and target paths')
      request[origin][field] = await realpath(request[origin][field])
    }
  }
  const roots = { mon: request.mon.root, local: request.local.root }
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child)
    return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
  }
  if (contains(roots.mon, roots.local) || contains(roots.local, roots.mon)) throw new Error('Joint activation requires separate non-nested world directories')
  for (const root of Object.values(roots)) if (groupFile.startsWith(root + path.sep)) throw new Error('Publication group must live outside both runtime roots')
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  const lockPath = `${groupFile}.lock`, lock = await open(lockPath, 'wx', 0o600)
  try {
    await lock.writeFile('Joint activation in progress. Confirm process exit before removing a stale lock.\n'); await lock.sync()
    let group
    try { group = readPublicationGroup(groupFile) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (group && (group.requestHash !== requestHash || group.state === 'blocked')) throw new Error('Publication group belongs to another request or is blocked')
    if (!group) {
      group = { format: 'eden.publication-group.v1' as const, id: randomUUID(), requestHash, roots, state: 'preparing' as const, activationIds: null }
      await publishGroup(groupFile, group)
    }
    const publicationGroup = { filename: groupFile, id: group.id }
    const mon = await activateLegacyImport(request.mon.snapshot, roots.mon, 'mon', request.mon.confirmation, publicationGroup)
    const local = await activateLegacyImport(request.local.snapshot, roots.local, 'local', request.local.confirmation, publicationGroup)
    const ordered = [roots.mon, roots.local].sort()
    return await withActivationLock(ordered[0]!, () => withActivationLock(ordered[1]!, async () => {
      for (const [origin, result] of [['mon', mon], ['local', local]] as const) {
        const db = new DatabaseSync(path.join(roots[origin], 'eden-agent.db'), { readOnly: true })
        try {
          const receipt = JSON.parse(String(db.prepare("SELECT value FROM realm_meta WHERE key='legacy_activation'").get()?.value))
          if (db.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()?.value !== 'complete' || receipt.activationId !== result.activationId ||
            receipt.publicationGroup?.id !== publicationGroup.id || receipt.publicationGroup?.filename !== groupFile) throw new Error('Publication member changed before joint commit')
        } finally { db.close() }
      }
      const ready = { ...group, state: 'ready' as const, activationIds: { mon: mon.activationId, local: local.activationId } }
      await publishGroup(groupFile, ready)
      return { ...ready, filename: groupFile, note: 'Both databases published. Select these roots together before restarting the launcher.' }
    }))
  } finally { await lock.close(); await unlink(lockPath) }
}
