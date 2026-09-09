import { JobRepository } from '../jobs/index.ts'
import { scheduleMemo } from './scheduling.ts'
import { nextMemoOccurrence } from './repeat.ts'
import { memoCreateSchema, memoPatchSchema, memoInfoSchema, memoIdSchema, memoIntegerSchema, memoListSchema } from '@eden/api'
import type { MemoInput, MemoPatch, MemoInfo } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { SQLOutputValue } from 'node:sqlite'

const pending = "status='active' AND COALESCE(snoozed_until,remind_at,due_at) IS NOT NULL AND (last_triggered_at IS NULL OR last_triggered_at < COALESCE(snoozed_until,remind_at,due_at))"

export class MemoRepository {
  constructor(private readonly database: EdenDatabase, private readonly jobs = new JobRepository(database)) {}

  create(value: MemoInput, operationKey?: string): MemoInfo {
    const input = memoCreateSchema.parse(value)
    return this.database.transaction(() => {
      if (operationKey) {
        const existing = this.database.connection.prepare('SELECT * FROM memos WHERE operation_key=?').get(operationKey)
        if (existing) return fromRow(existing)
      }
      if (input.relatedSessionId && !this.database.connection.prepare("SELECT 1 FROM sessions WHERE id=? AND status='active'").get(input.relatedSessionId)) throw new Error('Memo session is not active')
      const now = Date.now()
      const result = this.database.connection.prepare(`INSERT INTO memos
        (title,content,kind,status,priority,remind_at,due_at,repeat_rule,related_session_id,metadata_json,completed_at,created_at,updated_at,operation_key,snoozed_until)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.title, input.content, input.kind, input.status, input.priority,
          input.remindAt, input.dueAt, input.repeatRule, input.relatedSessionId, JSON.stringify(input.metadata), input.status === 'done' ? now : null, now, now, operationKey ?? null, input.snoozedUntil)
      const memo = this.read(Number(result.lastInsertRowid))
      scheduleMemo(this.jobs, memo)
      return memo
    })
  }

  recoverSchedules(): void {
    let cursor = 0
    for (;;) {
      const rows = this.database.connection.prepare(`SELECT * FROM memos WHERE ${pending} AND id>? ORDER BY id LIMIT 200`).all(cursor)
      if (!rows.length) return
      this.database.transaction(() => { for (const row of rows) scheduleMemo(this.jobs, fromRow(row)) })
      cursor = Number(rows.at(-1)!.id)
    }
  }

  read(id: number): MemoInfo {
    const value = memoIdSchema.parse({ id })
    const row = this.database.connection.prepare('SELECT * FROM memos WHERE id=?').get(value.id)
    if (!row) throw new Error('Memo not found in this world')
    return fromRow(row)
  }

  list(limit = 80, query?: string | null): MemoInfo[] {
    const input = memoListSchema.parse({ limit, query })
    const search = input.query?.trim() ?? ''
    return this.database.connection.prepare(`SELECT * FROM memos WHERE ?='' OR instr(lower(title),lower(?))>0 OR instr(lower(content),lower(?))>0
      ORDER BY updated_at DESC,id DESC LIMIT ?`).all(search, search, search, input.limit).map(fromRow)
  }

  update(id: number, patch: MemoPatch, expectedUpdatedAt?: number): MemoInfo {
    const parsed = memoPatchSchema.parse(patch)
    return this.database.transaction(() => {
      const current = this.read(id)
      if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw new Error('Memo changed during approval')
      const input = memoCreateSchema.parse({ ...pickInput(current), ...parsed })
      const now = Math.max(Date.now(), current.updatedAt + 1)
      this.database.connection.prepare(`UPDATE memos SET title=?,content=?,kind=?,status=?,priority=?,remind_at=?,due_at=?,repeat_rule=?,metadata_json=?,completed_at=?,updated_at=?,snoozed_until=? WHERE id=?`)
        .run(input.title, input.content, input.kind, input.status, input.priority, input.remindAt, input.dueAt, input.repeatRule,
          JSON.stringify(input.metadata), input.status === 'done' ? current.completedAt ?? now : null, now, input.snoozedUntil, id)
      const memo = this.read(id)
      scheduleMemo(this.jobs, memo)
      return memo
    })
  }

  due(before = Date.now(), limit = 80): MemoInfo[] {
    memoIntegerSchema.parse(before)
    const count = memoListSchema.parse({ limit }).limit
    return this.database.connection.prepare(`SELECT * FROM memos WHERE ${pending} AND COALESCE(snoozed_until,remind_at,due_at)<=?
      ORDER BY COALESCE(snoozed_until,remind_at,due_at),id LIMIT ?`).all(before, count).map(fromRow)
  }

  next(after = Date.now()): MemoInfo | null {
    memoIntegerSchema.parse(after)
    const row = this.database.connection.prepare(`SELECT * FROM memos WHERE ${pending} AND COALESCE(snoozed_until,remind_at,due_at)>=?
      ORDER BY COALESCE(snoozed_until,remind_at,due_at),id LIMIT 1`).get(after)
    return row ? fromRow(row) : null
  }

  markTriggered(records: Pick<MemoInfo, 'id' | 'updatedAt'>[], at = Date.now()): MemoInfo[] {
    memoIntegerSchema.parse(at)
    return this.database.transaction(() => records.map(record => this.deliveredInTransaction(record.id, record.updatedAt, at)))
  }

  deliveredInTransaction(id: number, revision: number, at = Date.now()): MemoInfo {
    if (!this.database.inTransaction) throw new Error('Memo delivery requires an owning transaction')
    const current = this.read(id)
    if (current.updatedAt !== revision) throw new Error('Memo changed during dispatch')
    const now = Math.max(Date.now(), current.updatedAt + 1)
    const next = nextMemoOccurrence(current.repeatRule, current.remindAt ?? current.dueAt ?? at, at)
    this.database.connection.prepare('UPDATE memos SET last_triggered_at=?,remind_at=?,updated_at=?,snoozed_until=NULL WHERE id=?')
      .run(at, next ?? current.remindAt, now, id)
    const result = this.read(id)
    scheduleMemo(this.jobs, result)
    return result
  }

}

function pickInput(value: MemoInfo): MemoInput {
  const { id, source, lastTriggeredAt, completedAt, createdAt, updatedAt, ...input } = value
  return input
}
function fromRow(row: Record<string, SQLOutputValue>): MemoInfo {
  return memoInfoSchema.parse({ id: row.id, title: row.title, content: row.content, kind: row.kind, status: row.status,
    source: row.source, snoozedUntil: row.snoozed_until, priority: row.priority, remindAt: row.remind_at, dueAt: row.due_at, repeatRule: row.repeat_rule, relatedSessionId: row.related_session_id,
    lastTriggeredAt: row.last_triggered_at, completedAt: row.completed_at, metadata: JSON.parse(String(row.metadata_json)),
    createdAt: row.created_at, updatedAt: row.updated_at })
}
