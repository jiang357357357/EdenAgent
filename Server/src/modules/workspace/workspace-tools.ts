import { z } from 'zod'
import { toJson } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { CommandService } from '../commands/index.ts'
import type { PermissionService } from '../permissions/index.ts'
import { WorkspaceService } from './workspace-service.ts'
import { writeWorkspaceFile } from './workspace-write.ts'

const readSchema = z.object({ path: z.string().min(1).max(4096) }).strict()
const writeSchema = readSchema.extend({ content: z.string().max(1024 * 1024), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), createOnly: z.boolean().default(false) })
const commandSchema = z.object({ command: z.string().min(1).max(65536) }).strict()

export function workspaceTools(workspace: WorkspaceService, permissions: PermissionService, sessionId: string, turnId: string, commands: CommandService, workspaceOnly = false): RuntimeTool[] {
  return [
    {
      name: 'eden_read_file', revision: 'eden.workspace.read.v1', description: 'Read a file from the selected workspace. Returns at most 1 MiB; binary files have no text content.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      async execute(input, context) { context.signal.throwIfAborted(); return toJson(await workspace.read(readSchema.parse(input).path)) }
    },
    {
      name: 'eden_write_file', revision: 'eden.workspace.write.v1', executionMode: 'sequential',
      description: 'Write UTF-8 text atomically to an existing workspace directory after approval. Use createOnly to avoid overwriting, or expectedSha256 to check the previous content. Runs in OS sandbox.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, expectedSha256: { type: 'string' }, createOnly: { type: 'boolean' } }, required: ['path', 'content'], additionalProperties: false },
      async execute(input, context) {
        const params = writeSchema.parse(input)
        const root = workspace.root()
        await permissions.request({ ...context, sessionId, turnId }, 'workspace.write', root, toJson(params))
        return workspace.mutate(root, context.signal, () => writeWorkspaceFile(root, params, context.signal))
      }
    },
    {
      name: 'eden_exec', revision: 'eden.workspace.exec.v1', executionMode: 'sequential',
      description: 'Run the OS shell in the selected workspace after approval: /bin/sh on POSIX, Windows PowerShell in Windows host mode. Uses the user-configured sandbox or host execution boundary, 30-second limit, 1 MiB combined output. Files in the workspace may be modified. No implicit retry.',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
      async execute(input, context) {
        const params = commandSchema.parse(input)
        const root = workspace.root()
        const snapshot = commands.snapshot()
        if (workspaceOnly && (snapshot.config.mode !== 'sandbox' || snapshot.config.networkAccess || snapshot.config.writableRoots.length)) throw new Error('Subagent policy requires sandbox execution with no network or additional writable roots')
        await permissions.request({ ...context, sessionId, turnId }, 'command.execute', root, toJson({ ...params, execution: snapshot }))
        return workspace.mutate(root, context.signal, async () => toJson(await commands.execute(snapshot, root, params.command, context.signal)))
      }
    },
  ]
}
