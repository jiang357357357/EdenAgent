import type { JsonValue, RuntimeCheckpoint } from '@eden/api'

export interface RuntimeTool {
  name: string
  description: string
  revision: string
  parameters: Record<string, JsonValue>
  executionMode?: 'parallel' | 'sequential'
  resultImages?(result: JsonValue, signal: AbortSignal): Promise<readonly RuntimeImage[]>
  execute(input: Record<string, unknown>, context: { callId: string; signal: AbortSignal }): Promise<JsonValue>
}

export interface RuntimeModel {
  provider: string
  id: string
  baseUrl: string
  apiKey?: string
  contextWindow: number
  maxTokens: number
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** USD per million tokens; absence means cost is unknown, never free. */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export interface RuntimeCallbacks {
  checkpoint(snapshot: RuntimeCheckpoint): Promise<void>
  event(kind: string, payload: JsonValue): Promise<void>
  request(snapshot: JsonValue): Promise<void>
  response?(snapshot: JsonValue): Promise<void>
  beforeTool?(name: string, callId: string, revision: string, input: Record<string, unknown>): Promise<void>
  afterTool?(callId: string, result: JsonValue, failed: boolean): Promise<void>
}

export interface RuntimeOptions {
  sessionId: string
  systemPrompt: string
  model: RuntimeModel
  tools: RuntimeTool[]
  callbacks: RuntimeCallbacks
  checkpoint?: RuntimeCheckpoint
  maxModelRequests?: number
  toolCallPrefix?: string
  transientInput?: boolean
}

export interface EdenRuntime {
  prompt(text: string, images?: readonly RuntimeImage[]): Promise<JsonValue>
  steer(text: string, images?: readonly RuntimeImage[]): Promise<void>
  followUp(text: string, images?: readonly RuntimeImage[]): Promise<void>
  abort(): Promise<void>
  waitForIdle(): Promise<void>
  compact(instructions?: string): Promise<JsonValue>
  snapshot(): Promise<RuntimeCheckpoint>
  replaceTools(tools: RuntimeTool[]): Promise<void>
}

export interface RuntimeImage {
  type: 'image'
  data: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
}
