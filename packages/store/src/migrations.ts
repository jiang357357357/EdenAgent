import type { DatabaseSync } from 'node:sqlite'

export const migrations: readonly string[] = [
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
  `CREATE TABLE memos (
     id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL,
     status TEXT NOT NULL, priority TEXT NOT NULL, remind_at INTEGER, due_at INTEGER, repeat_rule TEXT NOT NULL,
     related_session_id TEXT NOT NULL, metadata_json TEXT NOT NULL, last_triggered_at INTEGER, completed_at INTEGER,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, operation_key TEXT UNIQUE
   );
   CREATE INDEX memos_updated ON memos(updated_at DESC,id DESC);
   CREATE INDEX memos_due ON memos(status,COALESCE(remind_at,due_at));`,
  `CREATE TABLE jobs (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, session_id TEXT REFERENCES sessions(id), due_at INTEGER NOT NULL,
     payload_json TEXT NOT NULL, operation_key TEXT NOT NULL UNIQUE, causation_id TEXT NOT NULL, depth INTEGER NOT NULL,
     state TEXT NOT NULL, attempts INTEGER NOT NULL, error TEXT, input_id TEXT REFERENCES inputs(id),
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX jobs_pending ON jobs(state,due_at);
   CREATE TABLE memo_notifications (
     id TEXT PRIMARY KEY, memo_id INTEGER NOT NULL REFERENCES memos(id), job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     memo_json TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER
   );`,
  `CREATE TABLE self_awake_runs (
     id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id), session_id TEXT NOT NULL REFERENCES sessions(id),
     input_id TEXT REFERENCES inputs(id), turn_id TEXT, event_id TEXT NOT NULL, state TEXT NOT NULL,
     request_json TEXT NOT NULL, author_json TEXT NOT NULL, decision_json TEXT, attempts INTEGER NOT NULL, last_error TEXT,
     started_at INTEGER, completed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX self_awake_runs_state ON self_awake_runs(state,created_at);
   CREATE TABLE self_awake_diaries (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES self_awake_runs(id), session_id TEXT NOT NULL REFERENCES sessions(id),
     assistant_id TEXT NOT NULL, character_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, mood TEXT NOT NULL,
     metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL
   );`,
  `CREATE TABLE desktop_reminders (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL REFERENCES turns(id),
     title TEXT NOT NULL, message TEXT NOT NULL, state TEXT NOT NULL, author_json TEXT NOT NULL,
     operation_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, displayed_at INTEGER, closed_at INTEGER
   );
   CREATE INDEX desktop_reminders_pending ON desktop_reminders(state,created_at);
   ALTER TABLE self_awake_runs ADD COLUMN action_result_json TEXT;`,
  `CREATE TABLE service_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
   CREATE INDEX service_nonces_expiry ON service_nonces(expires_at);
   CREATE TABLE self_awake_submissions (
     user_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     PRIMARY KEY(user_id,request_key)
   );`,
  `CREATE TABLE installed_skills (name TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, source_json TEXT NOT NULL,
     scope TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE skill_previews (id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, source_json TEXT NOT NULL,
     scope TEXT NOT NULL, expires_at INTEGER NOT NULL, previous_hash TEXT);`,
  `ALTER TABLE installed_skills RENAME TO installed_skills_unscoped;
   CREATE TABLE installed_skills (name TEXT NOT NULL, workspace_root TEXT NOT NULL, snapshot_json TEXT NOT NULL,
     source_json TEXT NOT NULL, scope TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     PRIMARY KEY(name,workspace_root));
   INSERT INTO installed_skills SELECT name,'',snapshot_json,source_json,scope,enabled,updated_at FROM installed_skills_unscoped;
   DROP TABLE installed_skills_unscoped;
   ALTER TABLE skill_previews ADD COLUMN workspace_root TEXT NOT NULL DEFAULT '';`,
  `CREATE TABLE plugin_operation_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id TEXT NOT NULL,
     action TEXT NOT NULL, revision TEXT, state TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, error_code TEXT);
   CREATE INDEX plugin_operation_history ON plugin_operation_log(plugin_id,seq);`,
  `CREATE TABLE plugin_market_keys(id TEXT PRIMARY KEY,public_key TEXT NOT NULL,enabled INTEGER NOT NULL);
   CREATE TABLE plugin_market_sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,key_id TEXT NOT NULL,
     enabled INTEGER NOT NULL,epoch TEXT NOT NULL,payload_json TEXT,index_revision TEXT,refreshed_at INTEGER,last_error TEXT);`,
  `CREATE TABLE plugin_package_previews(id TEXT PRIMARY KEY,files_json TEXT NOT NULL,provenance_json TEXT NOT NULL,
     revision TEXT NOT NULL,key_id TEXT NOT NULL,expires_at INTEGER NOT NULL);`,
  `CREATE TABLE plugin_packages(id TEXT NOT NULL,revision TEXT NOT NULL,manifest_json TEXT NOT NULL,files_json TEXT NOT NULL,
     provenance_json TEXT NOT NULL,key_id TEXT NOT NULL,installed_at INTEGER NOT NULL,PRIMARY KEY(id,revision));
   CREATE TABLE plugin_package_selection(id TEXT PRIMARY KEY,revision TEXT NOT NULL,enabled INTEGER NOT NULL,
     FOREIGN KEY(id,revision) REFERENCES plugin_packages(id,revision));`,
  `CREATE TABLE plugin_package_components(id TEXT NOT NULL,revision TEXT NOT NULL,component_id TEXT NOT NULL,enabled INTEGER NOT NULL,
     PRIMARY KEY(id,revision,component_id),FOREIGN KEY(id,revision) REFERENCES plugin_packages(id,revision));`,
  `CREATE TABLE plugin_package_grants(id TEXT NOT NULL,revision TEXT NOT NULL,capability TEXT NOT NULL,resource TEXT NOT NULL,
     access TEXT NOT NULL,decision TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(id,revision,capability,resource,access),
     FOREIGN KEY(id,revision) REFERENCES plugin_packages(id,revision));`,
  `CREATE TABLE plugin_hook_cursor(id INTEGER PRIMARY KEY CHECK(id=1),after_rowid INTEGER NOT NULL);
   ALTER TABLE plugin_package_selection ADD COLUMN enabled_after_rowid INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE subagent_threads(id TEXT PRIMARY KEY,root_session_id TEXT NOT NULL REFERENCES sessions(id),parent_session_id TEXT NOT NULL REFERENCES sessions(id),
     child_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),parent_id TEXT REFERENCES subagent_threads(id),agent_path TEXT NOT NULL,
     task_name TEXT NOT NULL,role TEXT NOT NULL,depth INTEGER NOT NULL,state TEXT NOT NULL,operation_key TEXT NOT NULL UNIQUE,
     latest_job_id TEXT REFERENCES jobs(id),result_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
     started_at INTEGER,completed_at INTEGER,UNIQUE(root_session_id,agent_path));`,
  `CREATE TABLE subagent_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     sender_session_id TEXT NOT NULL REFERENCES sessions(id),message TEXT NOT NULL,operation_key TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,
     UNIQUE(agent_id,operation_key));`,
  `ALTER TABLE subagent_threads ADD COLUMN max_turns INTEGER NOT NULL DEFAULT 8;
   ALTER TABLE subagent_threads ADD COLUMN turns_used INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE subagent_threads ADD COLUMN deadline_at INTEGER;`,
  `CREATE TABLE voice_configuration(kind TEXT PRIMARY KEY CHECK(kind IN ('tts','stt')),config_json TEXT NOT NULL,updated_at INTEGER NOT NULL);`,
  `CREATE TABLE voice_audio_cache(cache_key TEXT PRIMARY KEY,blob_id TEXT NOT NULL,format TEXT NOT NULL,
     duration_ms INTEGER,size_bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE voice_speech_segments(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES sessions(id),
     message_id TEXT NOT NULL,segment_group_id TEXT NOT NULL,group_index INTEGER NOT NULL,sequence INTEGER NOT NULL,
     cache_key TEXT NOT NULL REFERENCES voice_audio_cache(cache_key),text_hash TEXT NOT NULL,text_length INTEGER NOT NULL,created_at INTEGER NOT NULL,
     UNIQUE(session_id,message_id,segment_group_id,group_index,sequence));`,
  `CREATE TABLE media_requests(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),turn_id TEXT NOT NULL,
     kind TEXT NOT NULL,state TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT,error TEXT,created_at INTEGER NOT NULL,resolved_at INTEGER);
   CREATE INDEX media_pending ON media_requests(state,kind,created_at);`,
  `CREATE TABLE mon_projection_outbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),destination_key TEXT NOT NULL,
     kind TEXT NOT NULL,payload_json TEXT NOT NULL,state TEXT NOT NULL,remote_id TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE INDEX mon_projection_pending ON mon_projection_outbox(state,created_at);`,
  `CREATE TABLE mon_sync_progress(session_id TEXT NOT NULL REFERENCES sessions(id),destination_key TEXT NOT NULL,after_seq TEXT NOT NULL,
     attempts INTEGER NOT NULL,retry_at INTEGER NOT NULL,error TEXT,PRIMARY KEY(session_id,destination_key));`,
  `CREATE TABLE mon_contact_deliveries(request_id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),channel TEXT NOT NULL,
     payload_json TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`,
  `CREATE TABLE connectors(id TEXT PRIMARY KEY,connector_key TEXT NOT NULL,identity_key TEXT NOT NULL,display_name TEXT NOT NULL,
     desired_state TEXT NOT NULL,runtime_state TEXT NOT NULL,settings_json TEXT NOT NULL,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
     UNIQUE(connector_key,identity_key));`,
  `CREATE TABLE connector_events(id TEXT PRIMARY KEY,connector_id TEXT NOT NULL REFERENCES connectors(id),external_id TEXT NOT NULL,event_type TEXT NOT NULL,
     payload_json TEXT NOT NULL,session_id TEXT REFERENCES sessions(id),job_id TEXT REFERENCES jobs(id),suppression TEXT,created_at INTEGER NOT NULL,
     UNIQUE(connector_id,external_id));`,
  `ALTER TABLE connectors ADD COLUMN generation TEXT NOT NULL DEFAULT '';
   UPDATE connectors SET generation=lower(hex(randomblob(16)));`,
  `CREATE TABLE connector_grants(connector_id TEXT NOT NULL REFERENCES connectors(id),generation TEXT NOT NULL,revision TEXT NOT NULL,
     permission_key TEXT NOT NULL,allowed INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(connector_id,generation,revision,permission_key));`,
  `CREATE TABLE connector_operations(id TEXT PRIMARY KEY,connector_id TEXT NOT NULL REFERENCES connectors(id),session_id TEXT NOT NULL REFERENCES sessions(id),
     generation TEXT NOT NULL,method TEXT NOT NULL,input_json TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`,
  `CREATE TABLE connector_credentials(connector_id TEXT PRIMARY KEY REFERENCES connectors(id),secret TEXT NOT NULL,updated_at INTEGER NOT NULL);`,
  `CREATE TABLE mcp_operations(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),runtime_id TEXT NOT NULL,revision TEXT NOT NULL,
    method TEXT NOT NULL,name TEXT NOT NULL,input_json TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`,
  `CREATE TABLE runtime_setting_changes(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT NOT NULL,previous_json TEXT NOT NULL,value_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `ALTER TABLE tool_operations ADD COLUMN request_json TEXT NOT NULL DEFAULT 'null';
   ALTER TABLE tool_operations ADD COLUMN error_json TEXT;`,
  `ALTER TABLE subagent_threads ADD COLUMN spawn_request_hash TEXT;`,
  `CREATE TABLE subagent_followups(agent_id TEXT NOT NULL REFERENCES subagent_threads(id),operation_key TEXT NOT NULL,message TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(agent_id,operation_key));`,
  `ALTER TABLE subagent_threads ADD COLUMN model_requests_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN tool_calls_used INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE subagent_threads ADD COLUMN max_model_requests INTEGER NOT NULL DEFAULT 128;
   ALTER TABLE subagent_threads ADD COLUMN max_tool_calls INTEGER NOT NULL DEFAULT 256;`,
  `ALTER TABLE memos ADD COLUMN snoozed_until INTEGER;
   ALTER TABLE memos ADD COLUMN source TEXT NOT NULL DEFAULT 'monagent';
   DROP INDEX memos_due;
   CREATE INDEX memos_due ON memos(status,COALESCE(snoozed_until,remind_at,due_at));`,
  `CREATE TABLE self_awake_notification_history(
     run_id TEXT PRIMARY KEY REFERENCES self_awake_runs(id), requested_channel TEXT NOT NULL,
     state TEXT NOT NULL, original_state TEXT NOT NULL, payload_json TEXT NOT NULL, result_json TEXT,
     attempts INTEGER NOT NULL, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );`,
  `ALTER TABLE tool_operations ADD COLUMN tool_call_id TEXT;
   ALTER TABLE tool_operations ADD COLUMN capability TEXT;
   ALTER TABLE tool_operations ADD COLUMN resource TEXT;`,
  `ALTER TABLE voice_speech_segments ADD COLUMN external_audio_asset_id INTEGER;`,
  `CREATE TABLE desktop_reminders_v2 (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT REFERENCES turns(id),
     title TEXT NOT NULL,message TEXT NOT NULL,state TEXT NOT NULL,author_json TEXT NOT NULL,
     operation_key TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,displayed_at INTEGER,closed_at INTEGER
   );
   INSERT INTO desktop_reminders_v2 SELECT * FROM desktop_reminders;
   DROP TABLE desktop_reminders;
   ALTER TABLE desktop_reminders_v2 RENAME TO desktop_reminders;
   CREATE INDEX desktop_reminders_pending ON desktop_reminders(state,created_at);`,
  `CREATE TABLE legacy_model_selections(domain TEXT NOT NULL,source_id TEXT NOT NULL,
     session_id TEXT NOT NULL REFERENCES sessions(id),assistant_id TEXT NOT NULL,ai_entity_id TEXT NOT NULL,
     vision_ai_entity_id TEXT,runtime_info_json TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL,
     PRIMARY KEY(domain,source_id));`,
  `ALTER TABLE legacy_model_selections ADD COLUMN resolution_json TEXT;
   ALTER TABLE legacy_model_selections ADD COLUMN resolved_at INTEGER;`,
  `CREATE TABLE legacy_core_identities(session_id TEXT PRIMARY KEY REFERENCES sessions(id),core_base_url TEXT NOT NULL,
     principal_key TEXT NOT NULL,credential_ref TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL);
   CREATE TABLE legacy_core_outbox(id INTEGER PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),credential_ref TEXT NOT NULL,
     kind TEXT NOT NULL,dedupe_key TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,
     next_attempt_at INTEGER NOT NULL,claimed_at INTEGER,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE INDEX legacy_core_outbox_session ON legacy_core_outbox(session_id,state);`,
  `CREATE TABLE legacy_core_delivery_reviews(delivery_id INTEGER PRIMARY KEY REFERENCES legacy_core_outbox(id),
     decision TEXT NOT NULL,note TEXT NOT NULL,previous_state TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE legacy_core_replays(request_key TEXT PRIMARY KEY,delivery_id INTEGER NOT NULL REFERENCES legacy_core_outbox(id),
     session_id TEXT NOT NULL REFERENCES sessions(id),note TEXT NOT NULL,payload_hash TEXT NOT NULL,state TEXT NOT NULL,
     result_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE UNIQUE INDEX legacy_core_replay_active ON legacy_core_replays(delivery_id) WHERE state='running';`,
  `CREATE TABLE legacy_subagent_context(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     prompt TEXT NOT NULL,context_json TEXT,config_json TEXT NOT NULL,usage_json TEXT NOT NULL,
     coordination_batch_id TEXT,state TEXT NOT NULL);
   CREATE TABLE legacy_subagent_mailbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),
     sender_path TEXT NOT NULL,target_path TEXT NOT NULL,content TEXT NOT NULL,kind TEXT NOT NULL,
     trigger_turn INTEGER NOT NULL,details_json TEXT NOT NULL,created_at INTEGER NOT NULL,consumed_at INTEGER,
     state TEXT NOT NULL);`,
  `CREATE TABLE legacy_app_config(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at INTEGER NOT NULL,
     state TEXT NOT NULL,target_key TEXT,error TEXT,resolution_json TEXT,resolved_at INTEGER);`,
  `CREATE TABLE legacy_metric_totals(metric TEXT PRIMARY KEY,value_decimal TEXT NOT NULL);
   CREATE TABLE legacy_metric_turns(session_id TEXT NOT NULL,turn_id TEXT NOT NULL,started_at INTEGER NOT NULL,
     first_response_at INTEGER,PRIMARY KEY(session_id,turn_id));
   CREATE TABLE legacy_metric_tool_calls(session_id TEXT NOT NULL,turn_id TEXT NOT NULL,tool_call_id TEXT NOT NULL,
     started_at INTEGER NOT NULL,PRIMARY KEY(session_id,turn_id,tool_call_id));`,
  `CREATE TABLE legacy_import_items(source_kind TEXT NOT NULL,entity_kind TEXT NOT NULL,legacy_key TEXT NOT NULL,
     target_key TEXT NOT NULL,details_json TEXT NOT NULL,imported_at INTEGER NOT NULL,PRIMARY KEY(source_kind,entity_kind,legacy_key));
   CREATE TABLE legacy_session_imports(source_kind TEXT NOT NULL,legacy_session_key TEXT NOT NULL,
     target_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),legacy_user_id_decimal TEXT NOT NULL,
     imported_message_count_decimal TEXT NOT NULL,imported_at INTEGER NOT NULL,PRIMARY KEY(source_kind,legacy_session_key));
   CREATE TABLE legacy_skill_installations(id TEXT PRIMARY KEY,legacy_key TEXT NOT NULL UNIQUE,skill_name TEXT NOT NULL,
     display_name TEXT NOT NULL,description TEXT NOT NULL,scope TEXT NOT NULL,source_type TEXT NOT NULL,source_uri TEXT NOT NULL,
     source_ref TEXT NOT NULL,installed_version TEXT NOT NULL,content_hash TEXT NOT NULL,was_enabled INTEGER NOT NULL,
     trust_status TEXT NOT NULL,manifest_json TEXT NOT NULL,migration_state TEXT NOT NULL,imported_at INTEGER NOT NULL);`,
  `CREATE TABLE legacy_plugin_history(domain TEXT NOT NULL,source_id TEXT NOT NULL,plugin_id TEXT,
     state TEXT NOT NULL,row_json TEXT NOT NULL,PRIMARY KEY(domain,source_id));
   CREATE INDEX legacy_plugin_history_plugin ON legacy_plugin_history(plugin_id,domain);
   CREATE TABLE legacy_plugin_revocations(source_id TEXT NOT NULL,plugin_id TEXT NOT NULL,version TEXT NOT NULL,
     revision TEXT NOT NULL,reason TEXT NOT NULL,revoked_at INTEGER NOT NULL,PRIMARY KEY(source_id,plugin_id,version,revision));
   CREATE INDEX legacy_plugin_revocation_release ON legacy_plugin_revocations(plugin_id,version,revision);`,
  `CREATE TABLE legacy_plugin_file_copies(source_id TEXT PRIMARY KEY,plugin_id TEXT NOT NULL,revision TEXT NOT NULL,
     relative_path TEXT NOT NULL,files_json TEXT NOT NULL,copied_at INTEGER NOT NULL);`,
  `ALTER TABLE legacy_plugin_history ADD COLUMN resolution_json TEXT;
   ALTER TABLE legacy_plugin_history ADD COLUMN resolved_at INTEGER;`,
  `CREATE TABLE legacy_runtime_contexts(session_id TEXT PRIMARY KEY REFERENCES sessions(id),state TEXT NOT NULL,error TEXT,updated_at INTEGER NOT NULL);`,
  `CREATE TABLE legacy_context_reviews(session_id TEXT PRIMARY KEY REFERENCES sessions(id),source_sha256 TEXT NOT NULL,
     summary TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_policies(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),policy_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `ALTER TABLE subagent_threads ADD COLUMN max_tokens INTEGER NOT NULL DEFAULT 1000000;
   ALTER TABLE subagent_threads ADD COLUMN max_cost_microusd INTEGER;
   ALTER TABLE subagent_threads ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN cost_microusd_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN usage_unknown INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN cost_unknown INTEGER NOT NULL DEFAULT 0;
   UPDATE subagent_threads SET usage_unknown=1,cost_unknown=1 WHERE id IN (SELECT agent_id FROM legacy_subagent_context);
   CREATE TABLE subagent_usage_receipts(turn_id TEXT NOT NULL,message_id TEXT NOT NULL,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     tokens INTEGER,cost_microusd INTEGER,created_at INTEGER NOT NULL,PRIMARY KEY(turn_id,message_id));`,
  `CREATE TABLE subagent_model_requests(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     session_id TEXT NOT NULL REFERENCES sessions(id),turn_id TEXT NOT NULL,state TEXT NOT NULL,cost_configured INTEGER NOT NULL,
     created_at INTEGER NOT NULL,resolved_at INTEGER,note TEXT);
   CREATE TABLE subagent_request_owners(request_id TEXT NOT NULL REFERENCES subagent_model_requests(id),
     agent_id TEXT NOT NULL REFERENCES subagent_threads(id),PRIMARY KEY(request_id,agent_id));
   CREATE INDEX subagent_request_owner ON subagent_request_owners(agent_id,request_id);`,
  `ALTER TABLE subagent_threads ADD COLUMN legacy_usage_unknown INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN legacy_cost_unknown INTEGER NOT NULL DEFAULT 0;
   UPDATE subagent_threads SET legacy_usage_unknown=usage_unknown,legacy_cost_unknown=cost_unknown;`,
  `CREATE TABLE model_pricing(model_key TEXT PRIMARY KEY,rates_json TEXT,revision TEXT NOT NULL,note TEXT NOT NULL,updated_at INTEGER NOT NULL,identity_json TEXT NOT NULL);
   CREATE TABLE model_pricing_history(revision TEXT PRIMARY KEY,model_key TEXT NOT NULL,previous_json TEXT,rates_json TEXT,note TEXT NOT NULL,created_at INTEGER NOT NULL,previous_revision TEXT);`,
  `CREATE TABLE subagent_roles(name TEXT PRIMARY KEY,definition_json TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL);
   CREATE TABLE subagent_role_history(revision TEXT PRIMARY KEY,name TEXT NOT NULL,previous_json TEXT,definition_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_role_snapshots(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),definition_json TEXT NOT NULL,skills_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE local_child_models(session_id TEXT PRIMARY KEY REFERENCES sessions(id),configuration_json TEXT NOT NULL,updated_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_project_roles(workspace_root TEXT NOT NULL,name TEXT NOT NULL,definition_json TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL,
     PRIMARY KEY(workspace_root,name));
   ALTER TABLE subagent_role_history ADD COLUMN workspace_root TEXT NOT NULL DEFAULT '';`,
  `CREATE TABLE subagent_role_imports(id TEXT PRIMARY KEY,plan_json TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER NOT NULL,result_json TEXT,applied_at INTEGER);`,
  `ALTER TABLE subagent_threads ADD COLUMN workspace_root TEXT;
   CREATE TABLE subagent_workspace_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),previous_root TEXT,workspace_root TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_policy_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     source_hash TEXT NOT NULL,request_hash TEXT NOT NULL,review_json TEXT NOT NULL,policy_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_model_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     fingerprint TEXT NOT NULL,snapshot_json TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_baseline_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     fingerprint TEXT NOT NULL,previous_json TEXT NOT NULL,tokens INTEGER NOT NULL,cost_microusd INTEGER NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_reopen_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     note TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE subagent_model_restoration_history(id INTEGER PRIMARY KEY AUTOINCREMENT,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     fingerprint TEXT NOT NULL,snapshot_json TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL,replaced_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_deadline_restorations(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     request_json TEXT NOT NULL,previous_deadline INTEGER,deadline INTEGER NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_mailbox_restorations(id TEXT PRIMARY KEY REFERENCES legacy_subagent_mailbox(id),
     fingerprint TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE job_outcome_reviews(job_id TEXT PRIMARY KEY REFERENCES jobs(id),expected_updated_at INTEGER NOT NULL,
     decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE input_outcome_reviews(input_id TEXT PRIMARY KEY REFERENCES inputs(id),fingerprint TEXT NOT NULL,
     previous_state TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE input_resubmissions(source_id TEXT PRIMARY KEY REFERENCES inputs(id),input_id TEXT NOT NULL UNIQUE REFERENCES inputs(id),
     fingerprint TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_job_resubmissions(source_job_id TEXT PRIMARY KEY REFERENCES jobs(id),agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     expected_updated_at INTEGER NOT NULL,new_job_id TEXT NOT NULL REFERENCES jobs(id),note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE INDEX jobs_session_history ON jobs(session_id,created_at DESC,id DESC);
   CREATE INDEX jobs_session_kind_history ON jobs(session_id,kind,created_at DESC,id DESC);`,
  `CREATE TABLE memo_job_resubmissions(source_job_id TEXT PRIMARY KEY REFERENCES jobs(id),new_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     expected_updated_at INTEGER NOT NULL,snapshot_json TEXT,note TEXT NOT NULL,created_at INTEGER NOT NULL,mode TEXT NOT NULL);`,
  `CREATE TABLE plugin_hook_resubmissions(source_job_id TEXT PRIMARY KEY REFERENCES jobs(id),new_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     expected_updated_at INTEGER NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE self_awake_job_resubmissions(source_job_id TEXT PRIMARY KEY REFERENCES jobs(id),new_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     fingerprint TEXT NOT NULL,author_json TEXT NOT NULL,environment_json TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE self_awake_notification_reviews(run_id TEXT PRIMARY KEY REFERENCES self_awake_notification_history(run_id),
     fingerprint TEXT NOT NULL,previous_json TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL,source TEXT NOT NULL);`,
  `CREATE TABLE self_awake_run_reviews(run_id TEXT PRIMARY KEY REFERENCES self_awake_runs(id),fingerprint TEXT NOT NULL,
     previous_json TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_root_messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),
     sender_session_id TEXT NOT NULL REFERENCES sessions(id),message TEXT NOT NULL,operation_key TEXT NOT NULL,
     created_at INTEGER NOT NULL,read_at INTEGER,UNIQUE(session_id,operation_key));
   CREATE INDEX subagent_root_inbox ON subagent_root_messages(session_id,read_at,created_at,id);`,
  `CREATE TABLE subagent_mailbox_followups(id TEXT PRIMARY KEY REFERENCES legacy_subagent_mailbox(id),session_id TEXT NOT NULL REFERENCES sessions(id),
     agent_id TEXT NOT NULL REFERENCES subagent_threads(id),fingerprint TEXT NOT NULL,note TEXT NOT NULL,
     job_id TEXT NOT NULL REFERENCES jobs(id),created_at INTEGER NOT NULL);`,
  `CREATE TABLE subagent_mailbox_abandonments(id TEXT PRIMARY KEY REFERENCES legacy_subagent_mailbox(id),
     session_id TEXT NOT NULL REFERENCES sessions(id),fingerprint TEXT NOT NULL,previous_json TEXT NOT NULL,
     note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  `ALTER TABLE subagent_threads ADD COLUMN parent_actor_id TEXT;`,
  `CREATE TABLE subagent_model_source_reviews(agent_id TEXT NOT NULL REFERENCES subagent_threads(id),fingerprint TEXT NOT NULL,
     actor_id TEXT,note TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(agent_id,fingerprint));`,
  `CREATE TABLE local_model_profiles(model_key TEXT PRIMARY KEY,configuration_json TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL);
   ALTER TABLE local_child_models ADD COLUMN independent INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE mon_child_models(session_id TEXT NOT NULL REFERENCES sessions(id),model_key TEXT NOT NULL,entity_id TEXT NOT NULL,
     binding_json TEXT NOT NULL,connection_hash TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(session_id,model_key));`,
  `CREATE INDEX events_session_kind_seq ON events(session_id,kind,seq);
   CREATE INDEX events_session_turn_kind_seq ON events(session_id,turn_id,kind,seq);`,
  `INSERT INTO realm_meta(key,value) VALUES ('event_payload_format','eden.message.delta.v1');`,
  `CREATE TABLE request_contents(hash TEXT PRIMARY KEY,content_json TEXT NOT NULL);`,
]

export const databaseSchemaVersion = migrations.length

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
