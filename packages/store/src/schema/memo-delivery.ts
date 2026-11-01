/** Scheduled QQ effects have their own durable cursor and receipt, independent of model turns. */
export const memoDeliverySchema = `
CREATE TABLE memo_delivery_targets (
  memo_id INTEGER PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE, target_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE memo_channel_deliveries (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, memo_id INTEGER NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, request_id TEXT NOT NULL UNIQUE,
  memo_json TEXT NOT NULL, target_json TEXT NOT NULL, advance_memo INTEGER NOT NULL CHECK(advance_memo IN (0,1)),
  historical INTEGER NOT NULL CHECK(historical IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('queued','checking','sending','accepted','failed','unknown','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL, receipt_json TEXT, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX memo_channel_deliveries_due ON memo_channel_deliveries(state,retry_at,created_at);
`
