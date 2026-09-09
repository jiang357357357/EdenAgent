import { DatabaseSync } from 'node:sqlite'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { withActivationLock } from './activation-plan.ts'
import { readPublicationGroup } from './publication-group.ts'

/** Stop future use, retain the complete post-cutover database and every external-effect receipt. */
export async function rollbackLegacyActivation(destination: string, origin: 'mon' | 'local', activationId: string, note: string) {
  z.uuid().parse(activationId)
  const reason = z.string().trim().min(1).max(4000).parse(note)
  return withActivationLock(destination, async target => {
    const filename = path.join(target, 'eden-agent.db'), info = await lstat(filename)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Rollback requires a regular runtime database')
    const db = new DatabaseSync(filename)
    try {
      db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE;')
      if (db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== origin) throw new Error('Rollback world mismatch')
      const activation = db.prepare("SELECT value FROM realm_meta WHERE key='legacy_activation'").get()
      if (!activation || JSON.parse(String(activation.value)).activationId !== activationId) throw new Error('Rollback activation identity mismatch')
      const group = JSON.parse(String(activation.value)).publicationGroup
      if (group) {
        const publication = readPublicationGroup(group.filename)
        if (publication.id !== group.id || publication.state !== 'blocked') throw new Error('Use joint rollback to block both worlds before rolling back this member')
      }
      const previous = db.prepare("SELECT value FROM realm_meta WHERE key='legacy_activation_rollback'").get()
      if (previous) {
        if (JSON.parse(String(previous.value)).note !== reason) throw new Error('Activation already rolled back with a different explanation')
      } else {
        if (db.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()?.value !== 'complete') throw new Error('Runtime is not an active migration')
        db.prepare("INSERT INTO realm_meta VALUES('legacy_activation_rollback',?)").run(JSON.stringify({ activationId, note: reason, createdAt: Date.now() }))
        db.prepare("UPDATE realm_meta SET value='rolled_back' WHERE key='legacy_import_state'").run()
      }
      db.exec('COMMIT')
      return { state: 'rolled_back', origin, target, activationId,
        note: 'New runtime disabled; all post-cutover data retained. Restore the previous host launch configuration explicitly. External effects and shared files have not been undone or merged into the old database.' }
    } finally { db.close() }
  })
}
