/** Only Core's own media origin may receive its authentication token. */
export async function fetchMonAudio(base: URL, token: string, source: string, signal?: AbortSignal) {
  const url = new URL(source, base)
  if (url.origin !== base.origin || !url.pathname.startsWith('/media/') || url.username || url.password || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) {
    throw new Error('Mon audio URL escaped its configured media origin')
  }
  const response = await fetch(url, { redirect: 'error', headers: { Authorization: `Token ${token}` },
    signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]) })
  const max = 32 * 1024 * 1024
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel(); throw new Error('Mon audio download failed or exceeded its size limit')
  }
  const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!mime.startsWith('audio/')) { await response.body.cancel(); throw new Error('Mon media response is not audio') }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) throw new Error('Mon audio exceeds 32 MiB')
      chunks.push(value)
    }
    if (!size) throw new Error('Mon returned empty audio')
    return { bytes: Buffer.concat(chunks), mime }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
