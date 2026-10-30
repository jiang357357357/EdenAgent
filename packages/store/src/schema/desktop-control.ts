export const desktopControlSchema = `
CREATE TABLE desktop_operations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  action TEXT NOT NULL,
  state TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX desktop_operations_session ON desktop_operations(session_id, created_at);
`
