import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import { workspaceSwitchSchema, workspacePathSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { WorkspaceService } from '../../modules/workspace/index.ts'
import type { SessionService } from '../../modules/sessions/index.ts'

export function workspaceRoutes(workspace: WorkspaceService, sessions: SessionService): Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> {
  const handlers: Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> = {
    'workspace.info': () => workspace.info(),
    'workspace.switch': value => {
      const params = workspaceSwitchSchema.parse(value)
      sessions.repository.read(params.sessionId)
      if (sessions.runningCount()) throw new Error('Wait for active turns before switching the workspace')
      const changed = sessions.repository.database.transaction(() => {
        const previousPath = workspace.info().path
        const result = workspace.switch(params.path)
        const event = sessions.repository.events.insert(params.sessionId, null, 'workspace.changed', {
          sessionID: params.sessionId, previousPath, path: result.currentPath,
          currentPath: result.currentPath, runtimeOrigin: sessions.repository.origin,
        })
        return { result, event }
      })
      sessions.repository.events.publish(changed.event)
      return changed.result
    },
    'workspace.list': async value => toJson(await workspace.list(workspacePathSchema.parse(value).path)),
    'workspace.read': async value => toJson(await workspace.read(workspacePathSchema.parse(value).path)),
  }
  return Object.fromEntries(Object.entries(handlers).map(([method, handler]) => {
    const contract = rpcMethods[method as keyof typeof rpcMethods]
    return [method, contractHandler(contract, input => handler(toJson(input)))]
  }))
}
