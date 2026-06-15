import { Buffer } from "node:buffer"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import { imageFromDataUrl, mimeFromPath, resolveReadablePath, type MonToolOptions } from "./shared"

const execFileAsync = promisify(execFile)

async function requireScreenPermission(options: MonToolOptions, input: { toolName: string; toolCallID: string }) {
  const permission = "读取当前屏幕"
  const pattern = "desktop-screenshot"
  if (options.permissions?.isAlwaysAllowed(permission, pattern)) return
  if (!options.permissions || !options.sessionID) {
    throw new Error("读取当前屏幕需要用户授权；当前运行上下文没有可用的授权通道。")
  }

  const messageID = options.getMessageID?.()
  const reply = await options.permissions.ask({
    sessionID: options.sessionID,
    permission,
    patterns: [pattern],
    metadata: {
      action: "截取当前屏幕",
      toolName: input.toolName,
      reason: "模型请求查看当前桌面画面，需要你确认。",
    },
    tool: messageID
      ? {
          messageID,
          callID: input.toolCallID,
        }
      : undefined,
  })

  if (reply === "reject") {
    throw new Error("用户拒绝读取当前屏幕。")
  }
}

async function captureDesktopScreenshot() {
  if (process.platform !== "win32") {
    throw new Error(`当前屏幕截图暂只支持 Windows，当前平台: ${process.platform}`)
  }

  const dir = await mkdtemp(path.join(tmpdir(), "monagent-screen-"))
  const outputPath = path.join(dir, "screen.png")
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
if (-not $screens -or $screens.Length -eq 0) { throw "No screen found" }
$left = ($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum
$top = ($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum
$right = ($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum
$bottom = ($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum
$width = [int]($right - $left)
$height = [int]($bottom - $top)
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
  $bitmap.Save('${outputPath.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
`

  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    const data = Buffer.from(await readFile(outputPath)).toString("base64")
    return { data, source: "当前屏幕截图" }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function analyzeWithVisionConfig(input: {
  options: MonToolOptions
  mimeType: string
  data: string
  question: string
  source: string
  toolCallID: string
}) {
  const config = input.options.visionConfig
  if (!config || config.status !== "active") {
    throw new Error("当前对话模型不支持图片输入，且 Core 没有可用的 active Vision 配置。")
  }
  if (!input.options.coreClient || !input.options.coreToken) {
    throw new Error("当前对话模型不支持图片输入，且运行上下文没有 Core 登录态，无法调用 Core Vision 分析。")
  }

  const result = await input.options.coreClient.analyzeVision(input.options.coreToken, {
    config_id: config.id,
    images: [
      {
        type: "base64",
        source: input.data,
        media_type: input.mimeType,
        ref: input.source,
      },
    ],
    prompt: input.question,
    source: "monagent",
    related_session_id: input.options.sessionID,
    related_message_id: input.options.getMessageID?.(),
    tool_call_id: input.toolCallID,
    metadata: {
      image_source: input.source,
      fallback_reason: "current_model_does_not_support_images",
      current_model_supports_images: false,
    },
    temperature: 0.2,
    max_tokens: 1200,
  })
  if (!result.success) {
    throw new Error(result.error || "Core Vision 分析失败。")
  }

  return {
    content: [
      {
        type: "text" as const,
        text: result.content || result.summary || "",
      },
    ],
    details: {
      source: input.source,
      mimeType: input.mimeType,
      question: input.question,
      vision: {
        run_id: result.id,
        config_id: result.config?.id ?? config.id,
        name: result.config?.name ?? config.vision_name,
        vendor: result.config?.vendor ?? config.vendor,
        model: result.config?.model ?? config.vision_model,
      },
      summary: result.summary,
      usage: result.usage,
    },
  }
}

export function createImageTools(workspaceRoot: string, options: MonToolOptions = {}): AgentTool[] {
  return [
    {
      name: "analyze_image",
      label: "图片分析",
      description: "把本轮附件图片或指定路径图片交给当前视觉模型分析。路径在工作区外时需要用户授权。",
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: "图片路径。可以是工作区相对路径，也可以是绝对路径。" })),
        attachment_index: Type.Optional(Type.Number({ description: "使用本轮上传附件中的第几张图片，序号从 1 开始。" })),
        question: Type.Optional(Type.String({ description: "希望模型重点观察的问题。" })),
      }),
      async execute(toolCallID, rawInput) {
        const input = rawInput as { path?: string; attachment_index?: number; question?: string }
        const question = input.question?.trim() || "请分析这张图片。"

        let mimeType = "image/png"
        let data = ""
        let source = ""

        if (input.path) {
          const filePath = await resolveReadablePath(workspaceRoot, input.path, options, {
            toolName: "analyze_image",
            toolCallID,
            action: "读取图片",
          })
          mimeType = mimeFromPath(filePath)
          if (!mimeType.startsWith("image/")) {
            throw new Error(`不是支持的图片类型: ${filePath}`)
          }
          data = Buffer.from(await readFile(filePath)).toString("base64")
          source = filePath
        } else {
          const files = options.getCurrentFiles?.() ?? []
          const imageFiles = files.filter((file) => file.mime.startsWith("image/"))
          const index = Math.max(Math.round(input.attachment_index ?? 1) - 1, 0)
          const file = imageFiles[index]
          if (!file) {
            throw new Error("本轮消息中没有可分析的图片附件。请先上传图片，或传入 path。")
          }
          const image = imageFromDataUrl(file.url, file.mime)
          if (!image) {
            throw new Error(`图片附件不是 data URL，暂时无法直接交给模型分析: ${file.filename ?? "未命名图片"}`)
          }
          mimeType = image.mimeType
          data = image.data
          source = file.filename ?? `附件图片 ${index + 1}`
        }

        if (options.currentModelSupportsImages === false) {
          return analyzeWithVisionConfig({
            options,
            mimeType,
            data,
            question,
            source,
            toolCallID,
          })
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `请根据图片回答：${question}`,
            },
            {
              type: "image" as const,
              mimeType,
              data,
            },
          ],
          details: {
            source,
            mimeType,
            question,
          },
        }
      },
    },
    {
      name: "analyze_screen",
      label: "屏幕分析",
      description: "经用户授权后截取当前桌面屏幕，并交给当前视觉模型分析。",
      parameters: Type.Object({
        question: Type.Optional(Type.String({ description: "希望模型重点观察的问题。" })),
      }),
      async execute(toolCallID, rawInput) {
        const input = rawInput as { question?: string }
        const question = input.question?.trim() || "请分析当前屏幕。"
        await requireScreenPermission(options, { toolName: "analyze_screen", toolCallID })
        const screenshot = await captureDesktopScreenshot()

        if (options.currentModelSupportsImages === false) {
          return analyzeWithVisionConfig({
            options,
            mimeType: "image/png",
            data: screenshot.data,
            question,
            source: screenshot.source,
            toolCallID,
          })
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `请根据当前屏幕截图回答：${question}`,
            },
            {
              type: "image" as const,
              mimeType: "image/png",
              data: screenshot.data,
            },
          ],
          details: {
            source: screenshot.source,
            mimeType: "image/png",
            question,
          },
        }
      },
    },
  ]
}
