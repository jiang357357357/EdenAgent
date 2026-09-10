import { randomUUID } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
export class SubagentMailbox {
  constructor(private readonly database: EdenDatabase) {}
  sendRoot(sessionId: string, senderSessionId: string, message: string, key: string) {
    if (!message.trim() || message.length > 16000) throw new Error('Root message must contain 1–16000 characters')
    return this.database.transaction(() => {
      const db = this.database.connection
      const sender = db.prepare('SELECT 1 FROM subagent_threads WHERE child_session_id=? AND root_session_id=?').get(senderSessionId, sessionId)
      if (!sender) throw new Error('Root mailbox sender must belong to this task tree')
      const old = db.prepare('SELECT * FROM subagent_root_messages WHERE session_id=? AND operation_key=?').get(sessionId, key)
      if (old) {
        if (old.sender_session_id !== senderSessionId || old.message !== message) throw new Error('Root message key conflicts with earlier content')
        return { id: String(old.id), queued: true }
      }
      if (Number(db.prepare('SELECT COUNT(*) AS count FROM subagent_root_messages WHERE session_id=? AND read_at IS NULL').get(sessionId)?.count) >= 128) throw new Error('Root mailbox has 128 unread messages')
      const id = randomUUID()
      db.prepare('INSERT INTO subagent_root_messages(id,session_id,sender_session_id,message,operation_key,created_at) VALUES(?,?,?,?,?,?)').run(id, sessionId, senderSessionId, message, key, Date.now())
      return { id, queued: true }
    })
  }
  receiveRoot(sessionId: string) {
    return this.database.transaction(() => {
      const db = this.database.connection
      const rows = db.prepare(`SELECT m.*,l.kind AS legacy_kind,l.details_json FROM subagent_root_messages m
        LEFT JOIN legacy_subagent_mailbox l ON l.id=m.id WHERE m.session_id=? AND m.read_at IS NULL
        ORDER BY m.created_at,m.id LIMIT 10`).all(sessionId)
      for (const row of rows) db.prepare('UPDATE subagent_root_messages SET read_at=? WHERE id=?').run(Date.now(), row.id!)
      return rows.map(row => ({ id: String(row.id), senderSessionId: String(row.sender_session_id), message: String(row.message), createdAt: Number(row.created_at),
        kind: row.legacy_kind === null ? 'message' : String(row.legacy_kind), historical: row.legacy_kind !== null,
        details: messageDetails(row.details_json) }))
    })
  }
  send(agentId: string, senderSessionId: string, message: string, key: string = randomUUID()) {
    if (!message.trim() || message.length > 16000) throw new Error('Subagent message must contain 1–16000 characters')
    return this.database.transaction(() => {
      const old = this.database.connection.prepare('SELECT id,message,sender_session_id FROM subagent_messages WHERE agent_id=? AND operation_key=?').get(agentId, key)
      if (old) {
        if (old.message !== message || old.sender_session_id !== senderSessionId) throw new Error('Message key belongs to different content')
        return { id: String(old.id), agentId, queued: true }
      }
      const count = Number(this.database.connection.prepare('SELECT COUNT(*) AS n FROM subagent_messages WHERE agent_id=? AND read_at IS NULL').get(agentId)?.n)
      if (count >= 128) throw new Error('Subagent mailbox has 128 unread messages')
      const id = randomUUID()
      this.database.connection.prepare('INSERT INTO subagent_messages(id,agent_id,sender_session_id,message,operation_key,created_at) VALUES(?,?,?,?,?,?)').run(id, agentId, senderSessionId, message, key, Date.now())
      return { id, agentId, queued: true }
    })
  }
  receive(agentId: string) {
    return this.database.transaction(() => {
      const rows = this.database.connection.prepare(`SELECT m.*,l.kind AS legacy_kind,l.details_json FROM subagent_messages m LEFT JOIN legacy_subagent_mailbox l ON l.id=m.id
        WHERE m.agent_id=? AND m.read_at IS NULL AND (l.id IS NULL OR l.state='available') ORDER BY m.seq LIMIT 10`).all(agentId)
      for (const row of rows) this.database.connection.prepare('UPDATE subagent_messages SET read_at=? WHERE id=?').run(Date.now(), row.id!)
      return rows.map(row => ({ id: String(row.id), senderSessionId: String(row.sender_session_id), message: String(row.message), createdAt: Number(row.created_at),
        kind: row.legacy_kind === null ? 'message' : String(row.legacy_kind), historical: row.legacy_kind !== null,
        details: messageDetails(row.details_json) }))
    })
  }
}

function messageDetails(value: unknown) {
  if (value == null) return null
  const text = String(value)
  return text.length <= 16000 ? JSON.parse(text) : { truncated: true, preview: text.slice(0, 16000), note: 'Full historical details remain in the mailbox recovery record.' }
}
