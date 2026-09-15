/** Report transport causes without exposing request headers, bodies or URL credentials/query. */
export async function monFetch(url: string | URL, options: RequestInit): Promise<Response> {
  try { return await fetch(url, options) }
  catch (error) {
    const target = new URL(url)
    const codes = transportCodes(error)
    const aborted = options.signal?.aborted
    const reason = aborted && options.signal?.reason?.name === 'TimeoutError' ? '请求超时'
      : aborted ? '请求已取消' : '连接失败'
    throw new Error(`Core ${reason}（${codes.join(', ') || 'NETWORK_ERROR'}）：${target.origin}`)
  }
}

function transportCodes(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== 'object' || depth > 4) return []
  const value = error as { code?: unknown; cause?: unknown; errors?: unknown[] }
  const code = typeof value.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.code) ? [value.code] : []
  return [...new Set([...code, ...transportCodes(value.cause, depth + 1),
    ...(Array.isArray(value.errors) ? value.errors.flatMap(item => transportCodes(item, depth + 1)) : [])])]
}
