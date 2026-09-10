import { randomUUID, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, link, unlink, chmod, lstat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { z } from 'zod'
import { buildActivationPlan, withActivationLock } from './activation-plan.ts'

const confirmationSchema = z.object({
  format: z.literal('eden.activation-confirmation.v1'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), note: z.string().trim().min(1).max(4000),
  compatibilityEvidence: z.string().trim().min(1).max(16000), confirmActivation: z.literal(true),
}).strict()

async function confirmation(filename: string) {
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const initial = await file.stat()
    if (!initial.isFile() || initial.size > 32768) throw new Error('Activation confirmation must be a regular JSON file of at most 32 KiB')
    const bytes = Buffer.alloc(32769), { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    const after = await file.stat()
    if (bytesRead !== initial.size || after.size !== initial.size || after.mtimeMs !== initial.mtimeMs || after.ctimeMs !== initial.ctimeMs) throw new Error('Activation confirmation changed while reading')
    return confirmationSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))))
  } finally { await file.close() }
}

export async function syncActivationDirectory(target: string) {
  if (process.platform === 'win32') return
  const directory = await open(target, 'r')
  try { await directory.sync() } finally { await directory.close() }
}

/** Publish a fully committed independent database without replacing any existing pathname. */
export async function activateLegacyImport(snapshot: string, destination: string, origin: 'mon' | 'local', confirmationFile: string,
  publicationGroup?: { filename: string; id: string }) {
  const consent = await confirmation(confirmationFile)
  const confirmationHash = createHash('sha256').update(JSON.stringify(consent)).digest('hex')
  return withActivationLock(destination, async target => {
    const runtime = path.join(target, 'eden-agent.db')
    let exists = await runtimeDatabaseExists(runtime)
    if (exists) {
      const existing = new DatabaseSync(runtime, { readOnly: true })
      try {
        const receipt = existing.prepare("SELECT value FROM realm_meta WHERE key='legacy_activation'").get()
        const prior = receipt ? JSON.parse(String(receipt.value)) : null
        if (JSON.stringify(prior?.publicationGroup ?? null) !== JSON.stringify(publicationGroup ?? null)) throw new Error('Existing activation belongs to a different publication group')
        if (existing.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== origin || prior?.confirmationHash !== confirmationHash ||
          existing.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()?.value !== 'complete') throw new Error('Existing runtime cannot be replaced or reactivated with this confirmation')
        await syncActivationDirectory(target)
        return { state: 'complete', origin, target, activationId: String(prior.activationId), alreadyActivated: true }
      } finally { existing.close() }
    }
    const plan = await buildActivationPlan(snapshot, target, origin)
    if (plan.fingerprint !== consent.fingerprint) throw new Error('Activation evidence changed; generate and review a new plan')
    if (plan.blockers.length) throw new Error(`Activation is blocked: ${plan.blockers.join('; ')}`)
    const activationId = randomUUID(), temporary = path.join(target, `.activation-${activationId}.db`)
    const receipt = {
      activationId, confirmationHash, fingerprint: consent.fingerprint, note: consent.note,
      compatibilityEvidence: consent.compatibilityEvidence, origin, target, createdAt: Date.now(), ...(publicationGroup ? { publicationGroup } : {})
    }
    try {
      const source = new DatabaseSync(plan.sourceDatabase, { readOnly: true })
      try { source.prepare('VACUUM INTO ?').run(temporary) } finally { source.close() }
      await chmod(temporary, 0o600)
      const copy = new DatabaseSync(temporary)
      try {
        copy.exec('PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE;')
        copy.prepare("UPDATE realm_meta SET value='complete' WHERE key='legacy_import_state' AND value='incomplete'").run()
        copy.prepare("INSERT INTO realm_meta(key,value) VALUES('legacy_activation',?)").run(JSON.stringify(receipt))
        copy.exec('COMMIT')
      } finally { copy.close() }
      const file = await open(temporary, 'r')
      try { await file.sync() } finally { await file.close() }
      await link(temporary, runtime)
      await syncActivationDirectory(target)
      return {
        state: 'complete', origin, target, activationId, alreadyActivated: false,
        note: 'Runtime database activated. Launch explicitly with this data root; no service or external action was started.'
      }
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
  })
}

async function runtimeDatabaseExists(runtime: string) {
  let exists = false
  try { const info = await lstat(runtime); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe runtime database'); exists = true }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return exists
}
