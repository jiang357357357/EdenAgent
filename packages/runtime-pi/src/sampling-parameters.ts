import type { RuntimeModel } from './contracts.ts'

export function isDeepSeek(config: RuntimeModel): boolean {
  const host = new URL(config.baseUrl).hostname
  return config.provider.toLowerCase() === 'deepseek' || host === 'deepseek.com' || host.endsWith('.deepseek.com')
}

/** Apply only supported parameters; an explicit per-call temperature wins over the model default. */
export function samplingPayload(payload: unknown, config: RuntimeModel): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const actual = { ...payload } as Record<string, unknown>, sampling = config.sampling
  for (const [name, value] of Object.entries({ temperature: sampling?.temperature, top_p: sampling?.topP,
    presence_penalty: sampling?.presencePenalty, frequency_penalty: sampling?.frequencyPenalty })) {
    if (value !== undefined && actual[name] === undefined) actual[name] = value
  }
  if (isDeepSeek(config)) {
    if (config.reasoning === 'off') delete actual.top_p
    else {
      delete actual.temperature; delete actual.presence_penalty; delete actual.frequency_penalty
      if (typeof actual.top_p === 'number') actual.top_p = Math.max(0.95, actual.top_p)
    }
  }
  return actual
}
