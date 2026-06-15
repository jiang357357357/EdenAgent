import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import { fetchWebPage, formatDuckSearch, searchDuckDuckGo, text, truncate } from "./shared"

function createWebSearchTool(name: string, label: string, description: string): AgentTool {
  return {
    name,
    label,
    description,
    parameters: Type.Object({
      query: Type.String({ description: "搜索关键词。" }),
      max_results: Type.Optional(Type.Number({ description: "最多返回多少条结果，默认 5，最大 10。" })),
      language: Type.Optional(Type.String({ description: "搜索地区/语言，默认 zh-CN。" })),
      time_range: Type.Optional(Type.String({ description: "时间范围，例如 day、week、month、year。" })),
      safesearch: Type.Optional(Type.Number({ description: "安全搜索等级，0 关闭，1 中等，2 严格。" })),
    }),
    async execute(_toolCallID, rawInput, signal) {
      const input = rawInput as {
        query: string
        max_results?: number
        language?: string
        time_range?: string
        safesearch?: number
      }
      const maxResults = Math.min(Math.max(Math.round(input.max_results ?? 5), 1), 10)
      const result = await searchDuckDuckGo({
        query: input.query,
        maxResults,
        language: input.language,
        timeRange: input.time_range,
        safeSearch: input.safesearch,
        signal,
      })
      const body = truncate(formatDuckSearch(input.query, result.results), 20_000)
      return text(body, {
        provider: "duckduckgo",
        endpoint: result.endpoint,
        query: input.query,
        max_results: maxResults,
        results: result.results,
      })
    },
  }
}

export function createWebTools(): AgentTool[] {
  return [
    createWebSearchTool("web_search", "网页搜索", "使用 DuckDuckGo 搜索实时网页信息，不需要本地搜索服务。"),
    {
      name: "web_fetch",
      label: "网页抓取",
      description: "直接抓取网页并提取正文文本。",
      parameters: Type.Object({
        url: Type.String({ description: "要抓取的网页 URL。" }),
        max_chars: Type.Optional(Type.Number({ description: "最多返回多少字符，默认 28000。" })),
      }),
      async execute(_toolCallID, rawInput, signal) {
        const input = rawInput as { url: string; max_chars?: number }
        const maxChars = Math.min(Math.max(Math.round(input.max_chars ?? 28_000), 2_000), 60_000)
        const result = await fetchWebPage(input.url, signal)
        const body = truncate(`${result.title ? `标题: ${result.title}\n\n` : ""}${result.body}`, maxChars)
        return text(body, {
          provider: "direct",
          url: input.url,
          final_url: result.url,
          content_type: result.contentType,
          max_chars: maxChars,
        })
      },
    },
  ]
}
