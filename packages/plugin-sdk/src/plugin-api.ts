import type { JsonValue } from '@eden/api'

export interface PluginContext { readonly workspaceRoot: string }
export type PluginHandler = (input: JsonValue, context: PluginContext) => Promise<JsonValue> | JsonValue
