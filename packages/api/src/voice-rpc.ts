import { z } from 'zod'
import { voiceSynthesizeSchema, voiceSegmentsSchema, voiceCancelSchema } from './voice-speech.ts'
import { voiceRuntimeConfigSchema, gsvTtsConfigSchema, gsvSttConfigSchema, gsvDiscoverySchema, gsvSttDiscoverySchema, gsvSttTestSchema, gsvPreviewSchema } from './voice.ts'
import { gsvDiscoveryResultSchema, gsvPreviewResultSchema, gsvSttDiscoveryResultSchema, sttTestResultSchema, voiceSynthesizeResultSchema, voiceSegmentInfoSchema } from './voice-results.ts'
export const voiceRpcMethods = {
  'voice.config.read': { params: z.object({}).strict(), result: voiceRuntimeConfigSchema },
  'voice.tts.config.update': { params: gsvTtsConfigSchema, result: voiceRuntimeConfigSchema },
  'voice.stt.config.update': { params: gsvSttConfigSchema, result: voiceRuntimeConfigSchema },
  'voice.gsv.discover': { params: gsvDiscoverySchema, result: gsvDiscoveryResultSchema },
  'voice.gsv.preview': { params: gsvPreviewSchema, result: gsvPreviewResultSchema },
  'voice.stt.discover': { params: gsvSttDiscoverySchema, result: gsvSttDiscoveryResultSchema },
  'voice.stt.test': { params: gsvSttTestSchema, result: sttTestResultSchema },
  'voice.tts.cancel': { params: voiceCancelSchema, result: z.object({ cancelled: z.boolean() }).strict() },
  'voice.tts.synthesize': { params: voiceSynthesizeSchema, result: voiceSynthesizeResultSchema },
  'voice.tts.list_segments': { params: voiceSegmentsSchema, result: z.array(voiceSegmentInfoSchema) },
} as const
