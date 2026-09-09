import type { EdenDatabase } from '@eden/store'
import type { VoiceSynthesizeInput } from '@eden/api'
interface AudioRecord { blobId: string; format: string; durationMs: number | null; sizeBytes: number }
export class SpeechRepository {
  constructor(private readonly database: EdenDatabase) {}
  cached(key: string): AudioRecord | undefined {
    const row = this.database.connection.prepare('SELECT * FROM voice_audio_cache WHERE cache_key=?').get(key)
    return row ? { blobId: String(row.blob_id), format: String(row.format), durationMs: row.duration_ms === null ? null : Number(row.duration_ms), sizeBytes: Number(row.size_bytes) } : undefined
  }
  save(key: string, audio: AudioRecord) {
    this.database.connection.prepare('INSERT INTO voice_audio_cache VALUES(?,?,?,?,?,?) ON CONFLICT(cache_key) DO NOTHING')
      .run(key, audio.blobId, audio.format, audio.durationMs, audio.sizeBytes, Date.now())
  }
  segment(input: VoiceSynthesizeInput, key: string, textHash: string): number {
    const row = this.database.connection.prepare(`INSERT INTO voice_speech_segments
      (session_id,message_id,segment_group_id,group_index,sequence,cache_key,text_hash,text_length,created_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,message_id,segment_group_id,group_index,sequence)
      DO UPDATE SET external_audio_asset_id=NULL,cache_key=excluded.cache_key,text_hash=excluded.text_hash,text_length=excluded.text_length RETURNING id`)
      .get(input.sessionId, input.messageId, input.segmentGroupId, input.groupIndex, input.sequence, key, textHash, input.text.length, Date.now())
    return Number(row!.id)
  }
  list(sessionId: string, messageId?: string | null) {
    return this.database.connection.prepare(`SELECT s.*,c.blob_id,c.format,c.duration_ms FROM voice_speech_segments s
      JOIN voice_audio_cache c ON c.cache_key=s.cache_key WHERE s.session_id=? AND (? IS NULL OR s.message_id=?)
      ORDER BY s.message_id,s.group_index,s.sequence,s.id`).all(sessionId, messageId ?? null, messageId ?? null).map(row => ({
        id: Number(row.id), external_message_id: String(row.message_id), audio_asset_id: Number(row.external_audio_asset_id ?? row.id), audio_url: '',
        audio_blob_id: String(row.blob_id), duration_ms: row.duration_ms === null ? null : Number(row.duration_ms), audio_format: String(row.format),
        segment_group_id: String(row.segment_group_id), group_index: Number(row.group_index), sequence: Number(row.sequence),
        text_hash: String(row.text_hash), text_length: Number(row.text_length),
      }))
  }
}
