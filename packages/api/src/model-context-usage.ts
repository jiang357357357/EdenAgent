
/** pi usage separates uncached input, cache reads and cache writes. */
export function modelContextUsage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return
  const usage = (payload as Record<string, unknown>).usage
  if (!usage || typeof usage !== 'object') return
  const values = usage as Record<string, unknown>
  const count = (key: string) => typeof values[key] === 'number' && Number.isFinite(values[key]) && values[key] >= 0 ? values[key] as number : undefined
  const input = count('input'), output = count('output')
  if (input === undefined || output === undefined) return
  const read = count('cacheRead'), write = count('cacheWrite')
  const providerInput = input + (read ?? 0) + (write ?? 0)
  return {
    contextTokens: providerInput + output,
    tokenBreakdown: { providerInput, providerOutput: output, contextMeasurement: 'estimated' as const,
      ...(read !== undefined ? { cacheRead: read } : {}),
      ...(read !== undefined && write !== undefined ? { cacheMiss: input + write, cacheHitRate: providerInput ? read / providerInput : 0 } : {}),
    },
  }
}
