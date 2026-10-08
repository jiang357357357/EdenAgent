/** Historical SQL keyed by its immutable database version; execution order lives in migrations.ts. */
export const subagentSchema = {
  35: `CREATE TABLE subagent_threads(id TEXT PRIMARY KEY,root_session_id TEXT NOT NULL REFERENCES sessions(id),parent_session_id TEXT NOT NULL REFERENCES sessions(id),
     child_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),parent_id TEXT REFERENCES subagent_threads(id),agent_path TEXT NOT NULL,
     task_name TEXT NOT NULL,role TEXT NOT NULL,depth INTEGER NOT NULL,state TEXT NOT NULL,operation_key TEXT NOT NULL UNIQUE,
     latest_job_id TEXT REFERENCES jobs(id),result_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
     started_at INTEGER,completed_at INTEGER,UNIQUE(root_session_id,agent_path));`,
  36: `CREATE TABLE subagent_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     sender_session_id TEXT NOT NULL REFERENCES sessions(id),message TEXT NOT NULL,operation_key TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,
     UNIQUE(agent_id,operation_key));`,
  37: `ALTER TABLE subagent_threads ADD COLUMN max_turns INTEGER NOT NULL DEFAULT 8;
   ALTER TABLE subagent_threads ADD COLUMN turns_used INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE subagent_threads ADD COLUMN deadline_at INTEGER;`,
  53: `ALTER TABLE subagent_threads ADD COLUMN spawn_request_hash TEXT;`,
  54: `CREATE TABLE subagent_followups(agent_id TEXT NOT NULL REFERENCES subagent_threads(id),operation_key TEXT NOT NULL,message TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(agent_id,operation_key));`,
  55: `ALTER TABLE subagent_threads ADD COLUMN model_requests_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN tool_calls_used INTEGER NOT NULL DEFAULT 0;`,
  56: `ALTER TABLE subagent_threads ADD COLUMN max_model_requests INTEGER NOT NULL DEFAULT 128;
   ALTER TABLE subagent_threads ADD COLUMN max_tool_calls INTEGER NOT NULL DEFAULT 256;`,
  76: `CREATE TABLE subagent_policies(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),policy_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  77: `ALTER TABLE subagent_threads ADD COLUMN max_tokens INTEGER NOT NULL DEFAULT 1000000;
   ALTER TABLE subagent_threads ADD COLUMN max_cost_microusd INTEGER;
   ALTER TABLE subagent_threads ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN cost_microusd_used INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN usage_unknown INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN cost_unknown INTEGER NOT NULL DEFAULT 0;
   UPDATE subagent_threads SET usage_unknown=1,cost_unknown=1 WHERE id IN (SELECT agent_id FROM legacy_subagent_context);
   CREATE TABLE subagent_usage_receipts(turn_id TEXT NOT NULL,message_id TEXT NOT NULL,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     tokens INTEGER,cost_microusd INTEGER,created_at INTEGER NOT NULL,PRIMARY KEY(turn_id,message_id));`,
  78: `CREATE TABLE subagent_model_requests(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     session_id TEXT NOT NULL REFERENCES sessions(id),turn_id TEXT NOT NULL,state TEXT NOT NULL,cost_configured INTEGER NOT NULL,
     created_at INTEGER NOT NULL,resolved_at INTEGER,note TEXT);
   CREATE TABLE subagent_request_owners(request_id TEXT NOT NULL REFERENCES subagent_model_requests(id),
     agent_id TEXT NOT NULL REFERENCES subagent_threads(id),PRIMARY KEY(request_id,agent_id));
   CREATE INDEX subagent_request_owner ON subagent_request_owners(agent_id,request_id);`,
  79: `ALTER TABLE subagent_threads ADD COLUMN legacy_usage_unknown INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE subagent_threads ADD COLUMN legacy_cost_unknown INTEGER NOT NULL DEFAULT 0;
   UPDATE subagent_threads SET legacy_usage_unknown=usage_unknown,legacy_cost_unknown=cost_unknown;`,
  81: `CREATE TABLE subagent_roles(name TEXT PRIMARY KEY,definition_json TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL);
   CREATE TABLE subagent_role_history(revision TEXT PRIMARY KEY,name TEXT NOT NULL,previous_json TEXT,definition_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  82: `CREATE TABLE subagent_role_snapshots(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),definition_json TEXT NOT NULL,skills_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  83: `CREATE TABLE local_child_models(session_id TEXT PRIMARY KEY REFERENCES sessions(id),configuration_json TEXT NOT NULL,updated_at INTEGER NOT NULL);`,
  84: `CREATE TABLE subagent_project_roles(workspace_root TEXT NOT NULL,name TEXT NOT NULL,definition_json TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL,
     PRIMARY KEY(workspace_root,name));
   ALTER TABLE subagent_role_history ADD COLUMN workspace_root TEXT NOT NULL DEFAULT '';`,
  85: `CREATE TABLE subagent_role_imports(id TEXT PRIMARY KEY,plan_json TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER NOT NULL,result_json TEXT,applied_at INTEGER);`,
  86: `ALTER TABLE subagent_threads ADD COLUMN workspace_root TEXT;
   CREATE TABLE subagent_workspace_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),previous_root TEXT,workspace_root TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  87: `CREATE TABLE subagent_policy_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     source_hash TEXT NOT NULL,request_hash TEXT NOT NULL,review_json TEXT NOT NULL,policy_json TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  88: `CREATE TABLE subagent_model_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     fingerprint TEXT NOT NULL,snapshot_json TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  89: `CREATE TABLE subagent_baseline_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     fingerprint TEXT NOT NULL,previous_json TEXT NOT NULL,tokens INTEGER NOT NULL,cost_microusd INTEGER NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  90: `CREATE TABLE subagent_reopen_restorations(agent_id TEXT PRIMARY KEY REFERENCES subagent_threads(id),
     note TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE subagent_model_restoration_history(id INTEGER PRIMARY KEY AUTOINCREMENT,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     fingerprint TEXT NOT NULL,snapshot_json TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL,replaced_at INTEGER NOT NULL);`,
  91: `CREATE TABLE subagent_deadline_restorations(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     request_json TEXT NOT NULL,previous_deadline INTEGER,deadline INTEGER NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  92: `CREATE TABLE subagent_mailbox_restorations(id TEXT PRIMARY KEY REFERENCES legacy_subagent_mailbox(id),
     fingerprint TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  96: `CREATE TABLE subagent_job_resubmissions(source_job_id TEXT PRIMARY KEY REFERENCES jobs(id),agent_id TEXT NOT NULL REFERENCES subagent_threads(id),
     expected_updated_at INTEGER NOT NULL,new_job_id TEXT NOT NULL REFERENCES jobs(id),note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  103: `CREATE TABLE subagent_root_messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),
     sender_session_id TEXT NOT NULL REFERENCES sessions(id),message TEXT NOT NULL,operation_key TEXT NOT NULL,
     created_at INTEGER NOT NULL,read_at INTEGER,UNIQUE(session_id,operation_key));
   CREATE INDEX subagent_root_inbox ON subagent_root_messages(session_id,read_at,created_at,id);`,
  104: `CREATE TABLE subagent_mailbox_followups(id TEXT PRIMARY KEY REFERENCES legacy_subagent_mailbox(id),session_id TEXT NOT NULL REFERENCES sessions(id),
     agent_id TEXT NOT NULL REFERENCES subagent_threads(id),fingerprint TEXT NOT NULL,note TEXT NOT NULL,
     job_id TEXT NOT NULL REFERENCES jobs(id),created_at INTEGER NOT NULL);`,
  105: `CREATE TABLE subagent_mailbox_abandonments(id TEXT PRIMARY KEY REFERENCES legacy_subagent_mailbox(id),
     session_id TEXT NOT NULL REFERENCES sessions(id),fingerprint TEXT NOT NULL,previous_json TEXT NOT NULL,
     note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  106: `ALTER TABLE subagent_threads ADD COLUMN parent_actor_id TEXT;`,
  107: `CREATE TABLE subagent_model_source_reviews(agent_id TEXT NOT NULL REFERENCES subagent_threads(id),fingerprint TEXT NOT NULL,
     actor_id TEXT,note TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(agent_id,fingerprint));`,
  108: `CREATE TABLE local_model_profiles(model_key TEXT PRIMARY KEY,configuration_json TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL);
   ALTER TABLE local_child_models ADD COLUMN independent INTEGER NOT NULL DEFAULT 0;`,
  109: `CREATE TABLE mon_child_models(session_id TEXT NOT NULL REFERENCES sessions(id),model_key TEXT NOT NULL,entity_id TEXT NOT NULL,
     binding_json TEXT NOT NULL,connection_hash TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(session_id,model_key));`,
} as const
