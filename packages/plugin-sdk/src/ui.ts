import type { ComponentType } from 'react'
import type { JsonValue } from '@eden/api'

export interface PluginUiTool {
  name: string
  status: string
  input: string
  output?: string
  error?: string
}
export interface PluginUiCallOptions { signal?: AbortSignal }
export interface PluginUiOperation {
  id: string
  state: 'starting' | 'waiting' | 'approval' | 'running'
}
export type PluginUiConnectorEvent = { type: 'event'; connectorId: string; eventId: string; eventType: string } | { type: 'resync' }
export interface PluginUiHost {
  readonly sessionId: string | undefined
  readonly signal: AbortSignal
  readSession(): Promise<JsonValue>
  sendMessage(text: string): Promise<JsonValue>
  callTool(name: string, input: Record<string, JsonValue>, options?: PluginUiCallOptions): Promise<JsonValue>
  onConnectorEvent(listener: (event: PluginUiConnectorEvent) => void): () => void
  setDirty?(dirty: boolean): void
  registerSave?(save: () => Promise<void>): () => void
}
export interface PluginUiViewProps { host: PluginUiHost; tool?: PluginUiTool }
export interface PluginUiApi {
  readonly React: typeof import('react')
  readonly signal: AbortSignal
  registerView(id: string, component: ComponentType<PluginUiViewProps>): () => void
  addStyle(css: string): () => void
  effect(setup: () => (() => void)): () => void
}
export interface PluginUiEntrypoint { activate(api: PluginUiApi): void | (() => void) }
