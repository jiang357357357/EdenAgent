/** Retired App delivery ledger. Keep this applied migration for schema compatibility and historical receipts. */
export const appContactSchema = `
CREATE TABLE app_contact_deliveries (
  source_session_id TEXT NOT NULL REFERENCES sessions(id),
  source_turn_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  target_session_id TEXT NOT NULL REFERENCES sessions(id),
  message_id TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(source_session_id,source_turn_id)
);
CREATE INDEX app_contact_role_time ON app_contact_deliveries(character_id,created_at);
`
