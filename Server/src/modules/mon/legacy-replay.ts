import { MonClient } from '@eden/integrations'
import { monLegacyReplaySchema, toJson } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
import type { MonConnectionRepository } from './connection-repository.ts'
import { prepareLegacyIdentity } from './legacy-identity.ts'
import { legacyProjectionPlan, deliverLegacyProjection } from './legacy-projection.ts'
import { LegacyReplayRepository } from './legacy-replay-repository.ts'

export async function replayLegacyDelivery(sessions: SessionRepository, connections: MonConnectionRepository, raw: unknown, signal: AbortSignal) {
  const input = monLegacyReplaySchema.parse(raw)
  const connection = connections.read(input.sessionId)
  if (!connection) throw new Error('Refresh the imported session model catalogue before replay')
  const db = sessions.database.connection
  const row = db.prepare('SELECT kind,payload_json,credential_ref FROM legacy_core_outbox WHERE id=? AND session_id=?').get(input.id, input.sessionId)
  if (!row) throw new Error('Historical delivery not found in this session')
  const identity = db.prepare('SELECT state,credential_ref FROM legacy_core_identities WHERE session_id=?').get(input.sessionId)
  if (!identity || identity.state !== 'rebound' || identity.credential_ref !== row.credential_ref) throw new Error('Historical delivery credential ownership has not been reconciled')
  const payload = String(row.payload_json), plan = legacyProjectionPlan(String(row.kind), input.sessionId, JSON.parse(payload))
  await prepareLegacyIdentity(sessions.database, input.sessionId, connection.coreBaseUrl, connection.coreToken, signal)
  const ledger = new LegacyReplayRepository(sessions)
  const assertConnection = () => {
    signal.throwIfAborted()
    if (sessions.read(input.sessionId).status !== 'active') throw new Error('Replay session is no longer active')
    const current = connections.read(input.sessionId)
    if (!current || current.coreBaseUrl !== connection.coreBaseUrl || current.coreToken !== connection.coreToken) throw new Error('Core connection changed during replay')
    const currentIdentity = db.prepare('SELECT state,credential_ref FROM legacy_core_identities WHERE session_id=?').get(input.sessionId)
    if (currentIdentity?.state !== 'rebound' || currentIdentity.credential_ref !== row.credential_ref) throw new Error('Historical identity changed during replay')
  }
  assertConnection()
  const started = ledger.begin(input, payload)
  if (!started.fresh) return toJson(started.replay)
  let receipt
  try {
    receipt = await deliverLegacyProjection(new MonClient(connection.coreBaseUrl, connection.coreToken), plan, signal,
      () => { assertConnection(); ledger.assertRunning(input.requestKey) })
    assertConnection()
  } catch {
    return toJson(ledger.finish(input.requestKey, null, 'Historical replay response was not confirmed; review before another attempt'))
  }
  return toJson(ledger.finish(input.requestKey, receipt))
}
