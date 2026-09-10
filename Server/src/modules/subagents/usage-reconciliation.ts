import type { EdenDatabase } from '@eden/store'
import type { SQLOutputValue, DatabaseSync } from 'node:sqlite'

/** Fill missing receipt fields only. Known provider amounts cannot be silently revised. */
export function reconcileSubagentReceipt(database: EdenDatabase, requestId: string, turnId: string, tokens: number, costMicrousd: number): void {
  if (!database.inTransaction) throw new Error('Receipt reconciliation requires an owning transaction')
  const db = database.connection
  const receipt = db.prepare('SELECT * FROM subagent_usage_receipts WHERE turn_id=? AND message_id=?').get(turnId, requestId)
  if (!receipt || receipt.tokens !== null && receipt.cost_microusd !== null) throw new Error('Receipt has no missing usage to reconcile')
  if (receipt.tokens !== null && receipt.tokens !== tokens || receipt.cost_microusd !== null && receipt.cost_microusd !== costMicrousd) throw new Error('Previously recorded usage must remain unchanged')
  const tokenDelta = receipt.tokens === null ? tokens : 0, costDelta = receipt.cost_microusd === null ? costMicrousd : 0
  const owners = db.prepare('SELECT agent_id FROM subagent_request_owners WHERE request_id=?').all(requestId)
  if (!owners.length || owners.length > 4) throw new Error('Request has invalid budget ownership')
  db.prepare('UPDATE subagent_usage_receipts SET tokens=?,cost_microusd=? WHERE turn_id=? AND message_id=?').run(tokens, costMicrousd, turnId, requestId)
  reconcileBudgetOwners(owners, db, tokenDelta, costDelta)
}

function reconcileBudgetOwners(owners: Record<string, SQLOutputValue>[], db: DatabaseSync, tokenDelta: number, costDelta: number) {
  for (const owner of owners) {
    const row = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(owner.agent_id!)
    if (!row) throw new Error('Request budget owner is missing')
    const totalTokens = Number(row.tokens_used) + tokenDelta, totalCost = Number(row.cost_microusd_used) + costDelta
    if (!Number.isSafeInteger(totalTokens) || !Number.isSafeInteger(totalCost)) throw new Error('Usage exceeds exact accounting range')
    const unknown = db.prepare(`SELECT MAX(u.tokens IS NULL) AS tokens,MAX(u.cost_microusd IS NULL) AS cost FROM subagent_request_owners o
      JOIN subagent_model_requests r ON r.id=o.request_id JOIN subagent_usage_receipts u ON u.turn_id=r.turn_id AND u.message_id=r.id WHERE o.agent_id=?`).get(owner.agent_id!)
    db.prepare('UPDATE subagent_threads SET tokens_used=?,cost_microusd_used=?,usage_unknown=?,cost_unknown=?,updated_at=? WHERE id=?')
      .run(totalTokens, totalCost, Number(Boolean(row.legacy_usage_unknown || unknown?.tokens)), Number(Boolean(row.legacy_cost_unknown || unknown?.cost)), Date.now(), owner.agent_id!)
  }
}
