/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const MAX_SIZE = 20 * 1024 * 1024 // 20MB

async function encodeImage(path: string): Promise<{ mime: string; base64: string }> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "png"
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
  }
  const file = Bun.file(path)
  if ((await file.arrayBuffer()).byteLength > MAX_SIZE) {
    throw new Error(`Image too large (max ${MAX_SIZE / 1024 / 1024}MB)`)
  }
  return { mime: mimeMap[ext] ?? "image/png", base64: Buffer.from(await file.bytes()).toString("base64") }
}

export default tool({
  description:
    "Analyze image content using vision AI. When a text-only model needs to understand images, it calls this tool which forwards to a vision-capable model (GPT-4V/Claude/Gemini). Supports: describing images, reading text from screenshots, locating UI elements.",
  args: {
    image_path: tool.schema.string().describe("Absolute path to the image file"),
    question: tool.schema.string().describe("What to ask about this image"),
  },
  async execute(args) {
    const { mime, base64 } = await encodeImage(args.image_path)

    const apiKey =
      process.env.VISION_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || ""
    const apiBase =
      process.env.VISION_API_BASE ||
      process.env.OPENAI_BASE_URL ||
      (process.env.ANTHROPIC_API_KEY ? "https://api.anthropic.com" : "https://api.openai.com")

    if (!apiKey) throw new Error("Set VISION_API_KEY or OPENAI_API_KEY or ANTHROPIC_API_KEY")

    const model = process.env.VISION_MODEL || (apiBase.includes("anthropic") ? "claude-sonnet-4-20250514" : "gpt-4o")

    const isAnthropic = apiBase.includes("anthropic")

    if (isAnthropic) {
      const res = await fetch(`${apiBase}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
                { type: "text", text: args.question },
              ],
            },
          ],
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(`Vision API error: ${JSON.stringify(data.error)}`)
      return data.content?.[0]?.text ?? ""
    }

    const res = await fetch(`${apiBase}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
              { type: "text", text: args.question },
            ],
          },
        ],
      }),
    })
    const data = await res.json()
    if (data.error) throw new Error(`Vision API error: ${JSON.stringify(data.error)}`)
    return data.choices?.[0]?.message?.content ?? ""
  },
})
