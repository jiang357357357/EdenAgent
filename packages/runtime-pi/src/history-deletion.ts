import { isDeepStrictEqual } from 'node:util'
import { toJson } from '@eden/api'
import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
import { parseCheckpoint } from './checkpoint-schema.ts'
import { LEGACY_HISTORY_PREFIX, PUBLIC_HANDOFF_HISTORY_PREFIX } from './model-prompts.ts'
import { legacyContextEntries } from './legacy-context-deletion.ts'
import type { LegacyContextDeletion } from './legacy-context-deletion.ts'
import { compactionProgressType } from './compaction-progress.ts'

export interface RuntimeHistoryDeletion {
  matchesMessage(message: JsonValue, entryId: string): boolean
  projectHistory(history: JsonValue[]): JsonValue[]
  projectUserContent?(content: string): string
  legacyMessages?: LegacyContextDeletion[]
  invalidateSummariesBefore: number
}

/** Retain tree identities, never retain deleted message bodies in a model checkpoint. */
function removed(entry: SessionTreeEntry, deletionKey?: string): SessionTreeEntry {
  return { type: 'custom', customType: 'eden.deleted_context', id: entry.id,
    parentId: entry.parentId, timestamp: entry.timestamp, ...(deletionKey ? { data: { deletionKey } } : {}) }
}

function toolCaller(entry: SessionTreeEntry, entries: Map<string, SessionTreeEntry>): string | undefined {
  if (entry.type !== 'message' || entry.message.role !== 'toolResult') return undefined
  const callId = entry.message.toolCallId
  let parent = entry.parentId
  while (parent !== null) {
    const candidate = entries.get(parent)
    if (!candidate) break
    if (candidate.type === 'message' && candidate.message.role === 'assistant'
      && candidate.message.content.some(part => part.type === 'toolCall' && part.id === callId)) return candidate.id
    parent = candidate.parentId
  }
  return undefined
}

function projectStoredHistory(entry: SessionTreeEntry, options: RuntimeHistoryDeletion): SessionTreeEntry {
  if (entry.type !== 'custom_message' || typeof entry.content !== 'string') return entry
  const prefix = entry.customType === 'eden.public_handoff_history' ? PUBLIC_HANDOFF_HISTORY_PREFIX
    : entry.customType === 'eden.legacy_history' ? LEGACY_HISTORY_PREFIX : undefined
  if (!prefix) return entry
  if (!entry.content.startsWith(prefix)) throw new Error('Stored conversation history has an invalid wrapper')
  const value = JSON.parse(entry.content.slice(prefix.length)) as JsonValue
  if (entry.customType === 'eden.public_handoff_history' && !Array.isArray(value)) throw new Error('Stored handoff history must be an array')
  const projected = options.projectHistory(Array.isArray(value) ? value : [value])
  if (isDeepStrictEqual(projected, Array.isArray(value) ? value : [value])) return entry
  if (!projected.length) return removed(entry)
  return { ...entry, content: prefix + JSON.stringify(Array.isArray(value) ? projected : projected[0]) }
}

function projectUserEntry(entry: SessionTreeEntry, project?: (content: string) => string): SessionTreeEntry {
  if (!project || entry.type !== 'message' || entry.message.role !== 'user') return entry
  const content = entry.message.content
  const next = typeof content === 'string' ? project(content) : content.map(part => (
    part.type === 'text' ? { ...part, text: project(part.text) } : part
  ))
  return isDeepStrictEqual(content, next) ? entry : { ...entry, message: { ...entry.message, content: next } }
}

export function removeCheckpointMessages(checkpoint: RuntimeCheckpoint, options: RuntimeHistoryDeletion): RuntimeCheckpoint {
  const entries = parseCheckpoint(checkpoint, checkpoint.sessionId)
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const legacy = legacyContextEntries(entries, options.legacyMessages ?? [])
  const deleted = new Set(entries.filter(entry => entry.type === 'message' && entry.message.role === 'assistant'
    && (legacy.has(entry.id) || options.matchesMessage(toJson(entry.message), entry.id))).map(entry => entry.id))
  const projected = entries.map(entry => {
    if (deleted.has(entry.id) || deleted.has(toolCaller(entry, byId) ?? '')) return removed(entry, legacy.get(entry.id))
    return projectUserEntry(projectStoredHistory(entry, options), options.projectUserContent)
  })
  const contentChanged = projected.some((entry, index) => entry !== entries[index])
  const next = projected.map(entry => {
    if (entry.type !== 'compaction' && entry.type !== 'branch_summary'
      && !(entry.type === 'custom' && entry.customType === compactionProgressType)) return entry
    const created = Date.parse(entry.timestamp)
    return contentChanged || !Number.isFinite(created) || created <= options.invalidateSummariesBefore ? removed(entry) : entry
  })
  if (next.every((entry, index) => entry === entries[index])) return checkpoint
  const result = { ...checkpoint, entries: next.map(toJson) }
  parseCheckpoint(result, checkpoint.sessionId)
  return result
}
