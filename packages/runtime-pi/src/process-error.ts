export class RuntimeProcessError extends Error {
  readonly code = 'EDEN_RUNTIME_PROCESS'
  constructor(message: string, readonly kind: 'crashed' | 'out_of_memory' | 'unresponsive' | 'startup', options?: ErrorOptions) { super(message, options); this.name = 'RuntimeProcessError' }
}

export class RuntimeCancellationError extends Error {
  readonly code = 'EDEN_RUNTIME_CANCELLED'
  constructor(readonly forced = false) {
    super(forced ? 'Runtime cancellation deadline exceeded; execution cancelled' : 'Runtime execution cancelled')
    this.name = 'RuntimeCancellationError'
  }
}

export function isRuntimeCancellation(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'EDEN_RUNTIME_CANCELLED'
}
