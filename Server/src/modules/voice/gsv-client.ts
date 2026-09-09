import type { GsvTtsConfig } from '@eden/api'
export async function gsvResponse(config: Pick<GsvTtsConfig, 'serviceUrl' | 'timeoutSeconds'>, pathname: string, signal: AbortSignal, body?: unknown) {
  const response = await fetch(config.serviceUrl + pathname, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutSeconds * 1000)]),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  const max = 32 * 1024 * 1024
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error(`GSV request failed or response too large (HTTP ${response.status})`) }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > max) throw new Error('GSV response exceeds 32 MiB'); chunks.push(item.value) }
  } finally { await reader.cancel(); reader.releaseLock() }
  return { bytes: Buffer.concat(chunks), mime: (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase() }
}
