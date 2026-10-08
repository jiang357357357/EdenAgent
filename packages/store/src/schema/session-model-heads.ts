/** Derived event heads: rebuild once on upgrade, then maintain in the event transaction. */
const actorKey = (payload: string) => `CASE WHEN json_valid(${payload}) THEN
  COALESCE(CAST(json_extract(${payload},'$.actor.assistantID') AS TEXT),'') ELSE '' END`
const malformed = (payload: string) => `CASE WHEN json_valid(${payload}) THEN 0 ELSE 1 END`
// A malformed response remains a candidate so reading it fails instead of silently using stale usage.
const usageCandidate = (payload: string) => `CASE WHEN json_valid(${payload}) THEN
  json_type(${payload},'$.usage.input') IN ('integer','real') AND json_extract(${payload},'$.usage.input')>=0
  AND json_type(${payload},'$.usage.output') IN ('integer','real') AND json_extract(${payload},'$.usage.output')>=0
  ELSE 1 END`

function requestHeads(source: string, condition: string) {
  return `SELECT e.session_id,${actorKey('e.payload_json')},${malformed('e.payload_json')},MAX(e.seq)
    FROM ${source} WHERE ${condition} AND e.kind='model.request'
    GROUP BY e.session_id,${actorKey('e.payload_json')},${malformed('e.payload_json')}`
}

function usageHeads(source: string, condition: string) {
  return `SELECT e.session_id,MAX(e.seq) FROM ${source}
    WHERE ${condition} AND e.kind='model.response' AND (${usageCandidate('e.payload_json')}) GROUP BY e.session_id`
}

const indexedEvents = 'events AS e INDEXED BY events_session_kind_seq'
const legacyEvents = `sessions AS s CROSS JOIN ${indexedEvents}`
const insertRequestHead = `INSERT INTO session_model_request_heads(session_id,actor_key,malformed,seq)
  VALUES(NEW.session_id,${actorKey('NEW.payload_json')},${malformed('NEW.payload_json')},NEW.seq)
  ON CONFLICT(session_id,actor_key,malformed) DO UPDATE SET seq=excluded.seq
  WHERE excluded.seq>session_model_request_heads.seq;`
const insertUsageHead = `INSERT INTO session_model_usage_heads(session_id,seq)
  SELECT NEW.session_id,NEW.seq WHERE NEW.kind='model.response' AND (${usageCandidate('NEW.payload_json')})
  ON CONFLICT(session_id) DO UPDATE SET seq=excluded.seq WHERE excluded.seq>session_model_usage_heads.seq;`

export const sessionModelHeadsSchema = `
  CREATE TABLE session_model_request_heads(
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    actor_key TEXT NOT NULL,malformed INTEGER NOT NULL CHECK(malformed IN (0,1)),seq INTEGER NOT NULL,
    PRIMARY KEY(session_id,actor_key,malformed));
  CREATE INDEX session_model_requests_latest ON session_model_request_heads(session_id,malformed,seq DESC);
  CREATE TABLE session_model_usage_heads(
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,seq INTEGER NOT NULL);
  INSERT INTO session_model_request_heads(session_id,actor_key,malformed,seq)
    ${requestHeads(legacyEvents, 'e.session_id=s.id')};
  INSERT INTO session_model_usage_heads(session_id,seq)
    ${usageHeads(legacyEvents, 'e.session_id=s.id')};
  CREATE TRIGGER session_model_request_insert AFTER INSERT ON events WHEN NEW.kind='model.request' BEGIN
    ${insertRequestHead}
  END;
  CREATE TRIGGER session_model_usage_insert AFTER INSERT ON events WHEN NEW.kind='model.response' BEGIN
    ${insertUsageHead}
  END;
  -- Production events are append-only. Explicit maintenance edits rebuild only the affected model kind.
  CREATE TRIGGER session_model_request_delete AFTER DELETE ON events WHEN OLD.kind='model.request' BEGIN
    DELETE FROM session_model_request_heads WHERE session_id=OLD.session_id;
    INSERT INTO session_model_request_heads(session_id,actor_key,malformed,seq)
      ${requestHeads(indexedEvents, 'e.session_id=OLD.session_id')};
  END;
  CREATE TRIGGER session_model_usage_delete AFTER DELETE ON events WHEN OLD.kind='model.response' BEGIN
    DELETE FROM session_model_usage_heads WHERE session_id=OLD.session_id;
    INSERT INTO session_model_usage_heads(session_id,seq)
      ${usageHeads(indexedEvents, 'e.session_id=OLD.session_id')};
  END;
  CREATE TRIGGER session_model_request_update AFTER UPDATE OF session_id,seq,kind,payload_json ON events
    WHEN OLD.kind='model.request' OR NEW.kind='model.request' BEGIN
    DELETE FROM session_model_request_heads WHERE session_id IN (OLD.session_id,NEW.session_id);
    INSERT INTO session_model_request_heads(session_id,actor_key,malformed,seq)
      ${requestHeads(indexedEvents, 'e.session_id IN (OLD.session_id,NEW.session_id)')};
  END;
  CREATE TRIGGER session_model_usage_update AFTER UPDATE OF session_id,seq,kind,payload_json ON events
    WHEN OLD.kind='model.response' OR NEW.kind='model.response' BEGIN
    DELETE FROM session_model_usage_heads WHERE session_id IN (OLD.session_id,NEW.session_id);
    INSERT INTO session_model_usage_heads(session_id,seq)
      ${usageHeads(indexedEvents, 'e.session_id IN (OLD.session_id,NEW.session_id)')};
  END;
`
