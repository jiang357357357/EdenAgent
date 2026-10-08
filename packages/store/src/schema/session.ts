/** Historical SQL keyed by its immutable database version; execution order lives in migrations.ts. */
export const sessionSchema = {
  1: `CREATE TABLE realm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, origin TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE events (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT,
     seq INTEGER NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL,
     UNIQUE(session_id, seq)
   );
   CREATE TABLE runtime_checkpoints (
     session_id TEXT PRIMARY KEY REFERENCES sessions(id), checkpoint_json TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE inputs (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     idempotency_key TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
     created_at INTEGER NOT NULL, UNIQUE(session_id, idempotency_key)
   );
   CREATE TABLE turns (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), state TEXT NOT NULL,
     error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE tool_operations (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     tool_name TEXT NOT NULL, revision TEXT NOT NULL, state TEXT NOT NULL, result_json TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX inputs_pending ON inputs(session_id, state, created_at);`,
  4: `ALTER TABLE inputs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE inputs ADD COLUMN kind TEXT NOT NULL DEFAULT 'prompt';`,
  5: `CREATE TABLE input_signals (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     kind TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL
   );`,
  7: `CREATE TABLE runtime_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);`,
  9: `CREATE TABLE director_runs (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     run_json TEXT NOT NULL, created_at INTEGER NOT NULL
   );
   CREATE INDEX director_runs_session ON director_runs(session_id, created_at);`,
  10: `CREATE TABLE actor_checkpoints (
     session_id TEXT NOT NULL REFERENCES sessions(id), assistant_id TEXT NOT NULL,
     checkpoint_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
     PRIMARY KEY(session_id, assistant_id)
   );`,
  11: `ALTER TABLE director_runs ADD COLUMN participants_json TEXT NOT NULL DEFAULT '[]';`,
  12: `CREATE TABLE question_requests (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     state TEXT NOT NULL, questions_json TEXT NOT NULL, answers_json TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER
   );
   CREATE INDEX questions_pending ON question_requests(state, session_id);`,
  13: `CREATE TABLE assistant_handoffs (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), source_turn_id TEXT NOT NULL REFERENCES turns(id),
     participant_json TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     UNIQUE(session_id, source_turn_id)
   );
   CREATE INDEX handoffs_pending ON assistant_handoffs(session_id, state, created_at);`,
  14: `CREATE TABLE blobs (
     id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, mime TEXT NOT NULL,
     byte_length INTEGER NOT NULL CHECK(byte_length >= 0), created_at INTEGER NOT NULL
   );`,
  18: `CREATE TABLE model_bindings (
     session_key TEXT PRIMARY KEY, participants_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL
   );`,
  19: `ALTER TABLE model_bindings ADD COLUMN operation_cursor INTEGER NOT NULL DEFAULT 0;`,
  25: `CREATE TABLE service_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
   CREATE INDEX service_nonces_expiry ON service_nonces(expires_at);
   CREATE TABLE self_awake_submissions (
     user_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     PRIMARY KEY(user_id,request_key)
   );`,
  51: `CREATE TABLE runtime_setting_changes(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT NOT NULL,previous_json TEXT NOT NULL,value_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  52: `ALTER TABLE tool_operations ADD COLUMN request_json TEXT NOT NULL DEFAULT 'null';
   ALTER TABLE tool_operations ADD COLUMN error_json TEXT;`,
  59: `ALTER TABLE tool_operations ADD COLUMN tool_call_id TEXT;
   ALTER TABLE tool_operations ADD COLUMN capability TEXT;
   ALTER TABLE tool_operations ADD COLUMN resource TEXT;`,
  80: `CREATE TABLE model_pricing(model_key TEXT PRIMARY KEY,rates_json TEXT,revision TEXT NOT NULL,note TEXT NOT NULL,updated_at INTEGER NOT NULL,identity_json TEXT NOT NULL);
   CREATE TABLE model_pricing_history(revision TEXT PRIMARY KEY,model_key TEXT NOT NULL,previous_json TEXT,rates_json TEXT,note TEXT NOT NULL,created_at INTEGER NOT NULL,previous_revision TEXT);`,
  94: `CREATE TABLE input_outcome_reviews(input_id TEXT PRIMARY KEY REFERENCES inputs(id),fingerprint TEXT NOT NULL,
     previous_state TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  95: `CREATE TABLE input_resubmissions(source_id TEXT PRIMARY KEY REFERENCES inputs(id),input_id TEXT NOT NULL UNIQUE REFERENCES inputs(id),
     fingerprint TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  110: `CREATE INDEX events_session_kind_seq ON events(session_id,kind,seq);
   CREATE INDEX events_session_turn_kind_seq ON events(session_id,turn_id,kind,seq);`,
  111: `INSERT INTO realm_meta(key,value) VALUES ('event_payload_format','eden.message.delta.v1');`,
  112: `CREATE TABLE request_contents(hash TEXT PRIMARY KEY,content_json TEXT NOT NULL);`,
  117: `CREATE TABLE ui_preferences(id INTEGER PRIMARY KEY CHECK(id=1), auto_scroll_enabled INTEGER NOT NULL CHECK(auto_scroll_enabled IN (0,1)));`,
  118: `CREATE TABLE session_owners(session_id TEXT PRIMARY KEY REFERENCES sessions(id),account_key TEXT NOT NULL);
   CREATE INDEX session_owners_account ON session_owners(account_key,session_id);
   CREATE TABLE blob_owners(blob_id TEXT NOT NULL REFERENCES blobs(id),account_key TEXT NOT NULL,PRIMARY KEY(blob_id,account_key));
   CREATE TABLE account_records(kind TEXT NOT NULL,record_id INTEGER NOT NULL,account_key TEXT NOT NULL,PRIMARY KEY(kind,record_id));
   CREATE TABLE account_ui_preferences(account_key TEXT PRIMARY KEY,auto_scroll_enabled INTEGER NOT NULL CHECK(auto_scroll_enabled IN (0,1)));`,
  119: `CREATE TABLE character_intentions (
     id INTEGER PRIMARY KEY AUTOINCREMENT, account_key TEXT NOT NULL, character_id TEXT NOT NULL,
     title TEXT NOT NULL, reason TEXT NOT NULL, next_step TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('active','waiting','paused','completed','abandoned')),
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE INDEX character_intentions_owner ON character_intentions(account_key,character_id,status,updated_at);
   CREATE TABLE character_intention_entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT, intention_id INTEGER NOT NULL REFERENCES character_intentions(id),
     status TEXT NOT NULL, note TEXT NOT NULL, artifact TEXT NOT NULL,
     session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE INDEX character_intention_entries_parent ON character_intention_entries(intention_id,id);`,
  120: `ALTER TABLE character_intentions ADD COLUMN wait_for TEXT;
   ALTER TABLE character_intentions ADD COLUMN waiting_since INTEGER;
   ALTER TABLE character_intention_entries ADD COLUMN evidence_json TEXT;
   UPDATE character_intentions SET wait_for=next_step,waiting_since=updated_at WHERE status='waiting';`,
  122: `DROP TABLE character_intention_entries;
   DROP TABLE character_intentions;`,
  123: `CREATE TABLE session_classification(
     session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
     purpose TEXT NOT NULL CHECK(purpose IN ('user_chat','self_awake','subagent')),
     source_channel TEXT NOT NULL CHECK(source_channel IN ('app','qq','internal')),
     CHECK((purpose='user_chat' AND source_channel IN ('app','qq'))
       OR (purpose IN ('self_awake','subagent') AND source_channel='internal'))
   );
   INSERT INTO session_classification(session_id,purpose,source_channel)
   SELECT s.id,
     CASE
       WHEN EXISTS(SELECT 1 FROM subagent_threads t WHERE t.child_session_id=s.id)
         OR EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id AND e.kind='session.created'
           AND json_extract(e.payload_json,'$.environment.sessionPurpose')='subagent') THEN 'subagent'
       WHEN EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=s.id AND j.kind='self_awake')
         OR EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id AND e.kind='session.created'
           AND json_extract(e.payload_json,'$.environment.sessionPurpose')='self_awake') THEN 'self_awake'
       ELSE 'user_chat' END,
     CASE WHEN EXISTS(SELECT 1 FROM subagent_threads t WHERE t.child_session_id=s.id)
         OR EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=s.id AND j.kind='self_awake')
         OR EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id AND e.kind='session.created'
           AND json_extract(e.payload_json,'$.environment.sessionPurpose') IN ('self_awake','subagent'))
       THEN 'internal' ELSE 'app' END
   FROM sessions s;
   CREATE INDEX session_classification_filter ON session_classification(purpose,source_channel,session_id);
   CREATE TRIGGER session_classification_insert AFTER INSERT ON sessions BEGIN
     INSERT INTO session_classification(session_id,purpose,source_channel) VALUES(NEW.id,'user_chat','app');
   END;`,
  125: `UPDATE session_classification SET purpose='subagent',source_channel='internal'
   WHERE purpose='user_chat' AND (
     EXISTS(SELECT 1 FROM subagent_threads t WHERE t.child_session_id=session_classification.session_id)
     OR EXISTS(SELECT 1 FROM events e WHERE e.session_id=session_classification.session_id
       AND e.kind IN ('session.created','session.metadata.updated')
       AND json_extract(e.payload_json,'$.environment.sessionPurpose')='subagent'));
   UPDATE session_classification SET purpose='self_awake',source_channel='internal'
   WHERE purpose='user_chat' AND (
     EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=session_classification.session_id AND j.kind='self_awake')
     OR EXISTS(SELECT 1 FROM self_awake_runs r WHERE r.session_id=session_classification.session_id)
     OR EXISTS(SELECT 1 FROM events e WHERE e.session_id=session_classification.session_id
       AND e.kind IN ('session.created','session.metadata.updated')
       AND json_extract(e.payload_json,'$.environment.sessionPurpose')='self_awake'));`,
} as const
