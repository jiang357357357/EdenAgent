import { z } from 'zod'
const time = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER)
const option = z.object({ id: z.string(), value: z.string(), label: z.string() })
export const gsvDiscoveryResultSchema = z.object({ ok: z.literal(true), latencyMs: time, versions: z.array(option), worlds: z.array(option),
  roles: z.array(option), emotions: z.array(option), selectedRoleId: z.string() })
export const gsvPreviewResultSchema = z.object({ ok: z.literal(true), audioBlobId: z.string().uuid(), mime: z.string(), durationMs: time.nullable(), latencyMs: time, roleId: z.string() })
export const sttTestResultSchema = z.object({ ok: z.literal(true), latencyMs: time })
export const voiceSynthesizeResultSchema = z.object({ success: z.literal(true), audio_blob_id: z.string().uuid(), audio_url: z.null(), text: z.string(), cached: z.boolean(),
  cache_key: z.string(), audio_format: z.string(), duration_ms: time.nullable(), size_bytes: time, speech_segment_id: time,
  segment_group_id: z.string(), group_index: time, sequence: time })
export const voiceSegmentInfoSchema = z.object({ id: time, external_message_id: z.string(), audio_asset_id: time, audio_url: z.string(), audio_blob_id: z.string().uuid(),
  duration_ms: time.nullable(), audio_format: z.string(), segment_group_id: z.string(), group_index: time, sequence: time, text_hash: z.string(), text_length: time })
export type VoiceSegmentInfo = z.infer<typeof voiceSegmentInfoSchema>
export type VoiceSynthesizeResult = z.infer<typeof voiceSynthesizeResultSchema>
