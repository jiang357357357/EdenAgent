import type { ToolOutcome } from './contracts.ts'

export function toolFailureOutcome(error: unknown, signal: AbortSignal): ToolOutcome {
  if (error && typeof error === 'object' && 'toolOutcome' in error) {
    const state = error.toolOutcome
    if (state === 'failed' || state === 'cancelled' || state === 'unknown') return state
  }
  return signal.aborted ? 'unknown' : 'failed'
}
