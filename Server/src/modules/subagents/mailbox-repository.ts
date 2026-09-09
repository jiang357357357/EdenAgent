import { randomUUID } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
export class SubagentMailbox {
  constructor(private readonly database: EdenDatabase) {}
  send(agentId: string, senderSessionId: string, message: string, key = randomUUID()) {
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
      const rows = this.database.connection.prepare('SELECT * FROM subagent_messages WHERE agent_id=? AND read_at IS NULL ORDER BY seq LIMIT 10').all(agentId)
      for (const row of rows) this.database.connection.prepare('UPDATE subagent_messages SET read_at=? WHERE id=?').run(Date.now(), row.id!)
      return rows.map(row => ({ id: String(row.id), senderSessionId: String(row.sender_session_id), message: String(row.message), createdAt: Number(row.created_at) }))
    })
  }
}
