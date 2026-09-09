import { configuredModelSchema } from '@eden/api'
import type { RuntimeModel } from '@eden/runtime-pi'

export interface ChildModelOptions { actorId?: string | number; model: string | null; reasoning: RuntimeModel['reasoning'] | null }
export function childModel(parent: RuntimeModel, options?: ChildModelOptions): RuntimeModel {
  const model = structuredClone(parent)
  if (options?.model) {
    const slash = options.model.indexOf('/')
    const provider = slash < 0 ? parent.provider : options.model.slice(0, slash)
    const id = slash < 0 ? options.model : options.model.slice(slash + 1)
    if (provider !== parent.provider) throw new Error('Role model cannot reuse credentials across providers; bind the requested provider to the parent first')
    if (id !== model.id) delete model.cost
    model.id = id
  }
  if (options?.reasoning != null) model.reasoning = options.reasoning
  return configuredModelSchema.parse(model)
}
