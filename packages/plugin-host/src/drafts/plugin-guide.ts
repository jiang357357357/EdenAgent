import { z } from 'zod'
import { pluginManifestSchema } from '@eden/plugin-sdk'
import { toJson } from '@eden/api'

export function pluginGuide() {
  return toJson({
    manifestExample: {
      schemaVersion: 1, id: 'text-length', name: 'Text length', description: 'Return the UTF-16 length of supplied text.',
      version: '0.1.0', entry: 'index.ts', permissions: [],
      tool: { name: 'text_length', description: 'Count UTF-16 code units in text.', parameters: {
        type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false,
      } },
      tests: [{ input: { text: 'hello' }, expected: { length: 5 } }],
    },
    manifestSchema: z.toJSONSchema(pluginManifestSchema),
    sourceExample: 'export default function(input: { text: string }) { return { length: input.text.length }; }',
    handler: 'Default exported function (input, context) returning JSON or Promise<JSON>. context.workspaceRoot is an absolute host path.',
    dependencies: 'Single index.ts; only explicit node: built-in imports; no npm installation, reference directives, computed imports or host extension APIs.',
    schema: 'Typed JSON Schema subset: type, description, properties, required, additionalProperties:false, items, enum; depth <= 12. Every nested object must declare properties and additionalProperties:false.',
    limits: '64 KiB source, 20 test cases, 5 seconds execution, 1 MiB output, current OS account filesystem/network/process access; sandbox paused pending developer review.',
    workflow: 'read(id) before editing an existing draft; pass its draftRevision as expectedDraftRevision when saving (omit/null for new draft). Unchanged content retries are idempotent. Pass expectedDraftRevision to validate/test to bind the reviewed source snapshot; validate returns both draftRevision and the distinct compiled revision. draft -> validate -> test -> install exact tested revision -> user workspace grant if needed -> activate -> invoke exact revision; rollback by activating a prior installed revision.',
  })
}
