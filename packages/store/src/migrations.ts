import type { DatabaseSync } from 'node:sqlite'

const migrations = [
  `CREATE TABLE realm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
  `CREATE TABLE plugin_drafts (
     id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, source TEXT NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE plugin_versions (
     plugin_id TEXT NOT NULL, revision TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL,
     source TEXT NOT NULL, artifact TEXT NOT NULL, report_json TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY(plugin_id, revision)
   );
   CREATE TABLE plugin_activations (
     plugin_id TEXT PRIMARY KEY, revision TEXT NOT NULL, enabled INTEGER NOT NULL, read_root TEXT,
     FOREIGN KEY(plugin_id, revision) REFERENCES plugin_versions(plugin_id, revision)
   );
   CREATE TABLE plugin_grants (
     plugin_id TEXT NOT NULL, revision TEXT NOT NULL, resource TEXT NOT NULL, decision TEXT NOT NULL,
     source TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(plugin_id, revision, resource)
   );
   CREATE TABLE permission_requests (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     operation_id TEXT NOT NULL, capability TEXT NOT NULL, resource TEXT NOT NULL, state TEXT NOT NULL,
     request_json TEXT NOT NULL, created_at INTEGER NOT NULL
   );`,
  `CREATE TABLE plugin_test_reports (
     revision TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, report_json TEXT NOT NULL, created_at INTEGER NOT NULL
   );`,
  `ALTER TABLE inputs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE inputs ADD COLUMN kind TEXT NOT NULL DEFAULT 'prompt';`,
  `CREATE TABLE input_signals (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     kind TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL
   );`,
  `CREATE TABLE permission_grants (
     scope TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
     request_id TEXT NOT NULL REFERENCES permission_requests(id), created_at INTEGER NOT NULL
   );`,
  `CREATE TABLE runtime_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);`,
  `CREATE TABLE mon_operations (
     id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id), kind TEXT NOT NULL,
     endpoint TEXT NOT NULL, request_json TEXT NOT NULL, state TEXT NOT NULL, error TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );`,
  `CREATE TABLE director_runs (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     run_json TEXT NOT NULL, created_at INTEGER NOT NULL
   );
   CREATE INDEX director_runs_session ON director_runs(session_id, created_at);`,
  `CREATE TABLE actor_checkpoints (
     session_id TEXT NOT NULL REFERENCES sessions(id), assistant_id TEXT NOT NULL,
     checkpoint_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
     PRIMARY KEY(session_id, assistant_id)
   );`,
  `ALTER TABLE director_runs ADD COLUMN participants_json TEXT NOT NULL DEFAULT '[]';`,
  `CREATE TABLE question_requests (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
     state TEXT NOT NULL, questions_json TEXT NOT NULL, answers_json TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER
   );
   CREATE INDEX questions_pending ON question_requests(state, session_id);`,
  `CREATE TABLE assistant_handoffs (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), source_turn_id TEXT NOT NULL REFERENCES turns(id),
     participant_json TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     UNIQUE(session_id, source_turn_id)
   );
   CREATE INDEX handoffs_pending ON assistant_handoffs(session_id, state, created_at);`,
  `CREATE TABLE blobs (
     id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, mime TEXT NOT NULL,
     byte_length INTEGER NOT NULL CHECK(byte_length >= 0), created_at INTEGER NOT NULL
   );`,
  `CREATE TABLE memories (
     id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, kind TEXT NOT NULL,
     scope_type TEXT NOT NULL, scope_key TEXT NOT NULL, source_session_id TEXT NOT NULL DEFAULT '',
     metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX memories_scope ON memories(scope_type, scope_key, updated_at DESC, id DESC);`,
  `CREATE TABLE memory_extractions (
     id TEXT PRIMARY KEY, input_id TEXT NOT NULL REFERENCES inputs(id), session_id TEXT NOT NULL REFERENCES sessions(id),
     turn_id TEXT NOT NULL REFERENCES turns(id), actor_id TEXT NOT NULL, scope_key TEXT NOT NULL,
     user_text TEXT NOT NULL, assistant_text TEXT NOT NULL, state TEXT NOT NULL,
     candidates_json TEXT NOT NULL DEFAULT '[]', error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     UNIQUE(input_id, actor_id)
   );
   CREATE INDEX memory_extractions_pending ON memory_extractions(state, created_at);`,
  `ALTER TABLE memory_extractions ADD COLUMN saved_ids_json TEXT NOT NULL DEFAULT '[]';`,
  `CREATE TABLE model_bindings (
     session_key TEXT PRIMARY KEY, participants_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL
   );`,
  `ALTER TABLE model_bindings ADD COLUMN operation_cursor INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE mon_connections (
     session_id TEXT PRIMARY KEY REFERENCES sessions(id), core_base_url TEXT NOT NULL, core_token TEXT NOT NULL, updated_at INTEGER NOT NULL
   );`,
]

export function migrateDatabase(database: DatabaseSync): void {
  const row = database.prepare('PRAGMA user_version').get()
  const current = Number(row?.user_version ?? 0)
  if (current > migrations.length) throw new Error('Database schema is newer than this host')
  for (let index = current; index < migrations.length; index++) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrations[index]!)
      database.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(index + 1, Date.now())
      database.exec(`PRAGMA user_version = ${index + 1}`)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
