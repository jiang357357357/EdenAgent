import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20MB
const DEFAULT_TIMEOUT = 60 * 1000

export const Parameters = Schema.Struct({
  image_path: Schema.String.annotate({ description: "图片文件路径" }),
  question: Schema.String.annotate({
    description: "关于这张图片的问题，例如：'描述这张图片的内容' 或 '这个按钮在什么位置？'",
  }),
})

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
  const mime = mimeMap[ext] ?? "image/png"
  const buf = await Bun.file(path).arrayBuffer()
  if (buf.byteLength > MAX_IMAGE_SIZE) throw new Error(`图片过大（限制 ${MAX_IMAGE_SIZE / 1024 / 1024}MB）`)
  return { mime, base64: Buffer.from(buf).toString("base64") }
}

export const VisionTool = Tool.define(
  "vision",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description:
        "用视觉 AI 分析图片内容。当纯文本模型需要理解图像时，通过此工具调用视觉模型（GPT-4V/Claude/Gemini）。支持提问：描述图片、识别文字、定位元素等。",
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "vision",
            patterns: [input.image_path],
            always: ["*"],
            metadata: { question: input.question },
          })

          const exists = yield* fs.exists(input.image_path)
          if (!exists) throw new Error(`文件不存在: ${input.image_path}`)

          const { mime, base64 } = yield* Effect.promise(() => encodeImage(input.image_path))

          const apiKey =
            process.env.VISION_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || ""
          const apiBase =
            process.env.VISION_API_BASE ||
            process.env.OPENAI_BASE_URL ||
            (process.env.ANTHROPIC_API_KEY ? "https://api.anthropic.com" : "https://api.openai.com")

          if (!apiKey) throw new Error("请设置 VISION_API_KEY 或 OPENAI_API_KEY 环境变量")

          const model =
            process.env.VISION_MODEL ||
            (apiBase.includes("anthropic") ? "claude-sonnet-4-20250514" : "gpt-4o")

          const isAnthropic = apiBase.includes("anthropic")

          let body: any
          let endpoint: string
          let headers: Record<string, string>

          if (isAnthropic) {
            endpoint = `${apiBase}/v1/messages`
            headers = {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            }
            body = {
              model,
              max_tokens: 1024,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
                    { type: "text", text: input.question },
                  ],
                },
              ],
            }
          } else {
            endpoint = `${apiBase}/v1/chat/completions`
            headers = {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            }
            body = {
              model,
              max_tokens: 1024,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
                    { type: "text", text: input.question },
                  ],
                },
              ],
            }
          }

          const response = yield* Effect.promise(() =>
            fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json()),
          )

          if (response.error) throw new Error(`Vision API 错误: ${JSON.stringify(response.error)}`)

          const text = isAnthropic
            ? response.content?.[0]?.text ?? ""
            : response.choices?.[0]?.message?.content ?? ""

          return { title: `Vision 分析: ${input.image_path}`, output: text, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)
