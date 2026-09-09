import type { RuntimeModel } from '@eden/runtime-pi'
import type { RuntimeOrigin } from '@eden/api'
import type { ModelBinding } from './contracts.ts'

export function modelStatus(origin: RuntimeOrigin, model?: RuntimeModel, binding?: ModelBinding) {
  return {
    id: model?.id ?? '', provider: model?.provider ?? '', api: 'openai-completions',
    baseUrl: model?.baseUrl ?? null, contextWindow: model?.contextWindow ?? null, maxTokens: model?.maxTokens ?? null,
    source: origin === 'local' ? 'env' : 'core', aiEntityId: binding?.entityId ?? null,
    label: binding?.label ?? (model ? `${model.provider}/${model.id}` : 'No model configured'), available: Boolean(model),
    error: model ? null : origin === 'local' ? 'Set EDEN_AGENT_MODEL and its provider configuration' : 'Bind a Mon model before starting a conversation',
  }
}
