import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { LEGACY_HISTORY_PREFIX, PUBLIC_HANDOFF_HISTORY_PREFIX } from './model-prompts.ts'

/** Only host-authored history containers are decoded; arbitrary user/provider strings stay opaque. */
export function mapHistoryContent(content: string, project: (value: JsonValue) => JsonValue): string {
  const prefix = [LEGACY_HISTORY_PREFIX, PUBLIC_HANDOFF_HISTORY_PREFIX].find(value => content.startsWith(value))
  if (!prefix) return content
  return prefix + JSON.stringify(project(toJson(JSON.parse(content.slice(prefix.length)))))
}
