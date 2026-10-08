import type { JsonValue } from './json.ts'

/** Public, bounded failure facts; credentials and request payloads never belong here. */
export interface OperationFailureDetails {
  kind: string
  retryable: boolean
  outcome: 'failed' | 'unknown'
  status?: number
  endpoint?: string
  reason?: JsonValue
}
export class OperationFailure extends Error {
  constructor(message: string, readonly details: OperationFailureDetails, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OperationFailure'
  }
}
