import type { DatabaseSync } from 'node:sqlite'

/** Keep decimal counters exact and separate from current-runtime statistics. */
export function legacyMetricSummary(db: DatabaseSync) {
  const present = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'legacy_metric_%'").all().map(row => String(row.name)))
  const totals = present.has('legacy_metric_totals') ? db.prepare('SELECT metric,value_decimal FROM legacy_metric_totals ORDER BY metric LIMIT 257').all() : []
  const turnCount = present.has('legacy_metric_turns') ? Number(db.prepare('SELECT COUNT(*) AS n FROM legacy_metric_turns').get()?.n ?? 0) : 0
  const toolCount = present.has('legacy_metric_tool_calls') ? Number(db.prepare('SELECT COUNT(*) AS n FROM legacy_metric_tool_calls').get()?.n ?? 0) : 0
  return { totals: Object.fromEntries(totals.slice(0, 256).map(row => [String(row.metric), String(row.value_decimal)])), totalsTruncated: totals.length > 256,
    unfinishedTurnTimers: turnCount, unfinishedToolTimers: toolCount,
    note: 'Historical cumulative counters are exact decimal strings. Retained timer rows do not imply live execution; do not add replayed event counts to these totals.' }
}
