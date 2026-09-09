import type { JsonValue } from '@eden/api'
import type { RuntimeModel } from '@eden/runtime-pi'

export function modelDescriptor(model: RuntimeModel) {
  return { id: model.id, provider: model.provider, baseUrl: model.baseUrl, contextWindow: model.contextWindow, maxTokens: model.maxTokens }
}

export function assertModelSnapshot(metadata: JsonValue | undefined, model: RuntimeModel): void {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !Object.hasOwn(metadata, 'model')) return
  const saved = metadata.model
  const current = modelDescriptor(model)
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length !== Object.keys(current).length ||
    Object.entries(current).some(([key, value]) => saved[key] !== value)) throw new Error('Queued input model configuration changed; review and resubmit the input')
}
