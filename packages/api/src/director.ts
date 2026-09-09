import { z } from 'zod'

export const actorIdSchema = z.union([z.string().trim().min(1).max(200), z.number().int().safe()])
export const directorBeatSchema = z.object({
  assistantID: actorIdSchema, intent: z.string().max(640),
  speechAct: z.enum(['respond', 'react', 'support', 'challenge', 'continue', 'close']),
  addressTo: z.string().max(220), replyToBeat: z.number().int().min(0).optional(),
}).strict()
export const directorSceneSchema = z.object({
  domain: z.enum(['social', 'coding', 'game', 'daily', 'research', 'mixed', 'general']),
  interactionType: z.enum(['conversation', 'task', 'mixed']), confidence: z.number().min(0).max(1), summary: z.string().max(480),
}).strict()
export const directorExecutionSchema = z.object({
  mode: z.enum(['solo', 'lead_support', 'ensemble']), leadAssistantID: actorIdSchema,
  toolOwnerAssistantID: actorIdSchema.optional(), observationStrategy: z.enum(['none', 'on_demand', 'shared', 'independent']),
}).strict()
export const directorPlanSchema = z.object({
  planID: z.string().uuid(), beats: z.array(directorBeatSchema).min(1).max(5),
  source: z.enum(['model', 'fallback', 'single']), diagnostic: z.string().max(500).optional(),
  scene: directorSceneSchema, execution: directorExecutionSchema,
}).strict()
export type DirectorBeat = z.infer<typeof directorBeatSchema>
export type DirectorPlan = z.infer<typeof directorPlanSchema>
export const directorRunSchema = directorPlanSchema.extend({
  userMessageID: z.string().optional(), status: z.enum(['planned', 'running', 'completed', 'failed']),
  activeBeatIndex: z.number().int().min(0).optional(), completedBeatIndexes: z.array(z.number().int().min(0)),
  participantCount: z.number().int().min(1).max(32), error: z.string().optional(),
  createdAt: z.number().int(), updatedAt: z.number().int(),
})
export type DirectorRun = z.infer<typeof directorRunSchema>
