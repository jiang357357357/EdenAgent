import type { JsonValue, RuntimeCheckpoint } from '@eden/api'

export interface RuntimeTool {
  name: string
  description: string
  revision: string
  parameters: Record<string, JsonValue>
  executionMode?: 'parallel' | 'sequential'
  identity?: string
  source?: 'builtin' | 'plugin' | 'mcp' | 'skill'
  /** Controls model schema/prompt presentation only; registered tools remain executable. */
  exposure?: 'direct' | 'deferred' | 'hidden'
  /** Resolved before accounting; forwarding is one logical invocation. */
  target?(input: Record<string, unknown>): { identity: string; input: Record<string, unknown> } | undefined
  resolveCall?(input: Record<string, unknown>): { tool: RuntimeTool; input: Record<string, unknown> }
  assertCurrent?(): void
  outcome?(result: JsonValue): ToolOutcome
  failureOutcome?(error: unknown): ToolOutcome
  modelResult?(result: JsonValue, input?: Record<string, unknown>): JsonValue
  /** Private host audit view; execution still receives the validated original input. */
  auditInput?(input: Record<string, unknown>): JsonValue
  /** Host-owned discovery instructions included in each model request. */
  promptHint?: string
  /** Changing discovery data is persisted as a runtime-context snapshot, separately from system rules. */
  contextHint?: { kind: 'tools' | 'skills'; content: string }
  resultImages?(result: JsonValue, signal: AbortSignal): Promise<readonly RuntimeImage[]>
  execute(input: Record<string, unknown>, context: { callId: string; signal: AbortSignal; assertCurrent?: () => void }): Promise<JsonValue>
}

export type ToolOutcome = 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface RuntimeModel {
  provider: string
  id: string
  baseUrl: string
  apiKey?: string
  contextWindow: number
  maxTokens: number
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  sampling?: { temperature?: number | undefined; topP?: number | undefined; presencePenalty?: number | undefined; frequencyPenalty?: number | undefined } | undefined
  /** USD per million tokens; absence means cost is unknown, never free. */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export interface RuntimeCallbacks {
  /** Host diagnostics only; never sent to the model or through child IPC. */
  diagnostic?(record: import('./process-diagnostics.ts').RuntimeProcessDiagnostic): void
  /** May return a validated privacy projection to keep the live context consistent with storage. */
  checkpoint(snapshot: RuntimeCheckpoint): Promise<void | RuntimeCheckpoint>
  /** Private IPC hint; already coalesced batches commit before ACK rather than being sampled again. */
  event(kind: string, payload: JsonValue, delivery?: { coalesced: true }): Promise<void>
  request(snapshot: JsonValue): Promise<void>
  response?(snapshot: JsonValue): Promise<void>
  beforeTool?(name: string, callId: string, revision: string, input: Record<string, unknown>): Promise<void>
  afterTool?(callId: string, result: JsonValue, failed: boolean, outcome?: ToolOutcome): Promise<void>
}

export interface RuntimeOptions {
  sessionId: string
  systemPrompt: string
  /** Fixed closing rules appended after all tool hints within the leading system message. */
  systemPromptSuffix?: string
  /** One independent system message at the end of every dialogue request; never stored in chat history. */
  trailingSystemPrompt?: string
  /** Current operational facts; appended durably only when the retained snapshot differs. */
  runtimeContext?: string
  /** References appended to the initiating user input, persisted with that input. */
  inputContext?: string
  /** Immutable reference material for this turn; never persisted as chat history. */
  turnContext?: string
  /** Append-only imported public records, keyed independently of the current speaker. */
  history?: { key: string; text: string; timestamp: string }[]
  contextSources?: JsonValue[]
  model: RuntimeModel
  tools: RuntimeTool[]
  callbacks: RuntimeCallbacks
  refreshTools?(): RuntimeTool[] | Promise<RuntimeTool[]>
  checkpoint?: RuntimeCheckpoint
  maxModelRequests?: number
  toolCallPrefix?: string
  transientInput?: boolean
  modelRetry?: Partial<import('./model-retry.ts').ModelRetryPolicy>
}

export interface EdenRuntime {
  dispose?(): Promise<void>
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
