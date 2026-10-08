/** Session-owned wake plans and their durable delivery revisions; legacy MonOs remains a separate scope. */
export const selfAwakeSessionSchema = `
DROP INDEX jobs_one_pending_self_awake;
CREATE UNIQUE INDEX jobs_one_pending_self_awake_session ON jobs(session_id)
  WHERE kind='self_awake' AND state='queued';
CREATE UNIQUE INDEX jobs_one_pending_self_awake_legacy_null ON jobs(kind)
  WHERE kind='self_awake' AND state='queued' AND session_id IS NULL;
CREATE INDEX jobs_self_awake_scope ON jobs(session_id,kind,state,created_at);
CREATE TABLE self_awake_session_schedules (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL,
  published_revision INTEGER NOT NULL DEFAULT 0,
  initial_anchor INTEGER NOT NULL,
  publication_error TEXT,
  legacy_request_id TEXT
);
CREATE INDEX self_awake_schedule_pending ON self_awake_session_schedules(session_id) WHERE published_revision<revision;
INSERT INTO self_awake_session_schedules(session_id,job_id,revision,initial_anchor,legacy_request_id)
  SELECT session_id,id,updated_at,created_at,id FROM jobs WHERE kind='self_awake' AND state='queued'
    AND session_id IS NOT NULL AND COALESCE(json_extract(payload_json,'$.scheduler'),'')!='monos';
CREATE TRIGGER self_awake_session_job_insert AFTER INSERT ON jobs
WHEN NEW.kind='self_awake' AND NEW.session_id IS NOT NULL AND NEW.state='queued'
  AND COALESCE(json_extract(NEW.payload_json,'$.scheduler'),'')!='monos' BEGIN
  INSERT INTO self_awake_session_schedules(session_id,job_id,revision,initial_anchor)
    VALUES(NEW.session_id,NEW.id,NEW.updated_at,NEW.created_at)
  ON CONFLICT(session_id) DO UPDATE SET job_id=excluded.job_id,
    revision=MAX(self_awake_session_schedules.revision+1,excluded.revision);
END;
CREATE TRIGGER self_awake_session_job_update AFTER UPDATE OF state,due_at,payload_json ON jobs
WHEN NEW.kind='self_awake' AND NEW.session_id IS NOT NULL BEGIN
  UPDATE self_awake_session_schedules SET job_id=NULL,revision=MAX(revision+1,NEW.updated_at)
    WHERE session_id=NEW.session_id AND job_id=NEW.id AND (NEW.state='cancelled'
      OR (NEW.state='failed' AND COALESCE(json_extract(NEW.payload_json,'$.scheduler'),'')!='monos'));
  INSERT INTO self_awake_session_schedules(session_id,job_id,revision,initial_anchor)
    SELECT NEW.session_id,NEW.id,NEW.updated_at,NEW.created_at
    WHERE NEW.state='queued' AND COALESCE(json_extract(NEW.payload_json,'$.scheduler'),'')!='monos'
      AND (OLD.state IS NOT NEW.state OR OLD.due_at IS NOT NEW.due_at OR OLD.payload_json IS NOT NEW.payload_json)
  ON CONFLICT(session_id) DO UPDATE SET job_id=excluded.job_id,
    revision=MAX(self_awake_session_schedules.revision+1,excluded.revision);
END;
CREATE TRIGGER self_awake_session_job_delete BEFORE DELETE ON jobs WHEN OLD.kind='self_awake' BEGIN
  UPDATE self_awake_session_schedules SET job_id=NULL,revision=revision+1 WHERE job_id=OLD.id;
END;
CREATE TRIGGER self_awake_session_closed AFTER UPDATE OF status ON sessions WHEN NEW.status!='active' BEGIN
  UPDATE jobs SET state='cancelled',updated_at=MAX(updated_at+1,NEW.updated_at)
    WHERE session_id=NEW.id AND kind='self_awake' AND state='queued';
  UPDATE self_awake_session_schedules SET job_id=NULL,revision=revision+1 WHERE session_id=NEW.id;
END;
ALTER TABLE self_awake_activations ADD COLUMN session_id TEXT REFERENCES sessions(id);
ALTER TABLE self_awake_activations ADD COLUMN legacy_scope INTEGER NOT NULL DEFAULT 1;
UPDATE self_awake_activations SET session_id=(SELECT session_id FROM self_awake_runs WHERE id=run_id);
CREATE INDEX self_awake_activations_session ON self_awake_activations(session_id,started_at DESC,run_id DESC);
CREATE INDEX self_awake_activations_legacy ON self_awake_activations(legacy_scope,started_at DESC,run_id DESC);
CREATE TRIGGER self_awake_activation_session AFTER INSERT ON self_awake_activations BEGIN
  UPDATE self_awake_activations SET session_id=(SELECT session_id FROM self_awake_runs WHERE id=NEW.run_id),
    legacy_scope=COALESCE((SELECT CASE WHEN json_extract(j.payload_json,'$.scheduleScope')='session' THEN 0 ELSE 1 END
      FROM self_awake_runs r JOIN jobs j ON j.id=r.job_id WHERE r.id=NEW.run_id),1)
    WHERE run_id=NEW.run_id;
END;
UPDATE jobs SET payload_json=json_set(payload_json,'$.scheduleScope','session')
  WHERE kind='self_awake' AND state='queued' AND session_id IS NOT NULL
    AND COALESCE(json_extract(payload_json,'$.scheduler'),'')!='monos';
`
