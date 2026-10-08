/** Historical SQL keyed by its immutable database version; execution order lives in migrations.ts. */
export const channelSchema = {
  8: `CREATE TABLE mon_operations (
     id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id), kind TEXT NOT NULL,
     endpoint TEXT NOT NULL, request_json TEXT NOT NULL, state TEXT NOT NULL, error TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );`,
  20: `CREATE TABLE mon_connections (
     session_id TEXT PRIMARY KEY REFERENCES sessions(id), core_base_url TEXT NOT NULL, core_token TEXT NOT NULL, updated_at INTEGER NOT NULL
   );`,
  38: `CREATE TABLE voice_configuration(kind TEXT PRIMARY KEY CHECK(kind IN ('tts','stt')),config_json TEXT NOT NULL,updated_at INTEGER NOT NULL);`,
  39: `CREATE TABLE voice_audio_cache(cache_key TEXT PRIMARY KEY,blob_id TEXT NOT NULL,format TEXT NOT NULL,
     duration_ms INTEGER,size_bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE voice_speech_segments(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES sessions(id),
     message_id TEXT NOT NULL,segment_group_id TEXT NOT NULL,group_index INTEGER NOT NULL,sequence INTEGER NOT NULL,
     cache_key TEXT NOT NULL REFERENCES voice_audio_cache(cache_key),text_hash TEXT NOT NULL,text_length INTEGER NOT NULL,created_at INTEGER NOT NULL,
     UNIQUE(session_id,message_id,segment_group_id,group_index,sequence));`,
  40: `CREATE TABLE media_requests(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),turn_id TEXT NOT NULL,
     kind TEXT NOT NULL,state TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT,error TEXT,created_at INTEGER NOT NULL,resolved_at INTEGER);
   CREATE INDEX media_pending ON media_requests(state,kind,created_at);`,
  41: `CREATE TABLE mon_projection_outbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),destination_key TEXT NOT NULL,
     kind TEXT NOT NULL,payload_json TEXT NOT NULL,state TEXT NOT NULL,remote_id TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE INDEX mon_projection_pending ON mon_projection_outbox(state,created_at);`,
  42: `CREATE TABLE mon_sync_progress(session_id TEXT NOT NULL REFERENCES sessions(id),destination_key TEXT NOT NULL,after_seq TEXT NOT NULL,
     attempts INTEGER NOT NULL,retry_at INTEGER NOT NULL,error TEXT,PRIMARY KEY(session_id,destination_key));`,
  43: `CREATE TABLE mon_contact_deliveries(request_id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),channel TEXT NOT NULL,
     payload_json TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`,
  60: `ALTER TABLE voice_speech_segments ADD COLUMN external_audio_asset_id INTEGER;`,
  124: `CREATE TABLE qq_channel_conversations (
     bot_qq TEXT NOT NULL, contact_qq TEXT NOT NULL,
     session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
     created_at INTEGER NOT NULL,
     PRIMARY KEY(bot_qq, contact_qq)
   );`,
  126: `CREATE TABLE web_resources (
     session_id TEXT NOT NULL REFERENCES sessions(id), ref_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK(kind IN ('search','page')), url TEXT NOT NULL,
     title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY(session_id,ref_id)
   );
   CREATE INDEX web_resources_recent ON web_resources(session_id,created_at DESC,ref_id DESC);`,
  127: `CREATE TABLE qq_channel_pending_files (
     owner_id TEXT NOT NULL, bot_qq TEXT NOT NULL, contact_qq TEXT NOT NULL,
     message_id TEXT NOT NULL, attachments_json TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY(owner_id,bot_qq,contact_qq,message_id)
   );
   CREATE INDEX qq_channel_pending_files_expiry ON qq_channel_pending_files(created_at);`,
  128: `CREATE TABLE qq_group_sessions (
     session_id TEXT PRIMARY KEY REFERENCES sessions(id),
     bot_qq TEXT NOT NULL, group_qq TEXT NOT NULL, operator_qq TEXT NOT NULL,
     allow_actions INTEGER NOT NULL DEFAULT 0 CHECK(allow_actions IN (0,1)), created_at INTEGER NOT NULL
   );
   CREATE INDEX qq_group_sessions_lookup ON qq_group_sessions(bot_qq,group_qq,operator_qq,created_at);`,
} as const
