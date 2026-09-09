import { open, unlink, lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { readPublicationGroup } from './publication-group.ts'
import { publishGroup } from './activate-pair.ts'
import { withActivationLock } from './activation-plan.ts'
import { rollbackLegacyActivation } from './activation-rollback.ts'

export async function rollbackLegacyPair(filename: string, id: string, note: string) {
  z.uuid().parse(id)
  const reason = z.string().trim().min(1).max(4000).parse(note)
  filename = path.join(await realpath(path.dirname(filename)), path.basename(filename))
  const lockPath = `${filename}.lock`, lock = await open(lockPath, 'wx', 0o600)
  try {
    await lock.writeFile('Joint rollback in progress; confirm process exit before removing this lock.\n'); await lock.sync()
    const group = readPublicationGroup(filename)
    if (group.id !== id) throw new Error('Publication group identity changed')
    if (group.rollbackNote && group.rollbackNote !== reason) throw new Error('Publication group was already blocked with a different explanation')
    const roots = { mon: await realpath(group.roots.mon), local: await realpath(group.roots.local) }
    if (roots.mon === roots.local) throw new Error('Publication group worlds share a data root')
    const ordered = Object.values(roots).sort(), members: { origin: 'mon' | 'local'; activationId: string }[] = []
    await withActivationLock(ordered[0]!, () => withActivationLock(ordered[1]!, async () => {
      for (const origin of ['mon', 'local'] as const) {
        const database = path.join(roots[origin], 'eden-agent.db')
        try { const info = await lstat(database); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe publication member database') }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && group.activationIds === null) continue; throw error }
        const db = new DatabaseSync(database, { readOnly: true })
        try {
          const receipt = JSON.parse(String(db.prepare("SELECT value FROM realm_meta WHERE key='legacy_activation'").get()?.value))
          if (db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== origin ||
            receipt.publicationGroup?.id !== id || receipt.publicationGroup?.filename !== filename) throw new Error('Publication member belongs to another group')
          const previous = db.prepare("SELECT value FROM realm_meta WHERE key='legacy_activation_rollback'").get()
          if (previous && JSON.parse(String(previous.value)).note !== reason) throw new Error('Member was already rolled back with a different note')
          members.push({ origin, activationId: z.uuid().parse(receipt.activationId) })
        } finally { db.close() }
      }
      await publishGroup(filename, { ...group, state: 'blocked', rollbackNote: reason })
    }))
    for (const member of members) await rollbackLegacyActivation(roots[member.origin], member.origin, member.activationId, reason)
    return { state: 'blocked', id, roots, members, note: 'Both worlds disabled. Published data retained; restore the previous launch selection explicitly.' }
  } finally { await lock.close(); await unlink(lockPath) }
}
