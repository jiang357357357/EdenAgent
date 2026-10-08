/** Historical SQL keyed by its immutable database version; execution order lives in migrations.ts. */
export const legacySchema = {
  62: `CREATE TABLE legacy_model_selections(domain TEXT NOT NULL,source_id TEXT NOT NULL,
     session_id TEXT NOT NULL REFERENCES sessions(id),assistant_id TEXT NOT NULL,ai_entity_id TEXT NOT NULL,
     vision_ai_entity_id TEXT,runtime_info_json TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL,
     PRIMARY KEY(domain,source_id));`,
  63: `ALTER TABLE legacy_model_selections ADD COLUMN resolution_json TEXT;
   ALTER TABLE legacy_model_selections ADD COLUMN resolved_at INTEGER;`,
  64: `CREATE TABLE legacy_core_identities(session_id TEXT PRIMARY KEY REFERENCES sessions(id),core_base_url TEXT NOT NULL,
     principal_key TEXT NOT NULL,credential_ref TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL);
   CREATE TABLE legacy_core_outbox(id INTEGER PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),credential_ref TEXT NOT NULL,
     kind TEXT NOT NULL,dedupe_key TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,
     next_attempt_at INTEGER NOT NULL,claimed_at INTEGER,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE INDEX legacy_core_outbox_session ON legacy_core_outbox(session_id,state);`,
  65: `CREATE TABLE legacy_core_delivery_reviews(delivery_id INTEGER PRIMARY KEY REFERENCES legacy_core_outbox(id),
     decision TEXT NOT NULL,note TEXT NOT NULL,previous_state TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  66: `CREATE TABLE legacy_core_replays(request_key TEXT PRIMARY KEY,delivery_id INTEGER NOT NULL REFERENCES legacy_core_outbox(id),
     session_id TEXT NOT NULL REFERENCES sessions(id),note TEXT NOT NULL,payload_hash TEXT NOT NULL,state TEXT NOT NULL,
     result_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE UNIQUE INDEX legacy_core_replay_active ON legacy_core_replays(delivery_id) WHERE state='running';`,
  67: `CREATE TABLE legacy_subagent_context(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     prompt TEXT NOT NULL,context_json TEXT,config_json TEXT NOT NULL,usage_json TEXT NOT NULL,
     coordination_batch_id TEXT,state TEXT NOT NULL);
   CREATE TABLE legacy_subagent_mailbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),
     sender_path TEXT NOT NULL,target_path TEXT NOT NULL,content TEXT NOT NULL,kind TEXT NOT NULL,
     trigger_turn INTEGER NOT NULL,details_json TEXT NOT NULL,created_at INTEGER NOT NULL,consumed_at INTEGER,
     state TEXT NOT NULL);`,
  68: `CREATE TABLE legacy_app_config(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at INTEGER NOT NULL,
     state TEXT NOT NULL,target_key TEXT,error TEXT,resolution_json TEXT,resolved_at INTEGER);`,
  69: `CREATE TABLE legacy_metric_totals(metric TEXT PRIMARY KEY,value_decimal TEXT NOT NULL);
   CREATE TABLE legacy_metric_turns(session_id TEXT NOT NULL,turn_id TEXT NOT NULL,started_at INTEGER NOT NULL,
     first_response_at INTEGER,PRIMARY KEY(session_id,turn_id));
   CREATE TABLE legacy_metric_tool_calls(session_id TEXT NOT NULL,turn_id TEXT NOT NULL,tool_call_id TEXT NOT NULL,
     started_at INTEGER NOT NULL,PRIMARY KEY(session_id,turn_id,tool_call_id));`,
  70: `CREATE TABLE legacy_import_items(source_kind TEXT NOT NULL,entity_kind TEXT NOT NULL,legacy_key TEXT NOT NULL,
     target_key TEXT NOT NULL,details_json TEXT NOT NULL,imported_at INTEGER NOT NULL,PRIMARY KEY(source_kind,entity_kind,legacy_key));
   CREATE TABLE legacy_session_imports(source_kind TEXT NOT NULL,legacy_session_key TEXT NOT NULL,
     target_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),legacy_user_id_decimal TEXT NOT NULL,
     imported_message_count_decimal TEXT NOT NULL,imported_at INTEGER NOT NULL,PRIMARY KEY(source_kind,legacy_session_key));
   CREATE TABLE legacy_skill_installations(id TEXT PRIMARY KEY,legacy_key TEXT NOT NULL UNIQUE,skill_name TEXT NOT NULL,
     display_name TEXT NOT NULL,description TEXT NOT NULL,scope TEXT NOT NULL,source_type TEXT NOT NULL,source_uri TEXT NOT NULL,
     source_ref TEXT NOT NULL,installed_version TEXT NOT NULL,content_hash TEXT NOT NULL,was_enabled INTEGER NOT NULL,
     trust_status TEXT NOT NULL,manifest_json TEXT NOT NULL,migration_state TEXT NOT NULL,imported_at INTEGER NOT NULL);`,
  71: `CREATE TABLE legacy_plugin_history(domain TEXT NOT NULL,source_id TEXT NOT NULL,plugin_id TEXT,
     state TEXT NOT NULL,row_json TEXT NOT NULL,PRIMARY KEY(domain,source_id));
   CREATE INDEX legacy_plugin_history_plugin ON legacy_plugin_history(plugin_id,domain);
   CREATE TABLE legacy_plugin_revocations(source_id TEXT NOT NULL,plugin_id TEXT NOT NULL,version TEXT NOT NULL,
     revision TEXT NOT NULL,reason TEXT NOT NULL,revoked_at INTEGER NOT NULL,PRIMARY KEY(source_id,plugin_id,version,revision));
   CREATE INDEX legacy_plugin_revocation_release ON legacy_plugin_revocations(plugin_id,version,revision);`,
  72: `CREATE TABLE legacy_plugin_file_copies(source_id TEXT PRIMARY KEY,plugin_id TEXT NOT NULL,revision TEXT NOT NULL,
     relative_path TEXT NOT NULL,files_json TEXT NOT NULL,copied_at INTEGER NOT NULL);`,
  73: `ALTER TABLE legacy_plugin_history ADD COLUMN resolution_json TEXT;
   ALTER TABLE legacy_plugin_history ADD COLUMN resolved_at INTEGER;`,
  74: `CREATE TABLE legacy_runtime_contexts(session_id TEXT PRIMARY KEY REFERENCES sessions(id),state TEXT NOT NULL,error TEXT,updated_at INTEGER NOT NULL);`,
  75: `CREATE TABLE legacy_context_reviews(session_id TEXT PRIMARY KEY REFERENCES sessions(id),source_sha256 TEXT NOT NULL,
     summary TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
} as const
