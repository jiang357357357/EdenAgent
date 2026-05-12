import path from "path"

export interface Instance {
  id: string
  name: string
  model: string
  key: string
  base_url: string
}

export interface InstanceConfig {
  instances: Instance[]
  chat_active: string | null
  vision_active: string | null
}

function configPath(dir: string): string {
  return path.join(dir, ".opencode", "instances.json")
}

function empty(): InstanceConfig {
  return { instances: [], chat_active: null, vision_active: null }
}

export async function loadConfig(dir: string): Promise<InstanceConfig> {
  try {
    const file = Bun.file(configPath(dir))
    if (!(await file.exists())) return empty()
    const raw = await file.json()
    // 兼容旧数组格式
    if (Array.isArray(raw)) return { instances: raw, chat_active: null, vision_active: null }
    return {
      instances: raw.instances ?? [],
      chat_active: raw.chat_active ?? null,
      vision_active: raw.vision_active ?? null,
    }
  } catch {
    return empty()
  }
}

export async function saveConfig(dir: string, config: InstanceConfig): Promise<void> {
  await Bun.write(configPath(dir), JSON.stringify(config, null, 2))
}

export function genId(): string {
  return crypto.randomUUID().slice(0, 8)
}
