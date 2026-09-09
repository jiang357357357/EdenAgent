import { z } from 'zod'
import { voiceSynthesizeSchema, voiceSegmentsSchema } from './voice-speech.ts'
import { voiceRuntimeConfigSchema, gsvTtsConfigSchema, gsvSttConfigSchema, gsvDiscoverySchema, gsvSttTestSchema, gsvPreviewSchema } from './voice.ts'
import { gsvDiscoveryResultSchema, gsvPreviewResultSchema, sttTestResultSchema, voiceSynthesizeResultSchema, voiceSegmentInfoSchema } from './voice-results.ts'
export const voiceRpcMethods = {
  'voice.config.read': { params: z.object({}).strict(), result: voiceRuntimeConfigSchema },
  'voice.tts.config.update': { params: gsvTtsConfigSchema, result: voiceRuntimeConfigSchema },
  'voice.stt.config.update': { params: gsvSttConfigSchema, result: voiceRuntimeConfigSchema },
  'voice.gsv.discover': { params: gsvDiscoverySchema, result: gsvDiscoveryResultSchema },
  'voice.gsv.preview': { params: gsvPreviewSchema, result: gsvPreviewResultSchema },
  'voice.stt.test': { params: gsvSttTestSchema, result: sttTestResultSchema },
  'voice.tts.synthesize': { params: voiceSynthesizeSchema, result: voiceSynthesizeResultSchema },
  'voice.tts.list_segments': { params: voiceSegmentsSchema, result: z.array(voiceSegmentInfoSchema) },
} as const
