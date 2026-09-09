import { z } from 'zod'
import { assistantTargetSchema } from '@eden/api'
import type { AssistantTarget } from '@eden/api'
import type { MonClient } from '@eden/integrations'
import { coreIdSchema, parseCoreAssistant } from './model-schema.ts'

const summarySchema = z.object({ id: coreIdSchema, name: z.string().default(''), is_default: z.boolean().default(false),
  character: z.object({ id: coreIdSchema, name: z.string().default('') }).nullish() })
const normalize = (value: string) => value.replace(/\s/gu, '').toLowerCase()
const bounded = (value: string) => [...value].slice(0, 120).join('')

export async function assistantCatalog(client: MonClient, signal: AbortSignal) {
  const rows = await client.getCollection('/api/assistants/', signal)
  const summaries = rows.map(row => summarySchema.parse(row))
  const unique = new Map<string, typeof summaries[number]>()
  for (const item of summaries) {
    const key = String(item.id)
    if (unique.has(key)) throw new Error('Mon assistant catalogue contains duplicate identities')
    unique.set(key, item)
  }
  return [...unique.values()]
}

export function assistantSummary(value: unknown) {
  const item = summarySchema.parse(value)
  return { id: item.id, name: bounded(item.name || item.character?.name || ''), isDefault: item.is_default,
    character: item.character ? { id: item.character.id, name: bounded(item.character.name) } : null }
}

export async function resolveAssistantTarget(client: MonClient, input: AssistantTarget, signal: AbortSignal) {
  const target = assistantTargetSchema.parse(input)
  let id = target.assistantId
  if (id === undefined) {
    const requested = normalize(target.assistantName!)
    const matches = (await assistantCatalog(client, signal)).filter(item =>
      [item.name, item.character?.name].some(name => name !== undefined && normalize(name) === requested))
    if (!matches.length) throw new Error('Assistant name not found; list assistants and select an assistantId')
    if (matches.length > 1) throw new Error('Assistant name is ambiguous; select an explicit assistantId')
    id = matches[0]!.id
  }
  signal.throwIfAborted()
  const detail = parseCoreAssistant(await client.get(`/api/assistants/${encodeURIComponent(String(id))}/`, signal), id)
  return { summary: assistantSummary(detail), detail }
}
