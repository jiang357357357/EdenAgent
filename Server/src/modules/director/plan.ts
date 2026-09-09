import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { directorPlanSchema, directorSceneSchema, directorExecutionSchema } from '@eden/api'
import type { DirectorPlan } from '@eden/api'
import { directorRoster } from './roster.ts'
import type { DirectorParticipant } from './roster.ts'
import { normalizeBeats } from './normalize-beats.ts'

const rawPlanSchema = z.object({ scene: z.record(z.string(), z.unknown()).default({}),
  execution: z.record(z.string(), z.unknown()).default({}), beats: z.array(z.unknown()).optional(), turns: z.array(z.unknown()).optional() })
const defaultScene = { domain: 'general', interactionType: 'conversation', confidence: 0, summary: '当前对话' } as const

function scene(raw: Record<string, unknown>): DirectorPlan['scene'] {
  return {
    domain: directorSceneSchema.shape.domain.catch('general').parse(raw.domain),
    interactionType: directorSceneSchema.shape.interactionType.catch('conversation').parse(raw.interactionType),
    confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : 0,
    summary: typeof raw.summary === 'string' ? [...raw.summary].slice(0, 120).join('') : defaultScene.summary,
  }
}

function execution(raw: Record<string, unknown>, beats: DirectorPlan['beats']): DirectorPlan['execution'] {
  const ids = new Map(beats.map(beat => [String(beat.assistantID), beat.assistantID]))
  const lead = ids.get(String(raw.leadAssistantID ?? raw.leadAssistantId)) ?? beats[0]!.assistantID
  const owner = ids.get(String(raw.toolOwnerAssistantID ?? raw.toolOwnerAssistantId))
  const mode = directorExecutionSchema.shape.mode.catch('solo').parse(raw.mode)
  return { mode: ids.size === 1 ? 'solo' : mode === 'solo' ? 'lead_support' : mode, leadAssistantID: lead,
    ...(owner === undefined ? {} : { toolOwnerAssistantID: owner }),
    observationStrategy: directorExecutionSchema.shape.observationStrategy.catch('on_demand').parse(raw.observationStrategy) }
}

function fallback(userText: string, roster: DirectorParticipant[], diagnostic?: string): DirectorPlan {
  const mentioned = roster.find(actor => [actor.assistantName, actor.characterName].some(name => name && userText.toLowerCase().includes(name.toLowerCase())))
  const id = (mentioned ?? roster[0]!).assistantId
  return { planID: randomUUID(), source: roster.length === 1 ? 'single' : 'fallback',
    ...(diagnostic ? { diagnostic } : {}), scene: { ...defaultScene },
    execution: { mode: 'solo', leadAssistantID: id, observationStrategy: 'on_demand' },
    beats: [{ assistantID: id, intent: '直接回应用户', speechAct: 'respond', addressTo: 'user' }] }
}

export function parseDirectorPlan(text: string, participants: unknown, userText: string): DirectorPlan {
  const roster = directorRoster(participants)
  if (roster.length === 1) return fallback(userText, roster)
  if (Buffer.byteLength(text) > 1024 * 1024) return fallback(userText, roster, 'director_output_too_large')
  let decoded: unknown
  try { decoded = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) }
  catch { return fallback(userText, roster, 'director_output_invalid_json') }
  const parsed = rawPlanSchema.safeParse(decoded)
  if (!parsed.success) return fallback(userText, roster, 'director_output_invalid_schema')
  const beats = normalizeBeats(parsed.data.beats ?? parsed.data.turns ?? [], roster)
  if (!beats.length) return fallback(userText, roster, 'director_output_no_valid_beats')
  return directorPlanSchema.parse({ planID: randomUUID(), source: 'model', beats, scene: scene(parsed.data.scene), execution: execution(parsed.data.execution, beats) })
}
