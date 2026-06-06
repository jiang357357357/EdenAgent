export async function proxyToVite(url: URL, vitePort: number) {
  const target = `http://localhost:${vitePort}${url.pathname}${url.search}`
  try {
    return await fetch(target)
  } catch {
    return new Response(`Vite dev server not running on :${vitePort}. Run: bun dev:web`, { status: 503 })
  }
}
