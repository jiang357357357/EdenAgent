import { z } from 'zod'
import type { CoreEntity } from './model-schema.ts'

const vendorSchema = z.object({ name: z.string().default(''), icon: z.string().default(''), models: z.array(z.string()).default([]) })
export function publicVendors(raw: unknown): Record<string, { name: string; icon: string; models: string[] }> {
  const wrapped = z.object({ vendors: z.unknown().optional() }).passthrough().parse(raw)
  const source = wrapped.vendors ?? wrapped
  const entries = z.record(z.string(), z.unknown()).parse(source)
  return Object.fromEntries(Object.entries(entries).flatMap(([key, value]) => {
    const parsed = vendorSchema.safeParse(value)
    return parsed.success ? [[key, parsed.data]] : []
  }))
}

export function modelOption(entity: CoreEntity, selectedId: string | number | undefined, vendors: ReturnType<typeof publicVendors>) {
  const vendor = vendors[entity.vendor]
  return { id: String(entity.id), aiEntityId: entity.id, label: entity.ai_name || entity.ai_model, name: entity.ai_name,
    provider: entity.vendor, providerName: vendor?.name || entity.vendor, providerIcon: vendor?.icon || entity.vendor,
    supportedModels: vendor?.models ?? [], modelID: entity.ai_model, status: entity.status, isMultimodal: entity.is_multimodal,
    isChoiceDefault: entity.is_choice_default, isVisionDefault: entity.is_vision_default, contextWindow: entity.default_params.context_window,
    selected: selectedId !== undefined && String(entity.id) === String(selectedId) }
}

export function selectEntity(entities: CoreEntity[], preferred: string | number | null | undefined): CoreEntity | undefined {
  const active = entities.filter(entity => entity.status === 'active')
  return active.find(entity => preferred != null && String(entity.id) === String(preferred)) ??
    active.find(entity => entity.is_choice_default) ?? active.find(entity => !entity.is_vision_default) ?? active[0]
}
