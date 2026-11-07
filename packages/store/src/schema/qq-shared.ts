export const qqSharedSchema = `
  CREATE TABLE qq_shared_rooms (
    session_id TEXT PRIMARY KEY REFERENCES qq_group_sessions(session_id),
    bot_qq TEXT NOT NULL, group_qq TEXT NOT NULL, UNIQUE(bot_qq,group_qq)
  );
  CREATE TABLE qq_group_inputs (
    input_id TEXT PRIMARY KEY REFERENCES inputs(id), session_id TEXT NOT NULL REFERENCES sessions(id),
    turn_id TEXT NOT NULL UNIQUE, operator_qq TEXT NOT NULL, source_key TEXT NOT NULL,
    source_seq INTEGER NOT NULL, origin_json TEXT NOT NULL
  );
  CREATE INDEX qq_group_input_source ON qq_group_inputs(session_id,source_key);
  CREATE TABLE qq_memo_origins (
    memo_id INTEGER PRIMARY KEY REFERENCES memos(id), session_id TEXT NOT NULL,
    operator_qq TEXT NOT NULL, origin_json TEXT NOT NULL
  );
  CREATE TABLE qq_group_history (
    session_id TEXT NOT NULL REFERENCES sessions(id), source_key TEXT NOT NULL, source_seq INTEGER NOT NULL,
    message_json TEXT NOT NULL, PRIMARY KEY(session_id,source_key), UNIQUE(session_id,source_seq)
  );
  CREATE INDEX qq_group_history_order ON qq_group_history(session_id,source_seq);
`
