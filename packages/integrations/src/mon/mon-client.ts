import { jsonValue, modelEndpointSchema } from '@eden/api'
import type { JsonValue } from '@eden/api'

export class MonHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 401 || status === 403 ? `Mon authentication rejected (${status})` : `Mon request failed (${status})`)
  }
}

export class MonClient {
  private readonly base: URL
  private readonly token: string

  constructor(baseUrl: string, token: string) {
    this.base = new URL(`${modelEndpointSchema.parse(baseUrl).replace(/\/+$/, '')}/`)
    if (!token.trim() || /[\r\n]/.test(token)) throw new Error('Mon authentication token is invalid')
    this.token = token.trim()
  }

  async get(endpoint: string, signal?: AbortSignal): Promise<JsonValue> {
    return this.request('GET', endpoint, undefined, signal)
  }

  async getCollection(endpoint: string, signal?: AbortSignal): Promise<JsonValue[]> {
    const items: JsonValue[] = []
    const visited = new Set<string>()
    let current: URL | undefined = this.endpointUrl(endpoint)
    while (current) {
      if (visited.size >= 100 || visited.has(current.href)) throw new Error('Mon pagination limit or cycle detected')
      visited.add(current.href)
      const page = await this.get(current.href.slice(this.base.href.length), signal)
      if (Array.isArray(page)) { items.push(...page); current = undefined }
      else {
        if (!page || typeof page !== 'object' || !Array.isArray(page.results)) throw new Error('Invalid Mon collection response')
        items.push(...page.results)
        if (page.next == null) current = undefined
        else {
          if (typeof page.next !== 'string') throw new Error('Invalid Mon pagination URL')
          const next: URL = new URL(page.next, current)
          this.assertBase(next)
          current = this.endpointUrl(next.href.slice(this.base.href.length))
        }
      }
      if (items.length > 10000) throw new Error('Mon collection exceeds 10000 entries')
    }
    return items
  }

  /** Caller must own authorization and a durable intent before invoking a mutation. */
  async patch(endpoint: string, body: JsonValue, signal?: AbortSignal): Promise<JsonValue> {
    return this.request('PATCH', endpoint, body, signal)
  }

  private endpointUrl(endpoint: string): URL {
    const pathname = endpoint.split('?')[0]!
    if (!/^\/?api\/[a-zA-Z0-9_/%.-]+$/.test(pathname) || pathname.includes('..') || /%2f|%5c|%2e/i.test(pathname)) throw new Error('Invalid Mon API path')
    const url = new URL(endpoint.replace(/^\//, ''), this.base)
    this.assertBase(url)
    return url
  }

  private assertBase(url: URL): void {
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.username || url.password || url.hash) throw new Error('Mon API path escaped its configured base')
  }

  private async request(method: string, endpoint: string, body?: JsonValue, signal?: AbortSignal): Promise<JsonValue> {
    const response = await fetch(this.endpointUrl(endpoint), {
      method, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
      headers: { Authorization: `Token ${this.token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new MonHttpError(response.status)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Mon returned an empty response body')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 8 * 1024 * 1024) throw new Error('Mon response exceeds 8 MiB')
        chunks.push(value)
      }
      return jsonValue.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
}
