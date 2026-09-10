import { ContactNotDeliveredError } from './contact-error.ts'
import { z } from 'zod'
import { MonHttpError } from '@eden/integrations'
import type { MonClient } from '@eden/integrations'
import type { EdenDatabase } from '@eden/store'
import { toJson } from '@eden/api'
import type { DatabaseSync } from 'node:sqlite'
export async function deliverContact(database: EdenDatabase, client: MonClient, sessionId: string, requestId: string, channel: 'email' | 'qq', endpoint: string, payload: string, signal: AbortSignal) {
  const db = database.connection
  signal.throwIfAborted()
  const existing = db.prepare('SELECT * FROM mon_contact_deliveries WHERE request_id=?').get(requestId)
  if (existing) {
    if (existing.channel !== channel || existing.session_id !== sessionId || existing.payload_json !== payload) throw new Error('Contact request ID conflicts with an existing delivery')
    if (existing.state === 'accepted') return toJson({ channel, status: 'accepted', requestId: requestId, alreadyAccepted: true })
    if (existing.state === 'failed') throw new ContactNotDeliveredError('Core previously rejected this contact')
    throw new Error('Previous contact delivery is unresolved or failed; review it before creating another request')
  }
  db.prepare("INSERT INTO mon_contact_deliveries VALUES(?,?,?,?,'running',NULL,NULL,?,?)")
    .run(requestId, sessionId, channel, payload, Date.now(), Date.now())
  try {
    const result = await client.post(endpoint, JSON.parse(payload), signal)
    confirmContactReceipt(result, db, requestId)
    // Retain a minimal receipt, without recipient addresses or provider credentials.
    const accepted = { channel, status: 'accepted', requestId: requestId, note: 'Channel accepted the message; this does not prove it was read.' }
    db.prepare("UPDATE mon_contact_deliveries SET state='accepted',receipt_json=?,updated_at=? WHERE request_id=?")
      .run(JSON.stringify(accepted), Date.now(), requestId)
    return toJson(accepted)
  } catch (error) {
    const rejected = error instanceof MonHttpError && [400, 401, 403, 404, 422].includes(error.status)
    db.prepare("UPDATE mon_contact_deliveries SET state=?,error=?,updated_at=? WHERE request_id=? AND state='running'")
      .run(rejected ? 'failed' : 'unknown', rejected ? 'Core rejected contact delivery' : 'Contact outcome is unknown; do not automatically resend', Date.now(), requestId)
    if (db.prepare('SELECT state FROM mon_contact_deliveries WHERE request_id=?').get(requestId)?.state === 'failed') throw new ContactNotDeliveredError('Core rejected this contact')
    throw new Error('Contact delivery was not confirmed; inspect the contact delivery record')
  }
}

function confirmContactReceipt(result: unknown, db: DatabaseSync, requestId: string) {
  const receipt = z.object({ success: z.boolean().optional(), sent: z.boolean().optional(), data: z.object({ success: z.boolean().optional() }).optional() }).passthrough().parse(result)
  if (receipt.success === false || receipt.sent === false || receipt.data?.success === false) {
    db.prepare("UPDATE mon_contact_deliveries SET state='failed',error='Core rejected contact delivery',updated_at=? WHERE request_id=?").run(Date.now(), requestId)
    throw new Error('Core reported contact delivery failure')
  }
  if (receipt.success !== true && receipt.sent !== true && receipt.data?.success !== true) throw new Error('Core contact acceptance was not confirmed')
}
