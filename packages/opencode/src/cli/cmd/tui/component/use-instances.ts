import { createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import type { Instance, InstanceConfig } from "../../../../../.opencode/tool/lib/config"

function filePath(dir?: string) {
  return dir ? `${dir}/.opencode/instances.json` : ".opencode/instances.json"
}

function empty(): InstanceConfig {
  return { instances: [], chat_active: null, vision_active: null }
}

export function useInstances() {
  const sdk = useSDK()
  const [config, setConfig] = createSignal<InstanceConfig>(empty())
  const path = () => filePath(sdk.directory)

  async function load() {
    try {
      const file = Bun.file(path())
      if (!(await file.exists())) return setConfig(empty())
      const raw = await file.json()
      if (Array.isArray(raw)) {
        // 兼容旧数组格式
        setConfig({ instances: raw, chat_active: null, vision_active: null })
      } else {
        setConfig({
          instances: raw.instances ?? [],
          chat_active: raw.chat_active ?? null,
          vision_active: raw.vision_active ?? null,
        })
      }
    } catch {
      setConfig(empty())
    }
  }

  async function save(next: InstanceConfig) {
    await Bun.write(path(), JSON.stringify(next, null, 2))
    setConfig(next)
  }

  async function addInstance(instance: Instance) {
    const next = config()
    next.instances.push(instance)
    await save(next)
  }

  async function removeInstance(id: string) {
    const next = config()
    next.instances = next.instances.filter((i) => i.id !== id)
    if (next.chat_active === id) next.chat_active = null
    if (next.vision_active === id) next.vision_active = null
    await save(next)
  }

  async function setChatActive(id: string | null) {
    const next = config()
    next.chat_active = id
    await save(next)
  }

  async function setVisionActive(id: string | null) {
    const next = config()
    next.vision_active = id
    await save(next)
  }

  return {
    config,
    load,
    addInstance,
    removeInstance,
    setChatActive,
    setVisionActive,
  }
}
