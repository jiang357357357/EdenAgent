/** Sharing is explicit per session; the original bound session remains the owner and wake target. */
export const connectorSharingSchema = `
CREATE TABLE connector_session_shares (
  connector_id TEXT NOT NULL REFERENCES connectors(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(connector_id,session_id)
);
CREATE INDEX connector_session_shares_session ON connector_session_shares(session_id,connector_id);
CREATE TRIGGER connector_event_session_closed AFTER UPDATE OF status ON sessions WHEN NEW.status!='active' BEGIN
  UPDATE jobs SET state='cancelled',error='Connector event target session closed',updated_at=MAX(updated_at+1,NEW.updated_at)
    WHERE session_id=NEW.id AND kind='connector.event' AND state='queued';
END;
`
