import { parseDocument, stringify } from 'yaml'
import { snapshot } from './snapshot.ts'

/** Keep visible metadata in SKILL.md so exported content and revision identify the same skill. */
export function generatedSkillSnapshot(input: { name: string; description: string; content: string }) {
  const original = snapshot({ 'SKILL.md': Buffer.from(input.content).toString('base64') }, input.name)
  if (original.name !== input.name) throw new Error('Skill name differs from its frontmatter')
  const normalized = input.content.replace(/\r\n?/g, '\n')
  const header = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  // snapshot() has already validated duplicate keys, alias bounds and metadata shape.
  const fields = header ? parseDocument(header[1]!, { uniqueKeys: true, schema: 'core' }).toJS({ maxAliasCount: 32 }) ?? {} : {}
  const content = `---\n${stringify({ ...fields, name: input.name, description: input.description })}---\n${header ? normalized.slice(header[0].length) : normalized}`
  return snapshot({ 'SKILL.md': Buffer.from(content).toString('base64') }, input.name)
}
