import { randomUUID } from 'node:crypto'
import type { JsonValue, DurableEvent } from '@eden/api'
import { durableEventSchema, jsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { SQLOutputValue } from 'node:sqlite'

export class SessionEvents {
  private readonly listeners = new Set<(event: DurableEvent) => void>()
  constructor(private readonly database: EdenDatabase) {}

  insert(sessionId: string, turnId: string | null, kind: string, payload: JsonValue): DurableEvent {
    const row = this.database.connection.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE session_id=?').get(sessionId)
    const event = durableEventSchema.parse({ id: randomUUID(), sessionId, turnId, seq: String(row?.seq), kind, payload, createdAt: Date.now() })
    this.database.connection.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(event.id, sessionId, turnId, BigInt(event.seq), kind, JSON.stringify(payload), event.createdAt)
    return event
  }

  append(sessionId: string, turnId: string | null, kind: string, payload: JsonValue): DurableEvent {
    const event = this.database.transaction(() => this.insert(sessionId, turnId, kind, payload))
    this.publish(event)
    return event
  }

  publish(event: DurableEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) }
      catch (error) { process.stderr.write(`Event subscriber failed: ${error instanceof Error ? error.message : 'unknown'}\n`) }
    }
  }

  subscribe(listener: (event: DurableEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(sessionId: string, afterSeq = '0', limit = 100): DurableEvent[] {
    const statement = this.database.connection.prepare('SELECT * FROM events WHERE session_id=? AND seq>? ORDER BY seq LIMIT ?')
    statement.setReadBigInts(true)
    return statement.all(sessionId, BigInt(afterSeq), Math.min(limit, 1001)).map(eventFromRow)
  }

  messages(sessionId: string, before: string | undefined, limit: number): { items: DurableEvent[]; hasMore: boolean; nextCursor: string | null } {
    let beforeSeq = 9223372036854775807n
    if (before) {
      const cursor = this.database.connection.prepare("SELECT seq FROM events WHERE session_id=? AND id=? AND kind='agent.message_end'")
      cursor.setReadBigInts(true)
      const row = cursor.get(sessionId, before)
      if (!row) throw new Error('Message cursor not found in session')
      beforeSeq = BigInt(row.seq as bigint)
    }
    const statement = this.database.connection.prepare("SELECT * FROM events WHERE session_id=? AND kind='agent.message_end' AND seq<? ORDER BY seq DESC LIMIT ?")
    statement.setReadBigInts(true)
    const rows = statement.all(sessionId, beforeSeq, Math.min(limit, 100) + 1)
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(eventFromRow).reverse()
    return { items, hasMore, nextCursor: hasMore ? items[0]!.id : null }
  }
}

function eventFromRow(row: Record<string, SQLOutputValue>): DurableEvent {
  return durableEventSchema.parse({
      id: row.id, sessionId: row.session_id, turnId: row.turn_id, seq: String(row.seq), kind: row.kind,
      payload: jsonValue.parse(JSON.parse(String(row.payload_json))), createdAt: Number(row.created_at),
  })
}
