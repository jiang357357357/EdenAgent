export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  })
}

export function notFoundResponse() {
  return jsonResponse({ error: "Not found" }, 404)
}

export function eventStreamResponse(stream: ReadableStream) {
  return new Response(stream as BodyInit, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    },
  })
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  const text = await request.text()
  if (!text.trim()) return {} as T
  return JSON.parse(text) as T
}

export function stripApiPrefix(url: URL) {
  if (url.pathname === "/api") {
    url.pathname = "/"
  } else if (url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.slice(4)
  }
  return url
}
