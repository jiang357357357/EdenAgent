import type { DirectorBeat } from '@eden/api'
import { directorBeatSchema } from '@eden/api'
import type { DirectorParticipant } from './roster.ts'
import { actorIdentities } from './roster.ts'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function speaker(item: Record<string, unknown>, identities: Map<string, string | number>) {
  const reference = item.assistantID ?? item.assistantId ?? item.assistant_id ?? item.assistant ?? item.name
  return typeof reference === 'string' || typeof reference === 'number' ? identities.get(String(reference).trim().toLowerCase()) : undefined
}

function addressTo(address: unknown, identities: Map<string, string | number>, previous?: DirectorBeat): string {
  if (address === 'user') return 'user'
  const recipient = typeof address === 'string' && address.startsWith('assistant:') ? identities.get(address.slice(10).toLowerCase()) : undefined
  if (recipient !== undefined) return `assistant:${recipient}`
  return previous ? `assistant:${previous.assistantID}` : 'user'
}

function beatContent(item: Record<string, unknown>, previous: DirectorBeat | undefined) {
  const speech = directorBeatSchema.shape.speechAct.safeParse(item.speechAct ?? item.speech_act)
  const intent = typeof item.intent === 'string' && item.intent.trim() ? item.intent : '自然参与当前对话'
  return { intent: [...intent].slice(0, 160).join(''),
    speechAct: speech.success ? speech.data : previous ? 'react' as const : 'respond' as const }
}

export function normalizeBeats(raw: unknown[], roster: DirectorParticipant[]): DirectorBeat[] {
  const identities = actorIdentities(roster)
  const beats: DirectorBeat[] = []
  const appearances = new Map<string, number>()
  const retained = new Map<number, number>()
  for (const [index, value] of raw.slice(0, 100).entries()) {
    const item = object(value)
    const id = speaker(item, identities)
    if (id === undefined) continue
    const key = String(id)
    if (String(beats.at(-1)?.assistantID) === key || (appearances.get(key) ?? 0) >= 2) continue
    const previous = beats.at(-1)
    const reply = item.replyToBeat ?? item.reply_to_beat
    const replyToBeat = typeof reply === 'number' && reply < index ? retained.get(reply) : undefined
    retained.set(index, beats.length)
    beats.push({ assistantID: id, ...beatContent(item, previous),
      addressTo: addressTo(item.addressTo ?? item.address_to, identities, previous),
      ...(replyToBeat === undefined ? {} : { replyToBeat }) })
    appearances.set(key, (appearances.get(key) ?? 0) + 1)
    if (beats.length === 5) break
  }
  return beats
}
