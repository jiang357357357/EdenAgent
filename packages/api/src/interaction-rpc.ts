import { z } from 'zod'
import { commandExecutionSetSchema, commandExecutionInfoSchema } from './command-execution.ts'
import { permissionModeInfoSchema } from './permission-mode.ts'
import { jsonValue } from './json.ts'
import { permissionListSchema, permissionResolveSchema, permissionRequestIdSchema } from './plugins.ts'
import { questionItemSchema, questionListSchema, questionResolveSchema, questionIdSchema } from './questions.ts'
import { workspaceSwitchSchema, workspacePathSchema } from './rpc.ts'

export const permissionRequestSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), turnId: z.string().uuid(),
  operationId: z.string(), capability: z.string(), resource: z.string(), state: z.string(),
  details: jsonValue, request: jsonValue, createdAt: z.number().int(),
})
export const questionRequestSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), turnId: z.string().uuid(),
  state: z.string(), questions: z.array(questionItemSchema), createdAt: z.number().int(),
})
const workspaceInfoSchema = z.object({ name: z.string(), path: z.string() })
const workspaceSelectionSchema = z.object({
  currentPath: z.string(), pendingPath: z.null(), pendingSessionId: z.null(), requestedAt: z.null(), updatedAt: z.number().int(),
})
const workspaceDirectorySchema = z.object({ root: z.string(), path: z.string(), entries: z.array(z.object({
  name: z.string(), path: z.string(), type: z.enum(['directory', 'file']),
})) })
const workspaceFileSchema = z.object({
  name: z.string(), path: z.string(), size: z.number().int().nonnegative(), binary: z.boolean(),
  truncated: z.boolean(), content: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
})
export const interactionRpcMethods = {
  'command.execution.get': { params: z.object({}).strict(), result: commandExecutionInfoSchema },
  'command.execution.set': { params: commandExecutionSetSchema, result: commandExecutionInfoSchema },
  'permission.mode.get': { params: z.object({}).strict(), result: permissionModeInfoSchema },
  'permission.mode.set': { params: permissionModeInfoSchema, result: permissionModeInfoSchema },
  'permission.list': { params: permissionListSchema, result: z.array(permissionRequestSchema) },
  'permission.resolve': { params: permissionResolveSchema, result: permissionRequestSchema },
  'permission.grant.revoke': { params: permissionRequestIdSchema, result: z.object({ revoked: z.literal(true) }) },
  'question.list': { params: questionListSchema, result: z.array(questionRequestSchema) },
  'question.resolve': { params: questionResolveSchema, result: questionRequestSchema },
  'question.reject': { params: questionIdSchema, result: questionRequestSchema },
  'workspace.info': { params: z.object({}).strict(), result: workspaceInfoSchema },
  'workspace.switch': { params: workspaceSwitchSchema, result: workspaceSelectionSchema },
  'workspace.list': { params: workspacePathSchema, result: workspaceDirectorySchema },
  'workspace.read': { params: workspacePathSchema, result: workspaceFileSchema },
} as const
