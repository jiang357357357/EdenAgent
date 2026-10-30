import { z } from 'zod'
import { sharedSshTargetSchema, sharedHostDeploymentSchema, sharedHostDeploymentJobSchema } from './shared-host-rpc.ts'

// Empty shared selection permits account-level library discovery and pairing; bound file operations reject it in the host.
const scope = z.object({ sessionId: z.string().uuid(), expectedWorkspacePath: z.string().max(4096) }).strict()
const file = z.object({ fileId: z.string().uuid(), path: z.string(), revision: z.number().int().nonnegative(),
  deleted: z.boolean(), sha256: z.string().nullable(), size: z.number().int().nonnegative() })
const commit = file.omit({ revision: true }).extend({ operationId: z.string().uuid(), baseRevision: z.number().int().nonnegative() })
const role = z.enum(['owner', 'editor', 'viewer'])
const source = z.object({ path: z.string(), state: z.enum(['idle', 'syncing', 'offline', 'conflict']),
  pending: z.number().int().nonnegative(), conflicts: z.number().int().nonnegative(), error: z.string().nullable() })
const sourceScope = scope.extend({ hostDeviceId: z.string().uuid(), spaceId: z.string().uuid() })
const conflicts = z.object({ conflicts: z.array(z.object({ id: z.string(), path: z.string(), local: commit, remote: file.nullable(), createdAt: z.number() })) })
const space = z.object({ id: z.string().uuid(), name: z.string(), role,
  hostDeviceId: z.string().uuid().optional(), hostName: z.string().optional(), reachable: z.boolean().optional(), source: source.optional() })
const members = z.object({ members: z.array(z.object({ deviceId: z.string().uuid(), name: z.string(), role })) })
const managedScope = scope.extend({ hostDeviceId: z.string().uuid().optional() })
const host = z.object({ deviceId: z.string().uuid(), name: z.string(), addresses: z.array(z.string()), local: z.boolean(),
  reachable: z.boolean(), canPublish: z.boolean(), canManage: z.boolean(), dedicated: z.boolean(), directorySources: z.boolean().optional(), directoryCreate: z.boolean().optional(), error: z.string().nullable() })
const network = z.object({ deviceId: z.string().uuid(), name: z.string(), addresses: z.array(z.string()), port: z.number().int().nonnegative().optional(), listening: z.boolean(), discoveryError: z.string().nullable(),
  peers: z.array(z.object({ deviceId: z.string().uuid(), name: z.string(), addresses: z.array(z.string()), paired: z.boolean(), discovered: z.boolean(), revoked: z.boolean(), error: z.string().nullable().optional() })) })
