import type { PermissionService } from '../permissions/index.ts'
import { z } from 'zod'
import { screenRequestSchema, cameraRequestSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { MediaService } from './service.ts'
export function mediaTools(service: MediaService, permissions: PermissionService, sessionId: string, turnId: string): RuntimeTool[] {
  return (['screen', 'camera'] as const).map(kind => ({
    name: kind === 'screen' ? 'analyze_screen' : 'capture_camera', revision: 'eden.media.v1', executionMode: 'sequential',
    description: `Ask the user to approve and provide a ${kind} capture. Wait for the authenticated client; capture may be rejected.`,
    parameters: toJson(z.toJSONSchema(kind === 'screen' ? screenRequestSchema : cameraRequestSchema)) as Record<string, JsonValue>,
    resultImages: (result, signal) => service.images(result, signal),
    async execute(raw, context) {
      const request = (kind === 'screen' ? screenRequestSchema : cameraRequestSchema).parse(raw)
      await permissions.request({ ...context, sessionId, turnId }, `media.${kind}`, kind === 'screen'
        ? screenRequestSchema.parse(request).source ?? 'auto' : cameraRequestSchema.parse(request).facingMode ?? 'user', toJson(request))
      context.signal.throwIfAborted()
      return service.ask(sessionId, turnId, kind, request, context.signal)
    },
  }))
}
