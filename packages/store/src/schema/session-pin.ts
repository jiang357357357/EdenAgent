/** Pin state has its own revision, independent of conversation activity and archive state. */
export const sessionPinSchema = `
CREATE TABLE session_pins (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX session_pins_order ON session_pins(pinned,updated_at DESC);
`
