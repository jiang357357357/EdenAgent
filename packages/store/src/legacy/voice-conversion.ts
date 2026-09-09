import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyUuid, legacyTime, preserveLegacyRow } from './fields.ts'

function integer(row: LegacyRow, key: string, minimum = 0): number {
  const value = legacyTime(row[key])
  if (value < minimum) throw new Error(`Invalid legacy voice ${key}`)
  return value
}
export async function convertLegacyVoice(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const name = 'voice_speech_segments'
  if (!source.manifest.tables.some(table => table.name === name)) return []
  if (tableConverted(db, name)) return [name]
  if (!tableConverted(db, 'blobs')) return []
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan(name, row => {
      const id = integer(row, 'id', 1), blobId = legacyUuid(row, 'audio_blob_id')
      const blob = db.prepare('SELECT byte_length FROM blobs WHERE id=?').get(blobId)
      if (!blob) throw new Error('Legacy speech segment has no converted audio blob')
      const key = `legacy:voice:${id}`, createdAt = integer(row, 'created_at')
      db.prepare('INSERT INTO voice_audio_cache(cache_key,blob_id,format,duration_ms,size_bytes,created_at) VALUES(?,?,?,?,?,?)')
        .run(key, blobId, legacyText(row, 'audio_format'), row.duration_ms === null ? null : integer(row, 'duration_ms'), blob.byte_length!, createdAt)
      db.prepare(`INSERT INTO voice_speech_segments(id,session_id,message_id,segment_group_id,group_index,sequence,cache_key,
        text_hash,text_length,created_at,external_audio_asset_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, legacyUuid(row, 'session_id'), legacyText(row, 'external_message_id'), legacyText(row, 'segment_group_id'),
          integer(row, 'group_index'), integer(row, 'sequence'), key, legacyText(row, 'text_hash'), integer(row, 'text_length'), createdAt,
          row.external_audio_asset_id === null ? null : integer(row, 'external_audio_asset_id', 1))
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, String(id), String(id))
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, String(id), preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
    db.exec('COMMIT')
    return [name]
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
