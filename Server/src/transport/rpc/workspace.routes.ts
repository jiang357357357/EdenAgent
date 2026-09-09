import { workspaceSwitchSchema, workspacePathSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { WorkspaceService } from '../../modules/workspace/index.ts'
import type { SessionService } from '../../modules/sessions/index.ts'

export function workspaceRoutes(workspace: WorkspaceService, sessions: SessionService): Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> {
  return {
    'workspace.info': () => workspace.info(),
    'workspace.switch': value => {
      const params = workspaceSwitchSchema.parse(value)
      sessions.repository.read(params.sessionId)
      if (sessions.runningCount()) throw new Error('Wait for active turns before switching the workspace')
      return workspace.switch(params.path)
    },
    'workspace.list': async value => toJson(await workspace.list(workspacePathSchema.parse(value).path)),
    'workspace.read': async value => toJson(await workspace.read(workspacePathSchema.parse(value).path)),
  }
}