export const sharedWorkspaceStatusSchema = z.object({
  available: z.boolean(), reason: z.string().nullable(), bound: z.boolean(), spaceId: z.string().nullable(), paused: z.boolean(),
  canPublish: z.boolean(), publishReason: z.string().nullable(),
  state: z.enum(['unbound', 'idle', 'syncing', 'offline', 'conflict', 'paused']), pending: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(), lastSync: z.number().nullable(), error: z.string().nullable(), root: z.string(),
})
export const sharedWorkspaceRpcMethods = {
  'sharedWorkspace.posture.read': { params: z.object({ sessionId: z.string().uuid() }).strict(), result: z.object({ mode: z.enum(['lan', 'cloud']), revision: z.string() }) },
  'sharedWorkspace.posture.select': { params: z.object({ sessionId: z.string().uuid(), mode: z.enum(['lan', 'cloud']), expectedRevision: z.string() }).strict(),
    result: z.object({ mode: z.enum(['lan', 'cloud']), revision: z.string() }) },
  'sharedWorkspace.directory.read': { params: z.object({ sessionId: z.string().uuid() }).strict(), result: z.object({
    path: z.string(), revision: z.string(), status: z.enum(['unselected', 'ready', 'invalid']), error: z.string().nullable(),
  }) },
  'sharedWorkspace.directory.select': { params: z.object({ sessionId: z.string().uuid(), path: z.string().min(1).max(4096), expectedRevision: z.string() }).strict(),
    result: z.object({ path: z.string(), revision: z.string(), status: z.enum(['unselected', 'ready', 'invalid']), error: z.string().nullable() }) },
  'sharedWorkspace.status': { params: z.object({ sessionId: z.string().uuid() }).strict(), result: sharedWorkspaceStatusSchema },
  'sharedWorkspace.network': { params: scope, result: network },
  'sharedWorkspace.hosts': { params: scope, result: z.object({ hosts: z.array(host) }) },
  'sharedWorkspace.exportHost': { params: scope, result: z.object({ fileName: z.literal('eden-shared-host.mjs'), contentBase64: z.string().max(1_000_000), command: z.string() }) },
  'sharedWorkspace.sshProbe': { params: scope.extend({ target: sharedSshTargetSchema }), result: z.object({ fingerprint: z.string() }) },
  'sharedWorkspace.deployHost': { params: scope.extend({ deployment: sharedHostDeploymentSchema }), result: sharedHostDeploymentJobSchema },
  'sharedWorkspace.deploymentStatus': { params: scope.extend({ jobId: z.string().uuid().optional() }), result: sharedHostDeploymentJobSchema.nullable() },
  'sharedWorkspace.cancelDeployment': { params: scope.extend({ jobId: z.string().uuid() }), result: sharedHostDeploymentJobSchema },
  'sharedWorkspace.connectHost': { params: scope.extend({ code: z.string().trim().min(1).max(4096), address: z.string().trim().min(1).max(200).optional() }),
    result: z.object({ paired: z.literal(true), deviceId: z.string().uuid() }) },
  'sharedWorkspace.invitePairing': { params: managedScope, result: z.object({ code: z.string(), expiresAt: z.number() }) },
  'sharedWorkspace.pairDevice': { params: scope.extend({ code: z.string().trim().min(1).max(4096), address: z.string().trim().min(1).max(200).optional() }), result: z.object({ paired: z.literal(true) }) },
  'sharedWorkspace.devices': { params: managedScope, result: z.object({ devices: z.array(z.object({
    deviceId: z.string().uuid(), name: z.string(), revoked: z.boolean(), local: z.boolean().optional(),
  })) }) },
  'sharedWorkspace.revokeDevice': { params: managedScope.extend({ deviceId: z.string().uuid() }), result: z.object({ revoked: z.literal(true) }) },
  'sharedWorkspace.spaces': { params: scope, result: z.object({ spaces: z.array(space) }) },
  'sharedWorkspace.create': { params: managedScope.extend({ name: z.string().trim().min(1).max(120),
    sourceDirectory: z.string().min(1).max(4096).optional(), confirmSource: z.literal(true).optional() })
    .refine(input => !input.sourceDirectory || input.confirmSource === true, '请确认共享云端源目录'), result: z.object({ space }) },
  'sharedWorkspace.cloudDirectories': { params: scope.extend({ hostDeviceId: z.string().uuid(), path: z.string().max(4096).optional(), after: z.string().max(255).optional() }),
    result: z.object({ path: z.string(), parent: z.string().nullable(), entries: z.array(z.object({ name: z.string(), path: z.string() })), truncated: z.boolean(), selectable: z.boolean(), reason: z.string().nullable() }) },
  'sharedWorkspace.cloudDirectory.create': { params: scope.extend({ hostDeviceId: z.string().uuid(), parent: z.string().min(1).max(4096), name: z.string().trim().min(1).max(255) }),
    result: z.object({ path: z.string() }) },
  'sharedWorkspace.source.bind': { params: sourceScope.extend({ path: z.string().min(1).max(4096), confirmSource: z.literal(true) }), result: z.object({ source }) },
  'sharedWorkspace.source.conflicts': { params: sourceScope, result: conflicts },
  'sharedWorkspace.source.resolve': { params: sourceScope.extend({ conflictId: z.string().min(1), strategy: z.enum(['local', 'remote']) }), result: z.object({ source }) },
  'sharedWorkspace.cloudMembers': { params: sourceScope.extend({ action: z.enum(['list', 'set', 'remove']), deviceId: z.string().uuid().optional(), role: z.enum(['editor', 'viewer']).optional() }), result: members },
  'sharedWorkspace.bind': { params: scope.extend({ spaceId: z.string().uuid(), confirmShare: z.literal(true) }), result: sharedWorkspaceStatusSchema },
  'sharedWorkspace.sync': { params: scope, result: sharedWorkspaceStatusSchema },
  'sharedWorkspace.pause': { params: scope.extend({ paused: z.boolean() }), result: sharedWorkspaceStatusSchema },
  'sharedWorkspace.files': { params: scope, result: z.object({ files: z.array(file) }) },
  'sharedWorkspace.conflicts': { params: scope, result: z.object({ conflicts: z.array(z.object({
    id: z.string(), path: z.string(), local: commit, remote: file.nullable(), createdAt: z.number(),
  })) }) },
  'sharedWorkspace.resolve': { params: scope.extend({ conflictId: z.string().min(1), strategy: z.enum(['local', 'remote']) }), result: sharedWorkspaceStatusSchema },
  'sharedWorkspace.members': { params: scope.extend({ action: z.enum(['list', 'set', 'remove']),
    deviceId: z.string().uuid().optional(), role: z.enum(['editor', 'viewer']).optional() }).superRefine((input, ctx) => {
    if (input.action !== 'list' && input.deviceId === undefined) ctx.addIssue({ code: 'custom', message: '共享权限操作需要 deviceId' })
    if (input.action === 'set' && input.role === undefined) ctx.addIssue({ code: 'custom', message: '设置成员需要 role' })
  }), result: members },
  'sharedWorkspace.history': { params: scope.extend({ fileId: z.string().uuid() }), result: z.object({ versions: z.array(file) }) },
  'sharedWorkspace.restore': { params: scope.extend({ fileId: z.string().uuid(), revision: z.number().int().positive() }), result: sharedWorkspaceStatusSchema },
} as const
