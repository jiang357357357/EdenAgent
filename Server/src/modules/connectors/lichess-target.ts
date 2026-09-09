import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export function lichessEndpoint(value: unknown) {
  if (value !== undefined && typeof value !== 'string') throw new Error('Invalid Lichess base URL')
  const resource = value === undefined ? 'https://lichess.org' : value as string
  const url = new URL(resource)
  if (url.username || url.password || url.search || url.hash || !url.hostname) throw new Error('Lichess URL cannot contain credentials, query or fragment')
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && url.port)) throw new Error('Lichess requires HTTPS or an explicit loopback HTTP port')
  return { resource, url }
}
export async function resolveLichessEndpoint(url: URL, signal: AbortSignal) {
  signal.throwIfAborted()
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const result = host === 'localhost' ? { address: '127.0.0.1' } : isIP(host) ? { address: host }
    : await resolveHost(host, AbortSignal.any([signal, AbortSignal.timeout(15000)]))
  signal.throwIfAborted()
  return { address: result.address, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), limit: 32 }
}

function resolveHost(host: string, signal: AbortSignal): Promise<{ address: string }> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Lichess address resolution cancelled or timed out'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    void lookup(host).then(resolve, () => reject(new Error('Lichess address resolution failed')))
      .finally(() => signal.removeEventListener('abort', abort))
  })
}
