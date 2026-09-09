import type { EdenDatabase } from '@eden/store'
export class PluginOperationRepository {
  constructor(private readonly database: EdenDatabase) {}
  recover(): void {
    this.database.connection.prepare("UPDATE plugin_operation_log SET state='interrupted',finished_at=?,error_code='host_restarted' WHERE state='running'").run(Date.now())
  }
  begin(id: string, action: string, revision?: string): number {
    const result = this.database.connection.prepare(`INSERT INTO plugin_operation_log(plugin_id,action,revision,state,started_at)
      VALUES(?,?,?,'running',?)`).run(id, action, revision ?? null, Date.now())
    return Number(result.lastInsertRowid)
  }
  finish(seq: number, state: 'completed' | 'failed' | 'cancelled', revision?: string, code?: string): void {
    this.database.connection.prepare(`UPDATE plugin_operation_log SET state=?,revision=COALESCE(?,revision),finished_at=?,error_code=? WHERE seq=? AND state='running'`)
      .run(state, revision ?? null, Date.now(), code ?? null, seq)
  }
  list(id: string, before: number | undefined, limit: number) {
    const rows = this.database.connection.prepare('SELECT * FROM plugin_operation_log WHERE plugin_id=? AND seq<? ORDER BY seq DESC LIMIT ?')
      .all(id, before ?? Number.MAX_SAFE_INTEGER, limit + 1)
    const page = rows.slice(0, limit)
    return { items: page.map(row => ({ seq: Number(row.seq), id: String(row.plugin_id), action: String(row.action),
      revision: row.revision === null ? null : String(row.revision), state: String(row.state), startedAt: Number(row.started_at),
      finishedAt: row.finished_at === null ? null : Number(row.finished_at), errorCode: row.error_code === null ? null : String(row.error_code) })),
      hasMore: rows.length > limit, nextCursor: rows.length > limit ? Number(page.at(-1)!.seq) : null }
  }
}
