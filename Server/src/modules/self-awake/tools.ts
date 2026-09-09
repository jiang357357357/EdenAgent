import { selfAwakeContextSchema } from './context.ts'
import type { SelfAwakeContext } from './context.ts'
import { z } from 'zod'
import { selfAwakeTimerSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { JobRepository } from '../jobs/index.ts'
import type { PermissionService } from '../permissions/index.ts'
import type { SelfAwakeRepository } from './repository.ts'

export function selfAwakeTools(repository: SelfAwakeRepository, jobs: JobRepository, permissions: PermissionService, activity: SelfAwakeContext, sessionId: string, turnId: string): RuntimeTool[] {
  return [{
    name: 'set_self_awake_timer', revision: 'eden.self-awake.v1', executionMode: 'sequential',
    description: 'Schedule a future activation in this session after approval. Repeated autonomous scheduling is limited to eight generations. Use an ISO date, millisecond timestamp, or afterMinutes.',
    parameters: toJson(z.toJSONSchema(selfAwakeTimerSchema, { io: 'input' })) as Record<string, JsonValue>,
    async execute(raw, context) {
      const input = selfAwakeTimerSchema.parse(raw)
      const dueAt = input.at ?? Date.now() + input.afterMinutes! * 60000
      if (dueAt <= Date.now() || dueAt > Date.now() + 10080 * 60000) throw new Error('Self-awake timer must be within the next seven days')
      const parent = repository.parentJob(sessionId, turnId)
      const depth = parent ? parent.depth + 1 : 0
      if (depth > 8) throw new Error('Self-awake scheduling depth exceeded; a new user instruction is required')
      await permissions.request({ ...context, sessionId, turnId }, 'job.schedule', `self-awake:${sessionId}`, toJson({ dueAt, reason: input.reason, depth }))
      context.signal.throwIfAborted()
      return toJson(jobs.schedule({ kind: 'self_awake', sessionId, dueAt,
        payload: { prompt: input.reason, trigger: { type: 'scheduled', source: 'agent', reason: input.reason } },
        key: `self-awake:${sessionId}:${turnId}:${context.callId}`, causationId: parent?.id ?? turnId, depth }))
    },
  }, {
    name: 'get_self_awake_context', revision: 'eden.self-awake.v1', executionMode: 'sequential',
    description: 'Read one self-awake context section: request, desktop_window, desktop_session, audio_state, recent_events, recent_diaries or recent_contacts. Check snapshot age; missing data is unknown.',
    parameters: toJson(z.toJSONSchema(selfAwakeContextSchema, { io: 'input' })) as Record<string, JsonValue>,
    async execute(raw, context) {
      return activity.read(sessionId, turnId, raw, context.signal)
    },
  }]
}
