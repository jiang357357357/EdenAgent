/** Historical SQL keyed by its immutable database version; execution order lives in migrations.ts. */
export const automationSchema = {
  15: `CREATE TABLE memories (
     id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, kind TEXT NOT NULL,
     scope_type TEXT NOT NULL, scope_key TEXT NOT NULL, source_session_id TEXT NOT NULL DEFAULT '',
     metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX memories_scope ON memories(scope_type, scope_key, updated_at DESC, id DESC);`,
  16: `CREATE TABLE memory_extractions (
     id TEXT PRIMARY KEY, input_id TEXT NOT NULL REFERENCES inputs(id), session_id TEXT NOT NULL REFERENCES sessions(id),
     turn_id TEXT NOT NULL REFERENCES turns(id), actor_id TEXT NOT NULL, scope_key TEXT NOT NULL,
     user_text TEXT NOT NULL, assistant_text TEXT NOT NULL, state TEXT NOT NULL,
     candidates_json TEXT NOT NULL DEFAULT '[]', error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     UNIQUE(input_id, actor_id)
   );
   CREATE INDEX memory_extractions_pending ON memory_extractions(state, created_at);`,
  17: `ALTER TABLE memory_extractions ADD COLUMN saved_ids_json TEXT NOT NULL DEFAULT '[]';`,
  21: `CREATE TABLE memos (
     id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL,
     status TEXT NOT NULL, priority TEXT NOT NULL, remind_at INTEGER, due_at INTEGER, repeat_rule TEXT NOT NULL,
     related_session_id TEXT NOT NULL, metadata_json TEXT NOT NULL, last_triggered_at INTEGER, completed_at INTEGER,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, operation_key TEXT UNIQUE
   );
   CREATE INDEX memos_updated ON memos(updated_at DESC,id DESC);
   CREATE INDEX memos_due ON memos(status,COALESCE(remind_at,due_at));`,
  22: `CREATE TABLE jobs (
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
  23: `CREATE TABLE self_awake_runs (
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
  24: `CREATE TABLE desktop_reminders (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL REFERENCES turns(id),
     title TEXT NOT NULL, message TEXT NOT NULL, state TEXT NOT NULL, author_json TEXT NOT NULL,
     operation_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, displayed_at INTEGER, closed_at INTEGER
   );
   CREATE INDEX desktop_reminders_pending ON desktop_reminders(state,created_at);
   ALTER TABLE self_awake_runs ADD COLUMN action_result_json TEXT;`,
  57: `ALTER TABLE memos ADD COLUMN snoozed_until INTEGER;
   ALTER TABLE memos ADD COLUMN source TEXT NOT NULL DEFAULT 'monagent';
   DROP INDEX memos_due;
   CREATE INDEX memos_due ON memos(status,COALESCE(snoozed_until,remind_at,due_at));`,
  58: `CREATE TABLE self_awake_notification_history(
     run_id TEXT PRIMARY KEY REFERENCES self_awake_runs(id), requested_channel TEXT NOT NULL,
     state TEXT NOT NULL, original_state TEXT NOT NULL, payload_json TEXT NOT NULL, result_json TEXT,
     attempts INTEGER NOT NULL, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );`,
  61: `CREATE TABLE desktop_reminders_v2 (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT REFERENCES turns(id),
     title TEXT NOT NULL,message TEXT NOT NULL,state TEXT NOT NULL,author_json TEXT NOT NULL,
     operation_key TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,displayed_at INTEGER,closed_at INTEGER
   );
   INSERT INTO desktop_reminders_v2 SELECT * FROM desktop_reminders;
   DROP TABLE desktop_reminders;
   ALTER TABLE desktop_reminders_v2 RENAME TO desktop_reminders;
   CREATE INDEX desktop_reminders_pending ON desktop_reminders(state,created_at);`,
  93: `CREATE TABLE job_outcome_reviews(job_id TEXT PRIMARY KEY REFERENCES jobs(id),expected_updated_at INTEGER NOT NULL,
     decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  97: `CREATE INDEX jobs_session_history ON jobs(session_id,created_at DESC,id DESC);
   CREATE INDEX jobs_session_kind_history ON jobs(session_id,kind,created_at DESC,id DESC);`,
  98: `CREATE TABLE memo_job_resubmissions(source_job_id TEXT PRIMARY KEY REFERENCES jobs(id),new_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     expected_updated_at INTEGER NOT NULL,snapshot_json TEXT,note TEXT NOT NULL,created_at INTEGER NOT NULL,mode TEXT NOT NULL);`,
  100: `CREATE TABLE self_awake_job_resubmissions(source_job_id TEXT PRIMARY KEY REFERENCES jobs(id),new_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
     fingerprint TEXT NOT NULL,author_json TEXT NOT NULL,environment_json TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  101: `CREATE TABLE self_awake_notification_reviews(run_id TEXT PRIMARY KEY REFERENCES self_awake_notification_history(run_id),
     fingerprint TEXT NOT NULL,previous_json TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL,source TEXT NOT NULL);`,
  102: `CREATE TABLE self_awake_run_reviews(run_id TEXT PRIMARY KEY REFERENCES self_awake_runs(id),fingerprint TEXT NOT NULL,
     previous_json TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);`,
  113: `UPDATE jobs SET state='cancelled',error='Replaced by latest self-awake plan during queue upgrade'
     WHERE kind='self_awake' AND state='queued' AND id NOT IN
       (SELECT id FROM jobs WHERE kind='self_awake' AND state='queued' ORDER BY created_at DESC,rowid DESC LIMIT 1);
   CREATE UNIQUE INDEX jobs_one_pending_self_awake ON jobs(kind) WHERE kind='self_awake' AND state='queued';
   CREATE TABLE self_awake_timer_publications(job_id TEXT PRIMARY KEY REFERENCES jobs(id),published_at INTEGER NOT NULL);
   CREATE TABLE self_awake_submission_aliases(user_id TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,
     job_id TEXT NOT NULL REFERENCES jobs(id),PRIMARY KEY(user_id,request_key));`,
  121: `ALTER TABLE self_awake_runs ADD COLUMN diary_cleared INTEGER NOT NULL DEFAULT 0 CHECK(diary_cleared IN (0,1));
   UPDATE self_awake_runs SET diary_cleared=1 WHERE state='completed' AND decision_json IS NULL
     AND NOT EXISTS(SELECT 1 FROM self_awake_diaries d WHERE d.run_id=self_awake_runs.id)
     AND EXISTS(SELECT 1 FROM events e WHERE e.session_id=self_awake_runs.session_id
       AND e.turn_id=self_awake_runs.turn_id AND e.kind='agent.message_end'
       AND json_extract(e.payload_json,'$.message.role')='assistant');`,
} as const
