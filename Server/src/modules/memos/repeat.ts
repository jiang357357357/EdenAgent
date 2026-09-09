/** Calendar recurrence uses UTC; a delivered overdue occurrence advances past now. */
export function nextMemoOccurrence(rule: string, occurrence: number, now: number): number | null {
  const normalized = rule.trim().toUpperCase()
  if (!normalized || normalized === 'NONE') return null
  const aliases: Record<string, string> = { HOURLY: 'HOURLY', DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY', YEARLY: 'YEARLY' }
  const match = /^(?:RRULE:)?FREQ=(HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=([1-9]\d{0,3}))?$/.exec(normalized)
  const frequency = Object.hasOwn(aliases, normalized) ? aliases[normalized]! : match?.[1]
  if (!frequency) throw new Error('Repeat rule requires hourly/daily/weekly/monthly/yearly or FREQ with optional INTERVAL')
  const interval = Number(match?.[2] ?? 1)
  const duration = { HOURLY: 3600000, DAILY: 86400000, WEEKLY: 604800000 }[frequency as 'HOURLY' | 'DAILY' | 'WEEKLY']
  if (duration) return occurrence + Math.max(1, Math.floor((now - occurrence) / (duration * interval)) + 1) * duration * interval
  const source = new Date(occurrence)
  if (!Number.isFinite(source.getTime())) throw new Error('Memo recurrence timestamp is outside the calendar range')
  const months = frequency === 'YEARLY' ? interval * 12 : interval
  const current = new Date(Math.max(now, occurrence))
  const distance = (current.getUTCFullYear() - source.getUTCFullYear()) * 12 + current.getUTCMonth() - source.getUTCMonth()
  let step = Math.max(1, Math.floor(distance / months))
  const candidate = () => {
    const date = new Date(source)
    date.setUTCDate(1)
    date.setUTCMonth(source.getUTCMonth() + step * months)
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(source.getUTCDate(), last))
    return date.getTime()
  }
  let next = candidate()
  while (next <= now) { step++; next = candidate() }
  if (!Number.isSafeInteger(next)) throw new Error('Memo recurrence exceeds supported timestamps')
  return next
}
