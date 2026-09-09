import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { memoInfoSchema, memoListSchema, toJson } from '@eden/api'
import type { MemoInfo } from '@eden/api'
import type { EdenDatabase } from '@eden/store'

export class MemoNotifications {
  constructor(private readonly database: EdenDatabase) {}
  forJob(jobId: string): MemoInfo | undefined {
    const row = this.database.connection.prepare('SELECT memo_json FROM memo_notifications WHERE job_id=?').get(jobId)
    return row ? memoInfoSchema.parse(JSON.parse(String(row.memo_json))) : undefined
  }
  recordInTransaction(jobId: string, memo: MemoInfo): void {
    if (!this.database.inTransaction) throw new Error('Memo notification requires an owning transaction')
    this.database.connection.prepare(`INSERT INTO memo_notifications(id,memo_id,job_id,memo_json,created_at)
      VALUES(?,?,?,?,?) ON CONFLICT(job_id) DO NOTHING`).run(randomUUID(), memo.id, jobId, JSON.stringify(memo), Date.now())
  }
  list(limit = 80) {
    const count = memoListSchema.parse({ limit }).limit
    return this.database.connection.prepare('SELECT * FROM memo_notifications ORDER BY created_at DESC,id DESC LIMIT ?').all(count).map(row => ({
      id: String(row.id), jobId: String(row.job_id), memo: memoInfoSchema.parse(JSON.parse(String(row.memo_json))),
      createdAt: Number(row.created_at), readAt: row.read_at === null ? null : Number(row.read_at),
    }))
  }
  acknowledge(id: string) {
    z.uuid().parse(id)
    const result = this.database.connection.prepare('UPDATE memo_notifications SET read_at=COALESCE(read_at,?) WHERE id=?').run(Date.now(), id)
    if (result.changes !== 1) throw new Error('Memo notification not found')
    return toJson({ id, acknowledged: true })
  }
}
