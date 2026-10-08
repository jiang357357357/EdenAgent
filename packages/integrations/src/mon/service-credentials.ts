import { acquireMonServiceLease, type MonServiceIdentity } from './service-identity.ts'
import type { MonCredentials } from './credentials.ts'

/** One account-scoped exchange at a time, independent of individual request cancellation. */
export class MonServiceCredentials implements MonCredentials {
  private lease: { token: string; expiresAt: number } | undefined
  private pending: Promise<{ token: string; expiresAt: number }> | undefined
  constructor(private readonly identity: MonServiceIdentity, private readonly lifetime: AbortSignal) {}
  async token(signal?: AbortSignal, rejectedToken?: string): Promise<string> {
    signal?.throwIfAborted(); this.lifetime.throwIfAborted()
    if (this.lease && this.lease.expiresAt > Date.now() + 60000 && this.lease.token !== rejectedToken) return this.lease.token
    if (!this.pending) {
      const pending = acquireMonServiceLease(this.identity, this.lifetime).then(lease => { this.lease = lease; return lease })
      this.pending = pending
      void pending.finally(() => { if (this.pending === pending) this.pending = undefined }).catch(() => {})
    }
    const pending = this.pending
    if (!signal) return (await pending).token
    let cancel: () => void = () => {}
    try {
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => reject(signal.reason)
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel()
      })
      return (await Promise.race([pending, cancelled])).token
    } finally { signal.removeEventListener('abort', cancel) }
  }
}
