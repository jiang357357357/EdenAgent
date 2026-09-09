import type { EdenDatabase } from '@eden/store'

/** Only settled, owned receipts can be subtracted from a cumulative historical baseline. */
export function readBaselineLedger(database: EdenDatabase, agentId: string) {
  const db = database.connection
  const rows = db.prepare(`SELECT r.id,r.agent_id,r.turn_id,r.state,u.tokens,u.cost_microusd
    FROM subagent_request_owners o JOIN subagent_model_requests r ON r.id=o.request_id
    LEFT JOIN subagent_usage_receipts u ON u.turn_id=r.turn_id AND u.message_id=r.id AND u.agent_id=r.agent_id
    WHERE o.agent_id=? ORDER BY r.id`).all(agentId)
  const orphan = db.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM subagent_threads WHERE id=? UNION
    SELECT t.id FROM subagent_threads t JOIN tree p ON t.parent_id=p.id)
    SELECT 1 FROM subagent_usage_receipts u JOIN tree t ON t.id=u.agent_id WHERE NOT EXISTS(
      SELECT 1 FROM subagent_model_requests r JOIN subagent_request_owners o ON o.request_id=r.id
      WHERE r.id=u.message_id AND r.turn_id=u.turn_id AND r.agent_id=u.agent_id AND o.agent_id=?) LIMIT 1`).get(agentId, agentId)
  if (orphan) throw new Error('Usage receipts have no matching budget ownership; reconcile the ledger before historical review')
  let tokens = 0, costMicrousd = 0
  for (const row of rows) {
    if (!['responded', 'reviewed'].includes(String(row.state)) || row.tokens == null || row.cost_microusd == null) throw new Error('Review pending requests and missing receipt amounts before confirming historical usage')
    tokens += Number(row.tokens); costMicrousd += Number(row.cost_microusd)
    if (!Number.isSafeInteger(tokens) || !Number.isSafeInteger(costMicrousd) || tokens < 0 || costMicrousd < 0) throw new Error('Model ledger exceeds exact accounting range')
  }
  return { rows, tokens, costMicrousd }
}
