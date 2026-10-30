import { z } from 'zod'

export const videoSourceSchema = z.union([
  z.object({ attachment: z.uuid() }).strict(),
  z.object({ path: z.string().min(1).max(4096) }).strict(),
  z.object({ youtubeUrl: z.string().url().max(4096) }).strict(),
])
export type VideoSource = z.infer<typeof videoSourceSchema>
export const inspectVideoSchema = z.object({ source: videoSourceSchema }).strict()
const range = z.object({ start_time_seconds: z.number().nonnegative().optional(), end_time_seconds: z.number().positive().optional() })
  .strict().refine(value => value.start_time_seconds === undefined || value.end_time_seconds === undefined || value.start_time_seconds < value.end_time_seconds, '视频起点必须早于终点')
const duplicates = z.object({ enabled: z.boolean() }).strict().optional()
const sampling = z.union([
  z.object({ mode: z.literal('auto'), request_max_frames: z.number().int().min(1).max(300).optional(), near_duplicates: duplicates }).strict(),
  z.object({ mode: z.literal('timestamps'), timestamps_seconds: z.array(z.number().nonnegative()).min(1).max(300), near_duplicates: duplicates }).strict(),
  z.object({ mode: z.literal('interval'), capture_interval_seconds: z.number().positive(), request_max_frames: z.number().int().min(1).max(300).optional(), near_duplicates: duplicates }).strict(),
  z.object({ mode: z.literal('scene'), scene_threshold: z.number().gt(0).lt(1), request_max_frames: z.number().int().min(1).max(300).optional(), near_duplicates: duplicates }).strict(),
])
export const prepareVideoSchema = z.object({
  source: videoSourceSchema, range: range.optional(), sampling: sampling.optional(),
  optimization_profile: z.enum(['auto', 'token_saver', 'balanced', 'content_first']).default('balanced'),
  language: z.string().regex(/^[a-z]{2,3}$/).optional(),
}).strict()
export const videoJobSchema = z.object({ job_id: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict()
export const videoTimelineSchema = videoJobSchema.extend({
  max_chars: z.number().int().min(1000).max(30000).default(20000),
  start_ms: z.number().int().nonnegative().optional(), end_ms: z.number().int().positive().optional(),
  continuation_token: z.string().min(1).max(8192).optional(),
}).strict()
export const videoFramesSchema = videoJobSchema.extend({
  frame_ids: z.array(z.string().regex(/^f_\d{6,9}$/)).min(1).max(8), max_frames: z.number().int().min(1).max(8).default(4),
}).strict().refine(value => new Set(value.frame_ids).size === value.frame_ids.length && value.frame_ids.length <= value.max_frames, '选帧数量超限或重复')
export const videoPreviewsSchema = videoJobSchema.extend({
  frame_ids: z.array(z.string().regex(/^f_\d{6,9}$/)).min(1).max(8),
  max_previews: z.number().int().min(1).max(8).default(4), preview_width: z.number().int().min(64).max(1280).default(640),
}).strict()
