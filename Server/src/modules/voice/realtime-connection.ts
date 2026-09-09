import { WebSocket } from 'ws'
import type { RawData } from 'ws'
import type { GsvSttConfig } from '@eden/api'
import { transcribeRecording } from './transcribe.ts'
const bytes = (raw: RawData) => Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer)
export function bridgeTranscription(client: WebSocket, url: string, config?: GsvSttConfig): () => void {
  const abort = new AbortController()
  const upstream = new WebSocket(url, { followRedirects: false, handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024 })
  const recording: Buffer[] = []
  let size = 0, started = false, finishing = false, closed = false
  const timer = setTimeout(() => fail('Transcription session exceeded 30 minutes'), 30 * 60 * 1000)
  timer.unref()
  function send(socket: WebSocket, data: Buffer | string, binary = false) {
    if (socket.readyState !== WebSocket.OPEN) throw new Error('Transcription connection is not ready')
    if (socket.bufferedAmount + Buffer.byteLength(data) > 4 * 1024 * 1024) throw new Error('Transcription connection is too slow')
    socket.send(data, { binary })
  }
  function cleanup() {
    if (closed) return
    closed = true; clearTimeout(timer); abort.abort(); recording.length = 0
    upstream.terminate(); client.close()
  }
  function fail(message: string) {
    if (closed) return
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'error', message }))
    cleanup()
  }
  async function finish() {
    finishing = true; upstream.close()
    try {
      const text = await transcribeRecording(config!, Buffer.concat(recording), abort.signal)
      send(client, JSON.stringify({ type: 'final_result', status: 'stopped', final_text: text, source: 'offline-complete-audio' }))
      cleanup()
    } catch { fail('GSV complete recording transcription failed') }
  }
  upstream.on('open', () => {
    if (config) {
      try { send(client, JSON.stringify({ type: 'connection', status: 'connected', message: '本地 GSV 实时 STT 已就绪' })) }
      catch { cleanup() }
    }
  })
  client.on('message', (raw, binary) => {
    if (closed || finishing) return
    try {
      const data = bytes(raw)
      if (!config) { send(upstream, data, binary); return }
      if (binary) {
        if (!started || data.length % 2) throw new Error('Send start before PCM16 audio')
        size += data.length
        if (size > 64 * 1024 * 1024) throw new Error('Recording exceeds 64 MiB')
        recording.push(data); send(upstream, data, true); return
      }
      const payload = JSON.parse(data.toString('utf8')) as Record<string, unknown>
      if (payload.command === 'stop' && started) { void finish(); return }
      if (payload.command !== 'start' || started) throw new Error('Invalid transcription command')
      const endSilence = typeof payload.end_silence_ms === 'number' && Number.isFinite(payload.end_silence_ms)
        ? Math.max(300, Math.min(5000, Math.round(payload.end_silence_ms))) : config.endSilenceMs
      const vad = { chunk_ms: config.chunkMs, min_speech_duration_ms: config.minSpeechDurationMs,
        preroll_ms: config.prerollMs, speech_noise_threshold: config.speechNoiseThreshold }
      send(upstream, JSON.stringify({ command: 'start', language: config.language, model_type: config.modelType,
        model_size: config.modelSize, precision: config.precision, end_silence_ms: endSilence, vad }))
      started = true
      send(client, JSON.stringify({ type: 'status', status: 'started', config_id: 0, realtime_vad: { end_silence_ms: endSilence, ...vad },
        input_behavior: { session_end_silence_ms: config.sessionEndSilenceMs, auto_finish: config.autoFinish, auto_send: config.autoSend } }))
    } catch { fail('Invalid audio stream command or upstream connection unavailable') }
  })
  upstream.on('message', (raw, binary) => {
    if (closed || finishing) return
    try { send(client, bytes(raw), binary) } catch { cleanup() }
  })
  upstream.on('error', () => { if (!finishing) fail('Upstream transcription connection failed') })
  upstream.on('close', () => { if (!finishing) cleanup() })
  client.on('error', cleanup); client.on('close', cleanup)
  return cleanup
}
