import type { EdenDatabase } from '@eden/store'
import { recordSubagentUsage } from './usage-repository.ts'
import { reconcileSubagentReceipt } from './usage-reconciliation.ts'

export class SubagentRequestReview {
  constructor(private readonly database: EdenDatabase) {}

  list(agentId: string, after = '') {
    const db = this.database.connection
    if (!db.prepare('SELECT 1 FROM subagent_threads WHERE id=?').get(agentId)) throw new Error('Subagent not found')
    const rows = db.prepare(`SELECT r.*,u.tokens,u.cost_microusd,EXISTS(SELECT 1 FROM inputs i WHERE i.session_id=r.session_id AND i.turn_id=r.turn_id AND i.state='running') AS executing
      FROM subagent_model_requests r JOIN subagent_request_owners o ON o.request_id=r.id
      LEFT JOIN subagent_usage_receipts u ON u.turn_id=r.turn_id AND u.message_id=r.id WHERE o.agent_id=?
      AND (r.state='pending' OR (r.state='responded' AND (u.tokens IS NULL OR u.cost_microusd IS NULL))) AND r.id>?
      ORDER BY r.id LIMIT 51`).all(agentId, after)
    const visible = rows.slice(0, 50)
    return { items: visible.map(row => ({ id: String(row.id), agentId: String(row.agent_id), turnId: String(row.turn_id),
      createdAt: Number(row.created_at), executing: row.executing === 1, costConfigured: row.cost_configured === 1,
      tokens: row.tokens == null ? null : Number(row.tokens), costMicrousd: row.cost_microusd == null ? null : Number(row.cost_microusd) })),
      nextCursor: rows.length > 50 ? String(visible.at(-1)!.id) : null }
  }

  resolve(agentId: string, requestId: string, tokens: number, costMicrousd: number, note: string) {
    this.database.transaction(() => {
      const db = this.database.connection
      const row = db.prepare(`SELECT r.* FROM subagent_model_requests r JOIN subagent_request_owners o ON o.request_id=r.id WHERE r.id=? AND o.agent_id=?`).get(requestId, agentId)
      if (!row) throw new Error('Model request does not belong to this subagent subtree')
      if (row.state === 'reviewed') {
        const receipt = db.prepare('SELECT tokens,cost_microusd FROM subagent_usage_receipts WHERE turn_id=? AND message_id=?').get(row.turn_id!, requestId)
        if (receipt?.tokens !== tokens || receipt.cost_microusd !== costMicrousd || row.note !== note) throw new Error('Request already reviewed with different usage or evidence')
        return
      }
      if (!['pending','responded'].includes(String(row.state))) throw new Error('Request cannot be reviewed')
      if (db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND turn_id=? AND state='running'").get(row.session_id!, row.turn_id!)) throw new Error('Wait for the original execution to stop before reviewing usage')
      if (row.state === 'responded') reconcileSubagentReceipt(this.database, requestId, String(row.turn_id), tokens, costMicrousd)
      else recordSubagentUsage(this.database, String(row.session_id), String(row.turn_id), requestId, {
        costConfigured: true, message: { role: 'assistant', usage: { totalTokens: tokens, costMicrousd } },
      })
      db.prepare("UPDATE subagent_model_requests SET state='reviewed',resolved_at=?,note=? WHERE id=?").run(Date.now(), note, requestId)
    })
    return { requestId, state: 'reviewed' as const }
  }
}
