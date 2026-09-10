import { createHash } from 'node:crypto'
import { MonClient } from '@eden/integrations'
import type { EdenDatabase } from '@eden/store'

function base(value: string): string { return new URL(value.trim().replace(/\/+$/, '') + '/').href }
function scalar(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined
}

/** Verify the old account before loading models or committing replacement credentials. */
export async function prepareLegacyIdentity(database: EdenDatabase, sessionId: string | undefined,
  coreBaseUrl: string, token: string, signal: AbortSignal): Promise<() => void> {
  if (!sessionId) return () => { }
  const row = database.connection.prepare('SELECT * FROM legacy_core_identities WHERE session_id=?').get(sessionId)
  if (!row) return () => { }
  const normalized = base(coreBaseUrl)
  if (normalized !== base(String(row.core_base_url))) throw new Error('Imported session belongs to a different Core endpoint')
  const principal = String(row.principal_key)
  if (principal.startsWith('user:')) {
    await verifyAccountPrincipal(coreBaseUrl, token, signal, principal)
  } else if (principal.startsWith('credential:')) {
    const secret = token.trim().replace(/^(Token |Bearer )/, '').trim()
    const reference = `core:${createHash('sha256').update(normalized).update('\0').update(secret).digest('hex')}`
    if (reference !== row.credential_ref || principal !== `credential:${reference.slice(0, 16)}`) throw new Error('Historical credential-only identity requires its original credential or explicit account reconciliation')
  } else throw new Error('Unsupported historical Core principal identity')
  signal.throwIfAborted()
  return () => {
    if (!database.inTransaction) throw new Error('Core identity reconciliation requires the binding transaction')
    const updated = database.connection.prepare(`UPDATE legacy_core_identities SET state='rebound'
      WHERE session_id=? AND core_base_url=? AND principal_key=? AND credential_ref=? AND state=?`)
      .run(sessionId, row.core_base_url!, row.principal_key!, row.credential_ref!, row.state!)
    if (updated.changes !== 1) throw new Error('Historical Core identity changed during verification')
  }
}

async function verifyAccountPrincipal(coreBaseUrl: string, token: string, signal: AbortSignal, principal: string) {
  const raw = await new MonClient(coreBaseUrl, token).get('/api/users/me/profile/', signal)
  const profile = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const user = profile.user && typeof profile.user === 'object' && !Array.isArray(profile.user) ? profile.user : {}
  const id = scalar(profile.id) ?? scalar(user.id) ?? scalar(profile.username)
  if (!id || `user:${id}` !== principal) throw new Error('Core credential does not match the imported session principal')
}
