import { z } from 'zod'
const text = z.string().trim().max(256)
export const voiceServiceUrlSchema = z.string().trim().max(4096).transform(value => value.replace(/\/+$/, '')).refine(value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash } catch { return false }
}, 'Voice service URL must be HTTP(S) without credentials, query or fragment')
export const gsvTtsConfigSchema = z.object({ provider: z.literal('gsv').default('gsv'), serviceUrl: voiceServiceUrlSchema.default('http://127.0.0.1:40302'),
  version: text.default('v2ProPlus'), world: text.default('Default'), role: text.default('阿罗娜'), roleId: text.default(''), emotion: text.default('平常'), textLanguage: text.default('中文'),
  speed: z.number().min(0.5).max(2).default(1), timeoutSeconds: z.number().int().min(5).max(300).default(60),
  topK: z.number().int().min(1).max(100).default(20), topP: z.number().min(0).max(1).default(0.6), temperature: z.number().min(0).max(2).default(0.6),
  sampleSteps: z.number().int().min(1).max(100).default(8), pauseSeconds: z.number().min(0).max(5).default(0.3), cutMethod: text.default('凑四句一切'),
  superResolution: z.boolean().default(false), referenceFree: z.boolean().default(false), freeze: z.boolean().default(false),
}).strict()
export const gsvSttConfigSchema = z.object({ provider: z.literal('gsv').default('gsv'), serviceUrl: voiceServiceUrlSchema.default('http://127.0.0.1:40302'),
  language: text.default('zh'), modelType: text.default('funasr'), modelSize: text.default('large'), precision: text.default('float32'),
  timeoutSeconds: z.number().int().min(1).max(300).default(60), retryCount: z.number().int().min(0).max(10).default(3),
  endSilenceMs: z.number().int().min(300).max(5000).default(1200), sessionEndSilenceMs: z.number().int().min(1000).max(15000).default(3000),
  autoFinish: z.boolean().default(true), autoSend: z.boolean().default(false), minSpeechDurationMs: z.number().int().min(100).max(2000).default(250),
  speechNoiseThreshold: z.number().min(0.1).max(1).default(0.6), prerollMs: z.number().int().min(0).max(3000).default(1200), chunkMs: z.number().int().min(100).max(1000).default(200),
}).strict()
export const voiceRuntimeConfigSchema = z.object({ tts: gsvTtsConfigSchema, stt: gsvSttConfigSchema })
export const gsvPreviewSchema = z.object({ config: gsvTtsConfigSchema, text: z.string().trim().min(1).max(500) }).strict()
export type GsvTtsConfig = z.infer<typeof gsvTtsConfigSchema>
export type GsvSttConfig = z.infer<typeof gsvSttConfigSchema>

export const gsvDiscoverySchema = z.object({ config: gsvTtsConfigSchema, stage: z.enum(['all', 'catalog', 'worlds', 'roles', 'emotions']).default('all') }).strict()
export const gsvSttTestSchema = z.object({ config: gsvSttConfigSchema }).strict()
