/** Private credential provenance and bounded delivery attempts; existing audit rows remain intact. */
export const monDeliverySchema = `
CREATE TABLE mon_service_credentials(session_id TEXT PRIMARY KEY REFERENCES sessions(id), core_base_url TEXT NOT NULL,enabled INTEGER NOT NULL);
CREATE TABLE mon_projection_attempts(id TEXT PRIMARY KEY REFERENCES mon_projection_outbox(id), attempts INTEGER NOT NULL);
CREATE INDEX mon_projection_destination ON mon_projection_outbox(session_id,destination_key,kind);
CREATE TABLE voice_synthesis_failures(session_id TEXT NOT NULL REFERENCES sessions(id),message_id TEXT NOT NULL,
  chunk_key TEXT NOT NULL,attempts INTEGER NOT NULL,error TEXT NOT NULL,PRIMARY KEY(session_id,message_id,chunk_key));
`
