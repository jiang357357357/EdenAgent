
/** pi usage separates uncached input, cache reads and cache writes. */
export function modelContextUsage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return
  const record = payload as Record<string, unknown>
  const estimate = contextEstimate(record.contextEstimate)
  const usage = record.usage
  if (!usage || typeof usage !== 'object') return
  const values = usage as Record<string, unknown>
  const count = (key: string) => typeof values[key] === 'number' && Number.isFinite(values[key]) && values[key] >= 0 ? values[key] as number : undefined
  const input = count('input'), output = count('output')
  if (input === undefined || output === undefined) return
  const read = count('cacheRead'), write = count('cacheWrite')
  const providerInput = input + (read ?? 0) + (write ?? 0)
  return {
    contextTokens: providerInput + output,
    tokenBreakdown: { ...estimate, providerInput, providerOutput: output, contextMeasurement: 'estimated' as const,
      ...(read !== undefined ? { cacheRead: read } : {}),
      ...(read !== undefined && write !== undefined ? { cacheMiss: input + write, cacheHitRate: providerInput ? read / providerInput : 0 } : {}),
    },
  }
}

function contextEstimate(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>, result: Record<string, number | string> = {}
  for (const key of ['character', 'skills', 'system', 'tools', 'history', 'promptCacheEpoch']) {
    const item = source[key]
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) result[key] = item
  }
  for (const key of ['tokenizer', 'promptCacheFingerprint', 'promptCacheInvalidationReason']) {
    if (typeof source[key] === 'string') result[key] = source[key]
  }
  return result
}
