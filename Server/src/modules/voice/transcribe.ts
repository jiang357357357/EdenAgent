import { z } from 'zod'
import type { GsvSttConfig } from '@eden/api'
export async function transcribeRecording(config: GsvSttConfig, pcm: Buffer, signal: AbortSignal): Promise<string> {
  if (!pcm.length) return ''
  if (pcm.length % 2 || pcm.length > 64 * 1024 * 1024) throw new Error('Invalid PCM16 recording size')
  const wav = Buffer.alloc(44 + pcm.length)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44)
  const form = new FormData()
  form.set('language', config.language); form.set('model_type', config.modelType)
  form.set('model_size', config.modelSize); form.set('precision', config.precision)
  form.set('audio_file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav')
  const response = await fetch(config.serviceUrl + '/inference/transcribe', { method: 'POST', body: form, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutSeconds * 1000)]) })
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('GSV recording transcription failed') }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break
      size += item.value.length; if (size > 1024 * 1024) throw new Error('Transcription response exceeds 1 MiB')
      chunks.push(item.value)
    }
    const result = z.object({ success: z.boolean().optional(), text: z.string().max(262144) }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (result.success === false) throw new Error('GSV rejected recording transcription')
    return result.text.trim()
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
