import { createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { SQLOutputValue, DatabaseSync } from 'node:sqlite'
const digest = (row: object) => createHash('sha256').update(JSON.stringify(row)).digest('hex')

export class SubagentMailboxRecovery {
  constructor(private readonly database: EdenDatabase) { }
  followupSource(sessionId: string, id: string, fingerprint: string) {
    const db = this.database.connection
    const row = db.prepare('SELECT * FROM legacy_subagent_mailbox WHERE id=? AND session_id=?').get(id, sessionId)
    if (!row || row.state !== 'followup_prepared' || row.kind !== 'followup' || row.sender_path !== '/root' || row.consumed_at !== null || digest(row) !== fingerprint) throw new Error('Reload the prepared historical follow-up')
    const target = db.prepare('SELECT id FROM subagent_threads WHERE root_session_id=? AND agent_path=?').get(sessionId, row.target_path!)
    if (!target || !String(row.content).trim() || String(row.content).length > 64000) throw new Error('Historical follow-up has no compatible recipient or message')
    return { agentId: String(target.id), message: String(row.content) }
  }
  existingFollowup(sessionId: string, id: string, fingerprint: string, note: string) {
    const row = this.database.connection.prepare('SELECT * FROM subagent_mailbox_followups WHERE id=?').get(id)
    if (!row) return undefined
    if (row.session_id !== sessionId || row.fingerprint !== fingerprint || row.note !== note) throw new Error('Historical follow-up was already accepted with different evidence')
    return String(row.agent_id)
  }
  recordFollowup(sessionId: string, id: string, fingerprint: string, note: string) {
    if (!this.database.inTransaction) throw new Error('Historical follow-up must commit with its job')
    const { agentId } = this.followupSource(sessionId, id, fingerprint), db = this.database.connection
    const job = db.prepare('SELECT latest_job_id FROM subagent_threads WHERE id=?').get(agentId)
    if (!job?.latest_job_id) throw new Error('Historical follow-up has no durable job')
    db.prepare('INSERT INTO subagent_mailbox_followups VALUES(?,?,?,?,?,?,?)').run(id, sessionId, agentId, fingerprint, note, job.latest_job_id, Date.now())
    db.prepare("UPDATE legacy_subagent_mailbox SET state='followup_submitted' WHERE id=?").run(id)
  }
  abandonFollowup(sessionId: string, id: string, fingerprint: string, note: string) {
    this.database.transaction(() => {
      const db = this.database.connection
      const old = db.prepare('SELECT * FROM subagent_mailbox_abandonments WHERE id=?').get(id)
      if (old) {
        if (old.session_id !== sessionId || old.fingerprint !== fingerprint || old.note !== note) throw new Error('Historical follow-up was already abandoned with different evidence')
        return
      }
      const row = db.prepare('SELECT * FROM legacy_subagent_mailbox WHERE id=? AND session_id=?').get(id, sessionId)
      if (!row || row.state !== 'followup_prepared' || digest(row) !== fingerprint) throw new Error('Reload the prepared historical follow-up before abandoning it')
      if (db.prepare('SELECT 1 FROM subagent_mailbox_followups WHERE id=?').get(id)) throw new Error('Submitted follow-up must be stopped through its task')
      db.prepare('INSERT INTO subagent_mailbox_abandonments VALUES(?,?,?,?,?,?)').run(id, sessionId, fingerprint, JSON.stringify(row), note, Date.now())
      db.prepare("UPDATE legacy_subagent_mailbox SET state='archived' WHERE id=?").run(id)
    })
    return { id, state: 'archived' as const }
  }
  private rootSender(row: Record<string, unknown>, sessionId: string) {
    if (row.target_path !== '/root' || !['message', 'completion'].includes(String(row.kind)) || typeof row.content !== 'string' || !row.content.trim() || row.content.length > 16000 || row.consumed_at !== null) return undefined
    return this.database.connection.prepare("SELECT child_session_id FROM subagent_threads WHERE root_session_id=? AND agent_path=? AND (?!='completion' OR parent_id IS NULL)").get(sessionId, String(row.sender_path), String(row.kind))
  }
  private mapped(id: string, sessionId: string) {
    return this.database.connection.prepare(`SELECT m.*,t.state AS task_state FROM subagent_messages m
      JOIN subagent_threads t ON t.id=m.agent_id WHERE m.id=? AND t.root_session_id=?`).get(id, sessionId)
  }
  list(sessionId: string, after = '') {
    const rows = this.database.connection.prepare(`SELECT * FROM legacy_subagent_mailbox WHERE session_id=? AND id>?
      AND state IN ('context_required','review_required','followup_prepared') ORDER BY id LIMIT 51`).all(sessionId, after)
    const visible = rows.slice(0, 50)
    return {
      items: visible.map(row => ({
        id: String(row.id), senderPath: String(row.sender_path), targetPath: String(row.target_path),
        kind: String(row.kind), state: String(row.state), triggerTurn: Boolean(row.trigger_turn), content: String(row.content).slice(0, 16000), truncated: String(row.content).length > 16000,
        fingerprint: digest(row), canDeliver: ['message', 'completion'].includes(String(row.kind)) && Boolean(this.mapped(String(row.id), sessionId) || this.rootSender(row, sessionId))
      })),
      nextCursor: rows.length > 50 ? String(visible.at(-1)!.id) : null
    }
  }
  resolve(sessionId: string, id: string, fingerprint: string, decision: 'deliver_message' | 'archive' | 'prepare_followup', note: string) {
    const state = decision === 'deliver_message' ? 'available' as const : decision === 'prepare_followup' ? 'followup_prepared' as const : 'archived' as const
    this.database.transaction(() => {
      const db = this.database.connection
      const row = db.prepare('SELECT * FROM legacy_subagent_mailbox WHERE id=? AND session_id=?').get(id, sessionId)
      if (!row) throw new Error('Historical mailbox item not found in this session')
      const old = db.prepare('SELECT * FROM subagent_mailbox_restorations WHERE id=?').get(id)
      if (old) {
        if (old.fingerprint !== fingerprint || old.decision !== decision || old.note !== note) throw new Error('Mailbox item already reviewed with different evidence')
        return
      }
      if (!['context_required', 'review_required'].includes(String(row.state)) || digest(row) !== fingerprint) throw new Error('Mailbox item changed; review it again')
      const mapped = this.mapped(id, sessionId)
      const rootSender = this.rootSender(row, sessionId)
      assertPreparedFollowup(decision, row, db, sessionId)
      if (mapped && (['queued', 'running'].includes(String(mapped.task_state)) || db.prepare("SELECT 1 FROM inputs WHERE session_id=(SELECT child_session_id FROM subagent_threads WHERE id=?) AND state='running' LIMIT 1").get(mapped.agent_id!))) throw new Error('Stop the recipient before reviewing its historical inbox')
      applyMailboxDelivery(rootSender, db, row, mapped, decision, sessionId, id)
      db.prepare('INSERT INTO subagent_mailbox_restorations VALUES(?,?,?,?,?)').run(id, fingerprint, decision, note, Date.now())
      db.prepare('UPDATE legacy_subagent_mailbox SET state=? WHERE id=?').run(state, id)
    })
    return { id, state }

  }
}

function assertPreparedFollowup(decision: string, row: Record<string, import('node:sqlite').SQLOutputValue>, db: import('node:sqlite').DatabaseSync, sessionId: string) {
  if (decision === 'prepare_followup') {
    if (row.kind !== 'followup' || row.sender_path !== '/root' || row.consumed_at !== null || !String(row.content).trim() || String(row.content).length > 64000 ||
      !db.prepare('SELECT 1 FROM subagent_threads WHERE root_session_id=? AND agent_path=?').get(sessionId, row.target_path!)) throw new Error('Historical follow-up requires an unconsumed root request and known recipient')
  }

}

function applyMailboxDelivery(rootSender: Record<string, SQLOutputValue> | undefined, db: DatabaseSync, row: Record<string, SQLOutputValue>, mapped: Record<string, SQLOutputValue> | undefined, decision: string, sessionId: string, id: string) {

  if (decision === 'deliver_message') {
    if (rootSender) {
      if (db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state IN ('queued','running') LIMIT 1").get(sessionId)) throw new Error('Stop the root session before releasing historical messages')
      if (Number(db.prepare('SELECT COUNT(*) AS n FROM subagent_root_messages WHERE session_id=? AND read_at IS NULL').get(sessionId)?.n) >= 128) throw new Error('Root mailbox has 128 unread messages')
      db.prepare('INSERT INTO subagent_root_messages(id,session_id,sender_session_id,message,operation_key,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, sessionId, rootSender.child_session_id!, row.content!, `legacy-mailbox:${id}`, row.created_at!)
    } else {
      if (!mapped || !['message', 'completion'].includes(String(row.kind)) || mapped.message !== row.content || mapped.read_at != null) throw new Error('Only an unread, unambiguously mapped message or completion notice can become available')
      if (row.kind === 'completion' && !db.prepare('SELECT 1 FROM subagent_threads WHERE root_session_id=? AND agent_path=? AND parent_id=?').get(sessionId, row.sender_path!, mapped.agent_id!)) throw new Error('Historical completion notice does not target its direct parent')
      const count = Number(db.prepare('SELECT COUNT(*) AS n FROM subagent_messages WHERE agent_id=? AND read_at IS NULL').get(mapped.agent_id!)?.n)
      if (count > 128) throw new Error('Archive or process excess historical messages before releasing this inbox')
    }
  } else if (mapped) db.prepare('UPDATE subagent_messages SET read_at=COALESCE(read_at,?) WHERE id=?').run(Date.now(), id)

}
