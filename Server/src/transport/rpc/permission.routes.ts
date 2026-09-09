import { permissionModeInfoSchema, rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import { permissionListSchema, permissionResolveSchema, permissionRequestIdSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { PermissionService } from '../../modules/permissions/index.ts'

export function permissionRoutes(permissions: PermissionService): Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> {
  const handlers: Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> = {
    'permission.mode.get': () => ({ mode: permissions.mode() }),
    'permission.mode.set': value => ({ mode: permissions.setMode(permissionModeInfoSchema.parse(value).mode) }),
    'permission.list': value => toJson(permissions.list(permissionListSchema.parse(value).sessionId ?? undefined).map(item => ({ ...item, request: item.details }))),
    'permission.resolve': value => {
      const params = permissionResolveSchema.parse(value)
      permissions.resolve(params.requestId, params.decision !== 'deny', 'denied', params.decision === 'always', params.message ?? null)
      const item = permissions.list().find(request => request.id === params.requestId)!
      return toJson({ ...item, request: item.details })
    },
    'permission.grant.revoke': value => {
      permissions.revoke(permissionRequestIdSchema.parse(value).requestId)
      return { revoked: true }
    },
  }
  return Object.fromEntries(Object.entries(handlers).map(([method, handler]) => {
    const contract = rpcMethods[method as keyof typeof rpcMethods]
    return [method, contractHandler(contract, input => handler(toJson(input)))]
  }))
}
