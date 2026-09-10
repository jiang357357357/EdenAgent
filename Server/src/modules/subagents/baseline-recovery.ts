import { createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import { readBaselineLedger } from './baseline-ledger.ts'
import type { SQLOutputValue, DatabaseSync } from 'node:sqlite'

/** Historical totals exclude the separately preserved TS request ledger. */
export class SubagentBaselineRecovery {
  constructor(private readonly database: EdenDatabase) { }
  private source(agentId: string) {
    const db = this.database.connection
    const row = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(agentId)
    const legacy = db.prepare('SELECT state,usage_json FROM legacy_subagent_context WHERE agent_id=?').get(agentId)
    if (!row || !legacy) throw new Error('Historical baseline review requires a task awaiting recovery')
    if (!row.legacy_usage_unknown && !row.legacy_cost_unknown) throw new Error('Historical baseline has no unknown fields')
    // Stop the subtree while binding historical evidence and the current request ledger.
    const subtree = db.prepare(`WITH RECURSIVE tree(id,child_session_id) AS (
      SELECT id,child_session_id FROM subagent_threads WHERE id=? UNION
      SELECT t.id,t.child_session_id FROM subagent_threads t JOIN tree p ON t.parent_id=p.id)
      SELECT t.* FROM subagent_threads t JOIN tree x ON x.id=t.id ORDER BY t.id`).all(agentId)
    for (const item of subtree) {
      if (['queued', 'running'].includes(String(item.state)) || db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state='running' LIMIT 1").get(item.child_session_id!)) throw new Error('Stop all descendants before reviewing the historical total')
      if (item.id !== agentId && (item.usage_unknown || item.cost_unknown)) throw new Error('Review descendant historical totals first')
    }
    const ledger = readBaselineLedger(this.database, agentId)
    const historicalTokens = Number(row.tokens_used) - ledger.tokens, historicalCost = Number(row.cost_microusd_used) - ledger.costMicrousd
    if (!Number.isSafeInteger(historicalTokens) || !Number.isSafeInteger(historicalCost) || historicalTokens < 0 || historicalCost < 0) throw new Error('Cumulative usage does not cover its recorded model ledger')
    const fingerprint = createHash('sha256').update(JSON.stringify({ row, legacy, subtree, ledger })).digest('hex')
    return { row, fingerprint, ledger, historicalTokens, historicalCost }
  }
  preview(agentId: string) {
    const { row, fingerprint, ledger, historicalTokens, historicalCost } = this.source(agentId)
    return {
      agentId, fingerprint, tokens: historicalTokens, costMicrousd: historicalCost, recordedTokens: ledger.tokens, recordedCostMicrousd: ledger.costMicrousd,
      tokensUnknown: Boolean(row.legacy_usage_unknown), costUnknown: Boolean(row.legacy_cost_unknown)
    }
  }
  apply(agentId: string, fingerprint: string, tokens: number, costMicrousd: number, note: string) {
    this.database.transaction(() => {
      const db = this.database.connection
      const old = db.prepare('SELECT * FROM subagent_baseline_restorations WHERE agent_id=?').get(agentId)
      if (old) {
        if (old.fingerprint !== fingerprint || old.tokens !== tokens || old.cost_microusd !== costMicrousd || old.note !== note) throw new Error('Historical total was already reviewed with different evidence')
        return
      }
      const current = this.source(agentId), row = current.row
      if (current.fingerprint !== fingerprint) throw new Error('Task accounting changed; reload the historical total')
      if (tokens < current.historicalTokens || costMicrousd < current.historicalCost) throw new Error('Confirmed totals cannot erase recorded usage')
      if (!row.legacy_usage_unknown && tokens !== current.historicalTokens || !row.legacy_cost_unknown && costMicrousd !== current.historicalCost) throw new Error('Known historical amounts must remain unchanged')
      const totalTokens = tokens + current.ledger.tokens, totalCost = costMicrousd + current.ledger.costMicrousd
      if (!Number.isSafeInteger(totalTokens) || !Number.isSafeInteger(totalCost)) throw new Error('Confirmed usage exceeds exact accounting range')
      invalidateAncestorBaselines(current, row, db, agentId, tokens, costMicrousd)
      db.prepare('INSERT INTO subagent_baseline_restorations VALUES(?,?,?,?,?,?,?)')
        .run(agentId, fingerprint, JSON.stringify({ tokens: row.tokens_used, costMicrousd: row.cost_microusd_used, historicalTokens: current.historicalTokens, historicalCostMicrousd: current.historicalCost, ledger: current.ledger }), tokens, costMicrousd, note, Date.now())
      db.prepare(`UPDATE subagent_threads SET tokens_used=?,cost_microusd_used=?,legacy_usage_unknown=0,legacy_cost_unknown=0,
        usage_unknown=0,cost_unknown=0,updated_at=? WHERE id=?`).run(totalTokens, totalCost, Date.now(), agentId)
    })

  }
}

function invalidateAncestorBaselines(current: { historicalTokens: number; historicalCost: number }, row: Record<string, SQLOutputValue>, db: DatabaseSync, agentId: string, tokens: number, costMicrousd: number) {

  const tokensChanged = tokens !== current.historicalTokens, costChanged = costMicrousd !== current.historicalCost
  let parentId = row.parent_id
  const seen = new Set([agentId])
  while (parentId != null) {
    const id = String(parentId)
    if (seen.has(id) || seen.size >= 4) throw new Error('Invalid historical accounting ancestry')
    seen.add(id)
    const parent = db.prepare('SELECT parent_id,state,child_session_id FROM subagent_threads WHERE id=?').get(id)
    if (!parent || ['queued', 'running'].includes(String(parent.state)) || db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state IN ('queued','running') LIMIT 1").get(parent.child_session_id!)) throw new Error('Stop the parent task before reviewing descendant usage')
    if (tokensChanged || costChanged) {
      // Historical ancestor totals may already include the child. Never add twice or silently clear uncertainty.
      if (db.prepare('SELECT 1 FROM subagent_baseline_restorations WHERE agent_id=?').get(id)) throw new Error('Ancestor total was already confirmed; review ordering is inconsistent')
      db.prepare(`UPDATE subagent_threads SET legacy_usage_unknown=MAX(legacy_usage_unknown,?),usage_unknown=MAX(usage_unknown,?),
            legacy_cost_unknown=MAX(legacy_cost_unknown,?),cost_unknown=MAX(cost_unknown,?),updated_at=? WHERE id=?`)
        .run(Number(tokensChanged), Number(tokensChanged), Number(costChanged), Number(costChanged), Date.now(), id)
    }
    parentId = parent.parent_id
  }

}
