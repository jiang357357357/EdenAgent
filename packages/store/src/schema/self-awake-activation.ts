/** The published start is an execution fact, not self_awake_runs.started_at (dispatch time). */
export const selfAwakeActivationSchema = `
CREATE TABLE self_awake_activations (
  run_id TEXT PRIMARY KEY REFERENCES self_awake_runs(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL
);
CREATE INDEX self_awake_activations_latest ON self_awake_activations(started_at DESC,run_id DESC);
CREATE INDEX self_awake_runs_turn ON self_awake_runs(session_id,turn_id,id);

INSERT INTO self_awake_activations(run_id,started_at)
SELECT r.id,MIN(e.created_at) FROM self_awake_runs r
JOIN events e INDEXED BY events_session_turn_kind_seq
  ON e.session_id=r.session_id AND e.turn_id=r.turn_id AND e.kind='agent.agent_start'
GROUP BY r.id;

CREATE TRIGGER self_awake_activation_event_insert AFTER INSERT ON events
WHEN NEW.kind='agent.agent_start' BEGIN
  INSERT INTO self_awake_activations(run_id,started_at)
  SELECT id,NEW.created_at FROM self_awake_runs WHERE session_id=NEW.session_id AND turn_id=NEW.turn_id
  ON CONFLICT(run_id) DO UPDATE SET started_at=excluded.started_at
    WHERE excluded.started_at<self_awake_activations.started_at;
END;

CREATE TRIGGER self_awake_activation_run_insert AFTER INSERT ON self_awake_runs BEGIN
  INSERT INTO self_awake_activations(run_id,started_at)
  SELECT NEW.id,MIN(created_at) FROM events INDEXED BY events_session_turn_kind_seq
  WHERE session_id=NEW.session_id AND turn_id=NEW.turn_id AND kind='agent.agent_start' HAVING COUNT(*)>0;
END;

CREATE TRIGGER self_awake_activation_run_update AFTER UPDATE OF session_id,turn_id ON self_awake_runs
WHEN OLD.session_id IS NOT NEW.session_id OR OLD.turn_id IS NOT NEW.turn_id BEGIN
  DELETE FROM self_awake_activations WHERE run_id=NEW.id;
  INSERT INTO self_awake_activations(run_id,started_at)
  SELECT NEW.id,MIN(created_at) FROM events INDEXED BY events_session_turn_kind_seq
  WHERE session_id=NEW.session_id AND turn_id=NEW.turn_id AND kind='agent.agent_start' HAVING COUNT(*)>0;
END;

CREATE TRIGGER self_awake_activation_event_delete AFTER DELETE ON events
WHEN OLD.kind='agent.agent_start' BEGIN
  DELETE FROM self_awake_activations WHERE run_id IN
    (SELECT id FROM self_awake_runs WHERE session_id=OLD.session_id AND turn_id=OLD.turn_id);
  INSERT INTO self_awake_activations(run_id,started_at)
  SELECT r.id,MIN(e.created_at) FROM self_awake_runs r
  JOIN events e INDEXED BY events_session_turn_kind_seq
    ON e.session_id=r.session_id AND e.turn_id=r.turn_id AND e.kind='agent.agent_start'
  WHERE r.session_id=OLD.session_id AND r.turn_id=OLD.turn_id GROUP BY r.id;
END;

CREATE TRIGGER self_awake_activation_event_update AFTER UPDATE OF session_id,turn_id,kind,created_at ON events
WHEN OLD.kind='agent.agent_start' OR NEW.kind='agent.agent_start' BEGIN
  DELETE FROM self_awake_activations WHERE run_id IN
    (SELECT id FROM self_awake_runs WHERE (session_id=OLD.session_id AND turn_id=OLD.turn_id)
      OR (session_id=NEW.session_id AND turn_id=NEW.turn_id));
  INSERT INTO self_awake_activations(run_id,started_at)
  SELECT r.id,MIN(e.created_at) FROM self_awake_runs r
  JOIN events e INDEXED BY events_session_turn_kind_seq
    ON e.session_id=r.session_id AND e.turn_id=r.turn_id AND e.kind='agent.agent_start'
  WHERE (r.session_id=OLD.session_id AND r.turn_id=OLD.turn_id)
    OR (r.session_id=NEW.session_id AND r.turn_id=NEW.turn_id) GROUP BY r.id;
END;
`
