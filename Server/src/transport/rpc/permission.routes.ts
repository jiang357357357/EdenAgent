import { permissionListSchema, permissionResolveSchema, permissionRequestIdSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { PermissionService } from '../../modules/permissions/index.ts'

export function permissionRoutes(permissions: PermissionService): Record<string, (value: JsonValue) => JsonValue> {
  return {
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
}
