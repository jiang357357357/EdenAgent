/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "./lib/config"

const MAX_SIZE = 20 * 1024 * 1024 // 20MB

async function encodeImage(filePath: string): Promise<{ mime: string; base64: string }> {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "png"
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
  }
  const file = Bun.file(filePath)
  if ((await file.arrayBuffer()).byteLength > MAX_SIZE) {
    throw new Error(`Image too large (max ${MAX_SIZE / 1024 / 1024}MB)`)
  }
  return { mime: mimeMap[ext] ?? "image/png", base64: Buffer.from(await file.bytes()).toString("base64") }
}

export default tool({
  description:
    "Analyze image content using vision AI. Uses the active vision instance configured via /instance-vision.",
  args: {
    image_path: tool.schema.string().describe("Absolute path to the image file"),
    question: tool.schema.string().describe("What to ask about this image"),
  },
  async execute(args, context) {
    const { mime, base64 } = await encodeImage(args.image_path)

    const config = await loadConfig(context.directory)
    const inst = config.instances.find((i) => i.id === config.vision_active)
    if (!inst) {
      throw new Error("No active vision instance. Run /instance-vision in the TUI to select one.")
    }

    const isAnthropic = inst.base_url.includes("anthropic")

    if (isAnthropic) {
      const res = await fetch(`${inst.base_url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": inst.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: inst.model,
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

    const res = await fetch(`${inst.base_url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${inst.key}`,
      },
      body: JSON.stringify({
        model: inst.model,
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
