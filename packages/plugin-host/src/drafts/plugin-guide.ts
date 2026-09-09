import { z } from 'zod'
import { pluginManifestSchema } from '@eden/plugin-sdk'
import { toJson } from '@eden/api'

export function pluginGuide() {
  return toJson({
    manifestSchema: z.toJSONSchema(pluginManifestSchema),
    sourceExample: 'export default function(input: { text: string }) { return { length: input.text.length }; }',
    handler: 'Default exported function (input, context) returning JSON or Promise<JSON>. context.workspaceRoot is /workspace when granted.',
    dependencies: 'Single index.ts; only explicit node: built-in imports; no npm installation, reference directives, computed imports or host extension APIs.',
    schema: 'Typed JSON Schema subset: type, description, properties, required, additionalProperties:false, items, enum; depth <= 12. Every nested object must declare properties and additionalProperties:false.',
    limits: '64 KiB source, 20 test cases, 5 seconds execution, 1 MiB output, 64 MiB JS heap, 1 GiB process address space, no network or child processes.',
    workflow: 'draft -> validate -> test -> install exact tested revision -> user workspace grant if needed -> activate -> invoke exact revision; rollback by activating a prior installed revision.',
  })
}
