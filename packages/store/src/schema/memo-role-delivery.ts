/** Resume reminder decisions through durable role inputs; legacy sends retain their uncertain outcome. */
export const memoRoleDeliverySchema = `
ALTER TABLE memos ADD COLUMN delivery_json TEXT NOT NULL DEFAULT '{"channel":"auto"}';
ALTER TABLE memo_channel_deliveries ADD COLUMN input_id TEXT REFERENCES inputs(id);
CREATE TABLE memo_delivery_effects (
  request_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES memo_channel_deliveries(job_id),
  channel TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','pending','accepted','failed','unknown')),
  receipt_json TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX memo_delivery_effects_job ON memo_delivery_effects(job_id,state);
UPDATE memo_channel_deliveries SET target_json='{"channel":"auto"}' WHERE state IN ('queued','checking');
`
