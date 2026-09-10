import { z } from 'zod'
import { jsonValue, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { validateToolSchema } from '@eden/plugin-sdk'
const command = z.array(z.string().min(1).max(4096)).min(1).max(64)
const schema = z.object({
  schemaVersion: z.literal(1), name: z.string().regex(/^[a-z_][a-z0-9_]{1,63}$/),
  label: z.string().max(256).optional(), description: z.string().trim().min(1).max(4000),
  parameters: jsonValue.default({ type: 'object', properties: {}, additionalProperties: false }),
  outputSchema: jsonValue.optional(), command, testCommand: command.optional(), timeoutSeconds: z.number().int().min(1).max(120).default(30),
}).strict()
export interface SkillCodeTool {
  name: string; label: string; description: string; parameters: Record<string, JsonValue>; outputSchema?: Record<string, JsonValue>
  command: string[]; testCommand: string[]; timeoutSeconds: number
}
export function codeManifests(files: Record<string, string>): SkillCodeTool[] {
  const result: SkillCodeTool[] = [], names = new Set<string>()
  for (const [filename, bytes] of Object.entries(files)) {
    if (!filename.startsWith('tools/')) continue
    if (!/^tools\/[^/]+\.json$/.test(filename)) throw new Error('tools/ may contain only root-level JSON manifests')
    const input = schema.parse(JSON.parse(Buffer.from(bytes, 'base64').toString('utf8')))
    if (names.has(input.name)) throw new Error(`Duplicate skill code tool: ${input.name}`)
    names.add(input.name)
    validateToolSchema(input.parameters)
    if (input.parameters.type !== 'object') throw new Error('Skill tool input must be an object schema')
    if (input.outputSchema !== undefined) validateToolSchema(input.outputSchema)
    assertSnapshotCommands(input, files)
    result.push({
      name: input.name, label: input.label ?? input.name, description: input.description, parameters: input.parameters,
      ...(input.outputSchema === undefined ? {} : { outputSchema: toJson(input.outputSchema) as Record<string, JsonValue> }),
      command: input.command, testCommand: input.testCommand ?? [], timeoutSeconds: input.timeoutSeconds
    })
  }
  return result
}

function assertSnapshotCommands(input: { schemaVersion: 1; name: string; description: string; parameters: JsonValue; command: string[]; timeoutSeconds: number; label?: string | undefined; outputSchema?: JsonValue | undefined; testCommand?: string[] | undefined }, files: Record<string, string>) {
  for (const tokens of [input.command, input.testCommand ?? []]) for (const token of tokens) {
    if (token.startsWith('-') || !/[\\/]/.test(token)) continue
    if (token.startsWith('/') || token.includes('\\') || token.split('/').includes('..') || !Object.hasOwn(files, token.replace(/^\.\//, ''))) {
      throw new Error(`Skill command path is outside its snapshot or absent: ${token}`)
    }
  }
}
