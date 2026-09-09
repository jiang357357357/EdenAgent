import { z } from 'zod'
import { jsonValue } from '@eden/api'

export const pluginManifestSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: z.string().min(1).max(120), description: z.string().min(1).max(2000),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), entry: z.literal('index.ts'),
  tool: z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), description: z.string().min(1).max(2000),
    parameters: z.object({ type: z.literal('object'), properties: z.record(z.string(), jsonValue).default({}),
      required: z.array(z.string()).default([]), additionalProperties: z.literal(false).default(false) }).strict(),
  }).strict(),
  permissions: z.array(z.object({ capability: z.literal('workspace.read'), description: z.string().min(1).max(500) }).strict()).max(1),
  tests: z.array(z.object({ input: jsonValue, expected: jsonValue }).strict()).min(1).max(20),
}).strict()
export type PluginManifest = z.infer<typeof pluginManifestSchema>
