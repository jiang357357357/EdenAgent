/** Only failures at a durable boundary carry this marker, including across the private child IPC. */
export class RuntimePersistenceError extends Error {
  readonly code = 'EDEN_RUNTIME_PERSISTENCE'
  constructor(operation: string, cause: unknown) {
    super(`${operation}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'RuntimePersistenceError'
  }
}

export function isRuntimePersistenceFailure(error: unknown): boolean {
  const pending = [error], seen = new Set<unknown>()
  while (pending.length && seen.size < 32) {
    const item = pending.shift()
    if (!item || typeof item !== 'object' || seen.has(item)) continue
    seen.add(item)
    if ('code' in item && item.code === 'EDEN_RUNTIME_PERSISTENCE') return true
    if ('cause' in item) pending.push(item.cause)
    if (item instanceof AggregateError) pending.push(...item.errors)
  }
  return false
}
