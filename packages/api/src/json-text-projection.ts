import type { JsonValue } from './json.ts'
import { mapTextOutsideMedia } from './media-payload.ts'

export type JsonTextProjector = (text: string, project: (value: JsonValue) => JsonValue, prose: (text: string) => string) => string

/** Project complete JSON containers, including those embedded in host prose, before replacing text. */
export const mapJsonText: JsonTextProjector = (text, project, prose) => {
  const projectProse = (value: string) => mapTextOutsideMedia(value, prose)
  const quoted = jsonString(text)
  if (quoted !== undefined) {
    const next = project(quoted)
    return next === quoted ? text : JSON.stringify(next)
  }
  let result = '', cursor = 0, at = 0
  while (at < text.length) {
    if (text[at] !== '{' && text[at] !== '[') { at++; continue }
    const end = containerEnd(text, at)
    if (end < 0) { at++; continue }
    const fragment = text.slice(at, end)
    let parsed: JsonValue
    try { parsed = JSON.parse(fragment) as JsonValue }
    catch { at++; continue }
    // Projection errors must propagate; they are never a reason to fall back to raw text.
    const next = project(parsed)
    result += projectProse(text.slice(cursor, at))
    result += JSON.stringify(next) === JSON.stringify(parsed) ? fragment : JSON.stringify(next)
    cursor = end
    at = end
  }
  return result + projectProse(text.slice(cursor))
}

function jsonString(text: string): string | undefined {
  if (!text.trimStart().startsWith('"')) return undefined
  try { return JSON.parse(text) as string } catch { return undefined }
}

function containerEnd(text: string, start: number): number {
  const stack: string[] = []
  let quoted = false, escaped = false
  for (let at = start; at < text.length; at++) {
    const char = text[at]!
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return -1
      if (!stack.length) return at + 1
    }
  }
  return -1
}
