import { createMemo, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "../ui/toast"
import { useInstances } from "./use-instances"

export function DialogInstanceVision() {
  const dialog = useDialog()
  const toast = useToast()
  const { config, load, setVisionActive, removeInstance } = useInstances()

  onMount(() => {
    load()
  })

  const options = createMemo(() =>
    config().instances.map((inst) => ({
      title: inst.name,
      value: inst.id,
      description: `${inst.model} — ${inst.base_url}`,
    })),
  )

  async function onSelect(option: { value: string }) {
    const id = option.value
    const current = config().vision_active
    await setVisionActive(id === current ? null : id)
    toast.show({ message: id === current ? "已取消选择" : "已设为活跃视觉模型", variant: "info" })
    dialog.clear()
  }

  async function onDelete(option: { value: string }) {
    await removeInstance(option.value)
    toast.show({ message: "已删除实例", variant: "info" })
    await load()
  }

  return (
    <DialogSelect
      title="选择视觉模型"
      options={options()}
      current={config().vision_active}
      placeholder={options().length > 0 ? "搜索实例..." : ""}
      renderFilter={options().length > 0}
      onSelect={onSelect}
      actions={[
        {
          command: "instance.delete",
          title: "删除",
          onTrigger: onDelete,
        },
      ]}
    />
  )
}
