import type { JsonValue } from '@eden/api'

export interface ModelRetryPolicy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

export const defaultModelRetryPolicy: ModelRetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
}

const nonRetryable = /GoUsageLimitError|FreeUsageLimitError|monthly usage limit|available balance|insufficient_quota|out of budget|quota exceeded|billing|unauthorized|forbidden|invalid api key|context length|context window/i
const retryable = /terminated|fetch failed|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|ECONNRESET|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up|socket connection was closed|timed? out|timeout|stream ended|ended without|rate.?limit|too many requests|\b408\b|\b409\b|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|\b524\b|service.?unavailable|server.?error|internal.?error|provider.?returned.?error/i

export function retryableModelFailure(value: JsonValue): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.stopReason !== 'error' || typeof value.errorMessage !== 'string') return undefined
  const message = value.errorMessage.trim()
  if (!message || nonRetryable.test(message)) return undefined
  return retryable.test(message) ? message : undefined
}

export function modelRetryDelay(policy: ModelRetryPolicy, retry: number): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(1, retry) - 1))
}

export function waitForModelRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new Error('Request aborted')); return }
    const aborted = () => { clearTimeout(timer); reject(signal.reason ?? new Error('Request aborted')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve() }, delayMs)
    signal.addEventListener('abort', aborted, { once: true })
  })
}
