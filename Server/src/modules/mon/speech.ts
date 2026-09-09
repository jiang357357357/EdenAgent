import { z } from 'zod'
import { MonHttpError } from '@eden/integrations'
import type { MonClient } from '@eden/integrations'
import { toJson } from '@eden/api'
import type { VoiceSynthesizeInput } from '@eden/api'
import type { MonOperationRepository } from './operation-repository.ts'
const resultSchema = z.object({ success: z.boolean(), audio_url: z.string().max(4096).nullish(), duration_ms: z.number().int().nonnegative().nullable().optional() })
export async function synthesizeMonSpeech(client: MonClient, operations: MonOperationRepository, input: VoiceSynthesizeInput, signal: AbortSignal) {
  const endpoint = '/api/tts/configs/synthesize/'
  const body = toJson({ external_session_id: input.sessionId, external_message_id: input.messageId, segment_group_id: input.segmentGroupId,
    group_index: input.groupIndex, sequence: input.sequence, text: input.text, config_id: input.configId, mode: input.mode })
  signal.throwIfAborted()
  const id = operations.begin(input.sessionId, endpoint, toJson({ messageId: input.messageId, segmentGroupId: input.segmentGroupId,
    groupIndex: input.groupIndex, sequence: input.sequence, configId: input.configId }), 'voice.synthesize')
  let raw
  try { raw = await client.post(endpoint, body, signal) }
  catch (error) {
    const rejected = error instanceof MonHttpError && [400, 401, 403, 404, 422].includes(error.status)
    operations.finish(id, rejected ? 'failed' : 'unknown', rejected ? 'Core rejected speech synthesis' : 'Speech response was not confirmed; inspect Core before retrying')
    throw new Error(`Mon speech operation ${id} ${rejected ? 'was rejected' : 'has an unknown outcome'}`)
  }
  const parsed = resultSchema.safeParse(raw)
  if (!parsed.success) { operations.finish(id, 'unknown', 'Core returned an invalid speech response'); throw new Error(`Invalid Mon speech response (${id})`) }
  if (!parsed.data.success) { operations.finish(id, 'failed', 'Core reported speech synthesis failure'); throw new Error('Mon speech synthesis failed') }
  operations.finish(id, 'applied')
  if (!parsed.data.audio_url) throw new Error('Mon speech response has no downloadable audio')
  const audio = await client.fetchAudio(parsed.data.audio_url, signal)
  return { ...audio, durationMs: parsed.data.duration_ms ?? null }
}
