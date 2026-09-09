import { rpcMethods, type JsonValue } from '@eden/api'
import type { VoiceConfigRepository, VoiceService, SpeechService } from '../../modules/voice/index.ts'
import { contractHandler } from './contract-handler.ts'
export function voiceRoutes(config: VoiceConfigRepository, voice: VoiceService, speech: SpeechService): Record<string, (raw: JsonValue) => Promise<JsonValue>> {
  return {
    'voice.tts.synthesize': contractHandler(rpcMethods['voice.tts.synthesize'], input => speech.synthesize(input)),
    'voice.tts.list_segments': contractHandler(rpcMethods['voice.tts.list_segments'], input => speech.list(input)),
    'voice.gsv.discover': contractHandler(rpcMethods['voice.gsv.discover'], input => voice.discover(input)),
    'voice.stt.test': contractHandler(rpcMethods['voice.stt.test'], input => voice.testStt(input)),
    'voice.gsv.preview': contractHandler(rpcMethods['voice.gsv.preview'], input => voice.preview(input)),
    'voice.config.read': contractHandler(rpcMethods['voice.config.read'], () => config.read()),
    'voice.tts.config.update': contractHandler(rpcMethods['voice.tts.config.update'], input => config.update('tts', input)),
    'voice.stt.config.update': contractHandler(rpcMethods['voice.stt.config.update'], input => config.update('stt', input)),
  }
}
