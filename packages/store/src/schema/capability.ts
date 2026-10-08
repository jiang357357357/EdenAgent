/** Historical SQL keyed by its immutable database version; execution order lives in migrations.ts. */
export const capabilitySchema = {
  2: `CREATE TABLE plugin_drafts (
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
  3: `CREATE TABLE plugin_test_reports (
     revision TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, report_json TEXT NOT NULL, created_at INTEGER NOT NULL
   );`,
  6: `CREATE TABLE permission_grants (
     scope TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
     request_id TEXT NOT NULL REFERENCES permission_requests(id), created_at INTEGER NOT NULL
   );`,
  26: `CREATE TABLE installed_skills (name TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, source_json TEXT NOT NULL,
     scope TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE skill_previews (id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, source_json TEXT NOT NULL,
     scope TEXT NOT NULL, expires_at INTEGER NOT NULL, previous_hash TEXT);`,
  27: `ALTER TABLE installed_skills RENAME TO installed_skills_unscoped;
   CREATE TABLE installed_skills (name TEXT NOT NULL, workspace_root TEXT NOT NULL, snapshot_json TEXT NOT NULL,
     source_json TEXT NOT NULL, scope TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     PRIMARY KEY(name,workspace_root));
   INSERT INTO installed_skills SELECT name,'',snapshot_json,source_json,scope,enabled,updated_at FROM installed_skills_unscoped;
   DROP TABLE installed_skills_unscoped;
   ALTER TABLE skill_previews ADD COLUMN workspace_root TEXT NOT NULL DEFAULT '';`,
  28: `CREATE TABLE plugin_operation_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id TEXT NOT NULL,
     action TEXT NOT NULL, revision TEXT, state TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, error_code TEXT);
   CREATE INDEX plugin_operation_history ON plugin_operation_log(plugin_id,seq);`,
  29: `CREATE TABLE plugin_market_keys(id TEXT PRIMARY KEY,public_key TEXT NOT NULL,enabled INTEGER NOT NULL);
   CREATE TABLE plugin_market_sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,key_id TEXT NOT NULL,
     enabled INTEGER NOT NULL,epoch TEXT NOT NULL,payload_json TEXT,index_revision TEXT,refreshed_at INTEGER,last_error TEXT);`,
  30: `CREATE TABLE plugin_package_previews(id TEXT PRIMARY KEY,files_json TEXT NOT NULL,provenance_json TEXT NOT NULL,
     revision TEXT NOT NULL,key_id TEXT NOT NULL,expires_at INTEGER NOT NULL);`,
  31: `CREATE TABLE plugin_packages(id TEXT NOT NULL,revision TEXT NOT NULL,manifest_json TEXT NOT NULL,files_json TEXT NOT NULL,
     provenance_json TEXT NOT NULL,key_id TEXT NOT NULL,installed_at INTEGER NOT NULL,PRIMARY KEY(id,revision));
   CREATE TABLE plugin_package_selection(id TEXT PRIMARY KEY,revision TEXT NOT NULL,enabled INTEGER NOT NULL,
     FOREIGN KEY(id,revision) REFERENCES plugin_packages(id,revision));`,
  32: `CREATE TABLE plugin_package_components(id TEXT NOT NULL,revision TEXT NOT NULL,component_id TEXT NOT NULL,enabled INTEGER NOT NULL,
     PRIMARY KEY(id,revision,component_id),FOREIGN KEY(id,revision) REFERENCES plugin_packages(id,revision));`,
  33: `CREATE TABLE plugin_package_grants(id TEXT NOT NULL,revision TEXT NOT NULL,capability TEXT NOT NULL,resource TEXT NOT NULL,
     access TEXT NOT NULL,decision TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(id,revision,capability,resource,access),
     FOREIGN KEY(id,revision) REFERENCES plugin_packages(id,revision));`,
  34: `CREATE TABLE plugin_hook_cursor(id INTEGER PRIMARY KEY CHECK(id=1),after_rowid INTEGER NOT NULL);
   ALTER TABLE plugin_package_selection ADD COLUMN enabled_after_rowid INTEGER NOT NULL DEFAULT 0;`,
  44: `CREATE TABLE connectors(id TEXT PRIMARY KEY,connector_key TEXT NOT NULL,identity_key TEXT NOT NULL,display_name TEXT NOT NULL,
     desired_state TEXT NOT NULL,runtime_state TEXT NOT NULL,settings_json TEXT NOT NULL,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
     UNIQUE(connector_key,identity_key));`,
  45: `CREATE TABLE connector_events(id TEXT PRIMARY KEY,connector_id TEXT NOT NULL REFERENCES connectors(id),external_id TEXT NOT NULL,event_type TEXT NOT NULL,
     payload_json TEXT NOT NULL,session_id TEXT REFERENCES sessions(id),job_id TEXT REFERENCES jobs(id),suppression TEXT,created_at INTEGER NOT NULL,
     UNIQUE(connector_id,external_id));`,
  46: `ALTER TABLE connectors ADD COLUMN generation TEXT NOT NULL DEFAULT '';
   UPDATE connectors SET generation=lower(hex(randomblob(16)));`,
  47: `CREATE TABLE connector_grants(connector_id TEXT NOT NULL REFERENCES connectors(id),generation TEXT NOT NULL,revision TEXT NOT NULL,
     permission_key TEXT NOT NULL,allowed INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(connector_id,generation,revision,permission_key));`,
  48: `CREATE TABLE connector_operations(id TEXT PRIMARY KEY,connector_id TEXT NOT NULL REFERENCES connectors(id),session_id TEXT NOT NULL REFERENCES sessions(id),
     generation TEXT NOT NULL,method TEXT NOT NULL,input_json TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`,
  49: `CREATE TABLE connector_credentials(connector_id TEXT PRIMARY KEY REFERENCES connectors(id),secret TEXT NOT NULL,updated_at INTEGER NOT NULL);`,
  50: `CREATE TABLE mcp_operations(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),runtime_id TEXT NOT NULL,revision TEXT NOT NULL,
    method TEXT NOT NULL,name TEXT NOT NULL,input_json TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`,
  99: `CREATE TABLE plugin_hook_resubmissions(source_job_id TEXT PRIMARY KEY REFERENCES jobs(id),new_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     expected_updated_at INTEGER NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  114: `CREATE TEMP TABLE retired_builtin_tool_names(old_name TEXT PRIMARY KEY,new_name TEXT NOT NULL);
   INSERT INTO retired_builtin_tool_names VALUES
     ('eden_read_file','read_file'),('eden_write_file','write_file'),('eden_exec','exec_command'),
     ('eden_attachment','read_attachment'),('eden_question','request_user_input'),('eden_plugin','manage_plugins'),
     ('eden_connector_plugin','manage_connector_plugins');
   UPDATE subagent_policies SET policy_json=json_set(policy_json,
     '$.allowedTools',CASE WHEN json_type(policy_json,'$.allowedTools')='array' THEN json((SELECT json_group_array(DISTINCT COALESCE((SELECT new_name FROM retired_builtin_tool_names WHERE old_name=value),value)) FROM json_each(policy_json,'$.allowedTools'))) ELSE json_extract(policy_json,'$.allowedTools') END,
     '$.deniedTools',json((SELECT json_group_array(DISTINCT COALESCE((SELECT new_name FROM retired_builtin_tool_names WHERE old_name=value),value)) FROM json_each(policy_json,'$.deniedTools'))))
     WHERE EXISTS(SELECT 1 FROM json_each(policy_json,'$.allowedTools') WHERE value IN (SELECT old_name FROM retired_builtin_tool_names))
        OR EXISTS(SELECT 1 FROM json_each(policy_json,'$.deniedTools') WHERE value IN (SELECT old_name FROM retired_builtin_tool_names));
   UPDATE subagent_roles SET definition_json=json_set(definition_json,
     '$.allowedTools',CASE WHEN json_type(definition_json,'$.allowedTools')='array' THEN json((SELECT json_group_array(DISTINCT COALESCE((SELECT new_name FROM retired_builtin_tool_names WHERE old_name=value),value)) FROM json_each(definition_json,'$.allowedTools'))) ELSE json_extract(definition_json,'$.allowedTools') END,
     '$.deniedTools',json((SELECT json_group_array(DISTINCT COALESCE((SELECT new_name FROM retired_builtin_tool_names WHERE old_name=value),value)) FROM json_each(definition_json,'$.deniedTools'))))
     WHERE EXISTS(SELECT 1 FROM json_each(definition_json,'$.allowedTools') WHERE value IN (SELECT old_name FROM retired_builtin_tool_names))
        OR EXISTS(SELECT 1 FROM json_each(definition_json,'$.deniedTools') WHERE value IN (SELECT old_name FROM retired_builtin_tool_names));
   UPDATE subagent_project_roles SET definition_json=json_set(definition_json,
     '$.allowedTools',CASE WHEN json_type(definition_json,'$.allowedTools')='array' THEN json((SELECT json_group_array(DISTINCT COALESCE((SELECT new_name FROM retired_builtin_tool_names WHERE old_name=value),value)) FROM json_each(definition_json,'$.allowedTools'))) ELSE json_extract(definition_json,'$.allowedTools') END,
     '$.deniedTools',json((SELECT json_group_array(DISTINCT COALESCE((SELECT new_name FROM retired_builtin_tool_names WHERE old_name=value),value)) FROM json_each(definition_json,'$.deniedTools'))))
     WHERE EXISTS(SELECT 1 FROM json_each(definition_json,'$.allowedTools') WHERE value IN (SELECT old_name FROM retired_builtin_tool_names))
        OR EXISTS(SELECT 1 FROM json_each(definition_json,'$.deniedTools') WHERE value IN (SELECT old_name FROM retired_builtin_tool_names));
   UPDATE subagent_role_snapshots SET definition_json=json_set(definition_json,
     '$.allowedTools',CASE WHEN json_type(definition_json,'$.allowedTools')='array' THEN json((SELECT json_group_array(DISTINCT COALESCE((SELECT new_name FROM retired_builtin_tool_names WHERE old_name=value),value)) FROM json_each(definition_json,'$.allowedTools'))) ELSE json_extract(definition_json,'$.allowedTools') END,
     '$.deniedTools',json((SELECT json_group_array(DISTINCT COALESCE((SELECT new_name FROM retired_builtin_tool_names WHERE old_name=value),value)) FROM json_each(definition_json,'$.deniedTools'))))
     WHERE EXISTS(SELECT 1 FROM json_each(definition_json,'$.allowedTools') WHERE value IN (SELECT old_name FROM retired_builtin_tool_names))
        OR EXISTS(SELECT 1 FROM json_each(definition_json,'$.deniedTools') WHERE value IN (SELECT old_name FROM retired_builtin_tool_names));
   DROP TABLE retired_builtin_tool_names;`,
  115: `CREATE TABLE session_capability_selections(session_id TEXT NOT NULL REFERENCES sessions(id),owner TEXT NOT NULL,
     kind TEXT NOT NULL,key TEXT NOT NULL,selection_json TEXT NOT NULL,updated_at INTEGER NOT NULL,
     PRIMARY KEY(session_id,owner,kind,key));`,
  116: `INSERT INTO session_capability_selections(session_id,owner,kind,key,selection_json,updated_at)
   SELECT s.session_id,s.owner,'tool',json_extract(t.value,'$.id'),
     json_object('kind','tool','key',json_extract(t.value,'$.id'),'revision',json_extract(t.value,'$.revision'),
       'workspaceRoot',json_extract(s.selection_json,'$.contextRoot'),'contextRoot',json_extract(s.selection_json,'$.contextRoot'),
       'enabled',json('true'),'tools',json_array(json(t.value))),s.updated_at
   FROM session_capability_selections s,json_each(s.selection_json,'$.tools') t
   WHERE s.kind='skill' AND json_extract(s.selection_json,'$.enabled')=1
   ORDER BY s.updated_at DESC
   ON CONFLICT(session_id,owner,kind,key) DO UPDATE SET
     selection_json=excluded.selection_json,updated_at=excluded.updated_at
   WHERE json_extract(session_capability_selections.selection_json,'$.enabled')=0;`,
} as const
