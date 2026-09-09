import type { EdenDatabase } from '@eden/store'
import { testReportSchema } from './test-plugin.ts'
import type { PluginTestReport } from './test-plugin.ts'

export class ReportRepository {
  constructor(private readonly database: EdenDatabase) {}

  save(id: string, report: PluginTestReport): void {
    this.database.connection.prepare('INSERT OR REPLACE INTO plugin_test_reports VALUES (?, ?, ?, ?)')
      .run(report.revision, id, JSON.stringify(report), Date.now())
  }

  read(id: string, revision: string): PluginTestReport {
    const row = this.database.connection.prepare('SELECT report_json FROM plugin_test_reports WHERE revision=? AND plugin_id=?').get(revision, id)
    if (!row) throw new Error('No tests recorded for this revision')
    return testReportSchema.parse(JSON.parse(String(row.report_json)))
  }
}
