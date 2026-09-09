import type { RuntimeModel } from '@eden/runtime-pi'

export interface ModelBinding { model: RuntimeModel; entityId: string | number; label: string }
export interface ActorModelBinding {
  assistantId: string | number
  characterId: string | number
  main: ModelBinding
  vision?: ModelBinding | undefined
}
