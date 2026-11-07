export interface ProcessPolicy {
  entry?: URL
  maxOldSpaceMb?: number
  heartbeatTimeoutMs?: number
  startupTimeoutMs?: number
  abortTimeoutMs?: number
}

function integer(name: string, value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < minimum || number > maximum)
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  return number
}

/** These are child-process budgets; no setting changes tool or OS permissions. */
export function resolveProcessPolicy(policy: ProcessPolicy = {}, env: NodeJS.ProcessEnv = process.env) {
  return {
    maxOldSpaceMb: integer('EDEN_AGENT_RUNTIME_HEAP_MB', policy.maxOldSpaceMb ?? env.EDEN_AGENT_RUNTIME_HEAP_MB, 2048, 64, 16384),
    abortTimeoutMs: integer('EDEN_AGENT_RUNTIME_ABORT_TIMEOUT_MS', policy.abortTimeoutMs ?? env.EDEN_AGENT_RUNTIME_ABORT_TIMEOUT_MS, 10000, 50, 120000),
    heartbeatTimeoutMs: integer('heartbeatTimeoutMs', policy.heartbeatTimeoutMs, 15000, 50, 120000),
    startupTimeoutMs: integer('startupTimeoutMs', policy.startupTimeoutMs, 60000, 50, 300000),
  }
}
