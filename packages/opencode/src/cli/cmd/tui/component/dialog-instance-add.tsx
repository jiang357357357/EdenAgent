import { onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useInstances } from "./use-instances"
import type { Instance } from "./use-instances"

interface Step {
  title: string
  placeholder: string
  desc: string
  key: keyof Instance
  defaultValue?: string
}

const STEPS: Step[] = [
  {
    title: "第 1 步：实例名称",
    placeholder: "例如：我的 OpenAI",
    desc: "给这个 AI 实例起一个容易记住的名字",
    key: "name",
  },
  {
    title: "第 2 步：模型名称",
    placeholder: "例如：gpt-4o",
    desc: "输入模型的完整名称",
    key: "model",
  },
  {
    title: "第 3 步：API 密钥",
    placeholder: "sk-...",
    desc: "API 密钥会保存在本地，仅用于调用视觉模型",
    key: "key",
  },
  {
    title: "第 4 步：API 端点",
    placeholder: "https://api.openai.com",
    desc: "默认使用 OpenAI 端点。Anthropic 请输入 https://api.anthropic.com",
    key: "base_url",
    defaultValue: "https://api.openai.com",
  },
]

function genId(): string {
  return crypto.randomUUID().slice(0, 8)
}

export function DialogInstanceAdd() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()
  const { addInstance } = useInstances()
  const data: Instance = { id: genId(), name: "", model: "", key: "", base_url: "https://api.openai.com" }

  function renderStep(index: number) {
    if (index >= STEPS.length) {
      renderConfirm()
      return
    }

    const step = STEPS[index]
    dialog.replace(() => (
      <DialogPrompt
        title={step.title}
        placeholder={step.placeholder}
        value={step.defaultValue}
        description={() => <text fg={theme.textMuted}>{step.desc}</text>}
        onConfirm={(value) => {
          ;(data as any)[step.key] = value || step.defaultValue || ""
          renderStep(index + 1)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }

  function renderConfirm() {
    dialog.replace(() => (
      <DialogPrompt
        title="确认创建？"
        placeholder="输入 yes 确认"
        description={() => (
          <box gap={0}>
            <text fg={theme.textMuted}>
              名称: <span fg={theme.text}>{data.name}</span>
            </text>
            <text fg={theme.textMuted}>
              模型: <span fg={theme.text}>{data.model}</span>
            </text>
            <text fg={theme.textMuted}>
              端点: <span fg={theme.text}>{data.base_url}</span>
            </text>
            <text fg={theme.textMuted}>
              密钥: <span fg={theme.text}>{data.key.slice(0, 8)}...</span>
            </text>
          </box>
        )}
        onConfirm={(value) => {
          if (value?.toLowerCase() !== "yes") return
          saveAndClose()
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }

  async function saveAndClose() {
    try {
      await addInstance(data)
      toast.show({ message: `已添加实例「${data.name}」`, variant: "info" })
    } catch (err) {
      toast.show({ message: `保存失败: ${String(err)}`, variant: "error" })
    }
    dialog.clear()
  }

  onMount(() => {
    setTimeout(() => renderStep(0), 50)
  })

  return null
}
