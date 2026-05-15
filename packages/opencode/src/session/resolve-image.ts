import path from "path"
import { createLogger } from "@opencode-ai/logs"

const visionLog = createLogger("Tool", "vision")

interface Instance {
  id: string
  name: string
  model: string
  key: string
  base_url: string
}

interface InstanceConfig {
  instances: Instance[]
  vision_active: string | null
}

async function loadVisionConfig(dir: string): Promise<InstanceConfig> {
  try {
    const file = Bun.file(path.join(dir, ".opencode", "instances.json"))
    if (!(await file.exists())) return { instances: [], vision_active: null }
    const raw = await file.json()
    if (Array.isArray(raw)) return { instances: raw, vision_active: null }
    return {
      instances: raw.instances ?? [],
      vision_active: raw.vision_active ?? null,
    }
  } catch {
    return { instances: [], vision_active: null }
  }
}

export const DEFAULT_QUESTION = "请详细描述这张图片的内容。包括：画面主体、颜色、布局、人物表情姿态、整体氛围。"

export interface VisionResult {
  ok: boolean
  text: string
  error?: string
  details: {
    endpoint: string
    model: string
    dataSize: number
    durationMs: number
  }
}

export async function resolveImage(opts: {
  url: string
  mime: string
  question?: string
}): Promise<VisionResult> {
  const t0 = Date.now()
  const dir = process.cwd()
  const config = await loadVisionConfig(dir)
  const inst = config.instances.find((i) => i.id === config.vision_active)

  const baseInfo = (endpoint: string, model: string) => ({
    endpoint,
    model,
    dataSize: opts.url.length,
    durationMs: Date.now() - t0,
  })

  if (!inst) {
    return {
      ok: false,
      text: "",
      error: "instances.json 未配置 vision_active 实例，请在 TUI 中使用 /instance-vision 选择视觉模型",
      details: baseInfo("未配置", "未配置"),
    }
  }

  const matches = opts.url.match(/^data:([^;]+);base64,(.+)$/)
  const base64 = matches?.[2]

  if (!base64) {
    return {
      ok: false,
      text: "",
      error: `data URL 解析失败: url 为 ${opts.url.slice(0, 80)}...，未找到 base64 数据`,
      details: baseInfo(inst.base_url, inst.model),
    }
  }

  const question = opts.question ?? DEFAULT_QUESTION

  visionLog.debug("调用视觉模型: %s @ %s", inst.model, inst.base_url)
  try {
    const apiBase = inst.base_url.replace(/\/+$/, "")

    if (apiBase.includes("anthropic")) {
      const endpoint = apiBase.endsWith("/messages") ? apiBase : `${apiBase}/v1/messages`
      const res = await fetch(endpoint, {
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
                { type: "image", source: { type: "base64", media_type: opts.mime, data: base64 } },
                { type: "text", text: question },
              ],
            },
          ],
        }),
      })
      const data = await res.json()
      if (data.error) {
        return {
          ok: false,
          text: "",
          error: `API 返回错误 (${res.status}): ${JSON.stringify(data.error)}`,
          details: baseInfo(endpoint, inst.model),
        }
      }
      const text = data.content?.[0]?.text ?? ""
      if (!text) {
        return {
          ok: false,
          text: "",
          error: `视觉模型返回空内容 (status=${res.status}, type=${typeof data.content})`,
          details: baseInfo(endpoint, inst.model),
        }
      }
      visionLog.info("视觉分析成功(Anthropic): %d chars, %dms", text.length, Date.now() - t0)
      return { ok: true, text, details: baseInfo(endpoint, inst.model) }
    }

    const text = data.choices?.[0]?.message?.content ?? ""
    if (!text) {
      return {
        ok: false,
        text: "",
        error: `视觉模型返回空内容 (status=${res.status})`,
        details: baseInfo(endpoint, inst.model),
      }
    }
    visionLog.info("视觉分析成功: %d chars, %dms", text.length, Date.now() - t0)
    return { ok: true, text, details: baseInfo(endpoint, inst.model) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    visionLog.error("视觉分析失败: %s", msg)
    // 判断错误类型，给出更具体的提示
    let error = `请求异常: ${msg}`
    if (msg.includes("Failed to parse JSON")) {
      error = `端点返回非 JSON 响应: ${msg}\n请检查 base_url 配置是否正确（应为基础域名，不含 /v1/chat/completions）`
    } else if (msg.includes("fetch failed") || msg.includes("Unable to connect")) {
      error = `网络连接失败: ${msg}\n端点: ${inst.base_url}`
    }
    return {
      ok: false,
      text: "",
      error,
      details: baseInfo(inst.base_url, inst.model),
    }
  }
}
