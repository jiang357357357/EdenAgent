import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'
import { tableConverted } from './conversion-state.ts'

/** Preserve root-directed and control messages too; only unambiguous task messages enter the new inbox. */
export async function convertLegacyAgentMailbox(db: DatabaseSync, source: LegacySnapshotReader): Promise<void> {
  if (!source.manifest.tables.some(table => table.name === 'agent_mailbox') || tableConverted(db, 'agent_mailbox')) return
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan('agent_mailbox', row => {
      const id = legacyUuid(row, 'id'), sessionId = legacyUuid(row, 'session_id')
      const sender = legacyText(row, 'sender_path'), target = legacyText(row, 'target_path')
      const content = legacyText(row, 'content'), kind = legacyText(row, 'kind')
      const created = legacyTime(row.created_at), consumed = row.consumed_at === null ? null : legacyTime(row.consumed_at)
      if (row.trigger_turn !== 0n && row.trigger_turn !== 1n) throw new Error('Invalid historical mailbox trigger flag')
      const recipient = db.prepare('SELECT id FROM subagent_threads WHERE root_session_id=? AND agent_path=?').get(sessionId, target)
      const senderThread = sender === '/root' ? undefined : db.prepare('SELECT child_session_id FROM subagent_threads WHERE root_session_id=? AND agent_path=?').get(sessionId, sender)
      const senderSession = sender === '/root' ? sessionId : senderThread ? String(senderThread.child_session_id) : null
      // The original kind, trigger and details are not instructions to execute in the new runtime.
      const mapped = recipient && senderSession !== null && ['message', 'completion'].includes(kind) && content.trim() && content.length <= 16000
      db.prepare('INSERT INTO legacy_subagent_mailbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, sessionId, sender, target, content, kind,
        Number(row.trigger_turn), legacyJson(row, 'details_json'), created, consumed, consumed !== null ? 'consumed' : mapped ? 'context_required' : 'review_required')
      if (mapped) {
        db.prepare('INSERT INTO subagent_messages(id,agent_id,sender_session_id,message,operation_key,created_at,read_at) VALUES(?,?,?,?,?,?,?)')
          .run(id, recipient.id!, senderSession, content, `legacy-mailbox:${id}`, created, consumed)
        db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('agent_mailbox', id, id)
      }
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run('agent_mailbox', id, preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='agent_mailbox'").run()
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
