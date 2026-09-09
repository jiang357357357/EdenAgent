import type { WebSocket } from 'ws'
import type { SessionRepository } from '../sessions/index.ts'
import type { VoiceConfigRepository } from './config-repository.ts'
import { bridgeTranscription } from './realtime-connection.ts'
export class RealtimeVoiceService {
  private readonly active = new Map<WebSocket, () => void>()
  private closed = false
  constructor(private readonly sessions: SessionRepository, private readonly config: VoiceConfigRepository,
    private readonly monUrl: (sessionId: string) => string) {}
  prepare(sessionId: string): (client: WebSocket) => void {
    if (this.closed || this.active.size >= 4) throw new Error('Transcription service unavailable or full')
    const session = this.sessions.read(sessionId)
    const config = session.runtimeOrigin === 'local' ? this.config.read().stt : undefined
    const url = config ? new URL(config.serviceUrl) : new URL(this.monUrl(sessionId))
    if (config) { url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.pathname = '/ws/asr/final' }
    return client => {
      if (this.closed || this.active.size >= 4) { client.close(1013, 'Transcription capacity reached'); return }
      try {
        this.active.set(client, bridgeTranscription(client, url.href, config))
        client.once('close', () => this.active.delete(client))
      } catch { client.close(1011, 'Transcription connection failed') }
    }
  }
  close() { this.closed = true; for (const stop of this.active.values()) stop(); this.active.clear() }
}
