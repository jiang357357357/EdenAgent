import { legacyMetricSummary } from './metric-summary.ts'
import { legacyRecoverySummary } from './recovery-summary.ts'
import { randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export function conversionReport(db: DatabaseSync, origin: 'mon' | 'local', phase: string, error?: unknown) {
  const tables = db.prepare('SELECT name,sha256,rows,state FROM legacy_conversion_tables ORDER BY name').all()
  const recovery = legacyRecoverySummary(db)
  return { format: 'eden.legacy-conversion.v1', origin, state: 'incomplete', phase,
    updatedAt: new Date().toISOString(), outcome: error === undefined ? 'staged' : 'failed',
    error: error === undefined ? null : (error instanceof Error ? error.message : String(error)).slice(0, 4000),
    modelBindingsAwaitingRefresh: recovery.items.find(item => item.key === 'modelBindings')?.count ?? 0,
    recovery, historicalMetrics: legacyMetricSummary(db),
    converted: tables.filter(table => table.state === 'converted').map(table => String(table.name)),
    pending: tables.filter(table => table.state !== 'converted').map(table => String(table.name)),
    tables: tables.map(table => ({ name: String(table.name), sha256: String(table.sha256), rows: Number(table.rows), state: String(table.state) })),
    note: 'Committed table conversions only. Runtime continuation and pending domains remain incomplete. Open only with explicit migration-review mode; ordinary runtime activation is not permitted.' }
}

/** Atomic replacement keeps the last complete report visible after interruption. */
export async function writeConversionReport(target: string, report: ReturnType<typeof conversionReport>): Promise<void> {
  const temporary = path.join(target, `.migration-report-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(report, null, 2) + '\n')
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(temporary).catch(() => {})
    throw error
  }
  await handle.close()
  try {
    await rename(temporary, path.join(target, 'migration-report.json'))
    if (process.platform !== 'win32') {
      const directory = await open(target, 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  } catch (error) { await unlink(temporary).catch(() => {}); throw error }
}
