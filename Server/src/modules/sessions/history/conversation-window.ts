import type { JsonValue } from '@eden/api'
import { publicMessage } from './public-message.ts'

function fitMessage(message: Record<string, JsonValue>, budget: number): JsonValue | undefined {
  if (JSON.stringify(message).length <= budget) return message
  if (typeof message.text !== 'string') return undefined
  const characters = [...message.text]
  const shortened = (count: number) => ({ ...message, text: count ? characters.slice(-count).join('') : '', truncated: true })
  if (JSON.stringify(shortened(0)).length > budget) return undefined
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (JSON.stringify(shortened(middle)).length <= budget) low = middle
    else high = middle - 1
  }
  return shortened(low)
}

export function conversationWindow(payloads: JsonValue[], maxCharacters = 12000): JsonValue[] {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 2) throw new Error('Invalid conversation window size')
  const messages: JsonValue[] = []
  let remaining = maxCharacters - 2
  for (const payload of payloads.slice().reverse()) {
    const message = publicMessage(payload)
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue
    const fitted = fitMessage(message, remaining - (messages.length ? 1 : 0))
    if (!fitted) break
    remaining -= JSON.stringify(fitted).length + (messages.length ? 1 : 0)
    messages.unshift(fitted)
    if (fitted !== message) break
  }
  return messages
}
