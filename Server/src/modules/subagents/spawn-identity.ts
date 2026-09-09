import { createHash } from 'node:crypto'

/** Fixed field order makes omitted defaults and explicitly supplied defaults equivalent. */
export function spawnRequestHash(sessionId: string, taskName: string, role: string, message: string, maxTurns: number, timeoutMs: number, maxModelRequests = 128, maxToolCalls = 256, maxTokens = 1000000, maxCostMicrousd: number | null = null, actorId?: string | number): string {
  return createHash('sha256').update(JSON.stringify({ sessionId, taskName, role, message, ...(actorId === undefined ? {} : { actorId: String(actorId) }), maxTurns, timeoutMs, ...(maxModelRequests === 128 ? {} : { maxModelRequests }), ...(maxToolCalls === 256 ? {} : { maxToolCalls }), ...(maxTokens === 1000000 ? {} : { maxTokens }), ...(maxCostMicrousd === null ? {} : { maxCostMicrousd }) })).digest('hex')
}
