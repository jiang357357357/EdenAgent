import { parseDocument } from 'yaml'
import { z } from 'zod'
import { skillNameSchema } from '@eden/api'

const text = z.string().max(4000)
const names = z.array(z.string().min(1).max(128)).max(128)
const frontmatterSchema = z.object({
  name: skillNameSchema.optional(), description: text.optional(), version: z.union([text, z.number()]).optional(),
  'display-name': text.optional(), 'default-prompt': text.optional(), 'disable-model-invocation': z.boolean().optional(),
  metadata: z.object({
    edenagent: z.object({
      display_name: text.optional(), version: z.union([text, z.number()]).optional(),
      tools: names.optional(), profiles: names.optional(), permissions: names.optional(), default_prompt: text.optional(),
    }).passthrough().optional()
  }).passthrough().optional(),
}).passthrough()
export function skillMetadata(content: string, fallback: string) {
  const fields = parseFrontmatter(content)
  const eden = fields.metadata?.edenagent
  const name = skillNameSchema.parse(fields.name ?? fallback)
  return {
    name, displayName: eden?.display_name || fields['display-name'] || name, description: fields.description ?? '',
    version: String(eden?.version ?? fields.version ?? '1'), modelInvocable: fields['disable-model-invocation'] !== true,
    tools: [...new Set(eden?.tools ?? [])], profiles: [...new Set(eden?.profiles ?? [])], permissions: [...new Set(eden?.permissions ?? [])],
    defaultPrompt: eden?.default_prompt ?? fields['default-prompt'] ?? ''
  }
}

function parseFrontmatter(content: string) {
  const normalized = content.replace(/\r\n?/g, '\n')
  const header = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]
  if (normalized.startsWith('---\n') && header === undefined) throw new Error('SKILL.md frontmatter is not terminated')
  const document = parseDocument(header ?? '', { uniqueKeys: true, schema: 'core' })
  if (document.errors.length) throw new Error(`Invalid SKILL.md metadata: ${document.errors[0]!.message}`)
  const fields = frontmatterSchema.parse(document.toJS({ maxAliasCount: 32 }) ?? {})
  return fields
}
