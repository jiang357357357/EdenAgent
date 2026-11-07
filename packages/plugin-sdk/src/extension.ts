import type { JsonValue, ExtensionTreeItem } from '@eden/api'

export interface Disposable { dispose(): void }
export interface ExtensionState { value: JsonValue; revision: number }
export interface ExtensionStorage {
  get(key: string): Promise<ExtensionState>
  update(key: string, value: JsonValue, expectedRevision?: number): Promise<ExtensionState>
  remove(key: string, expectedRevision?: number): Promise<ExtensionState>
}
/** Context is bound by the host to one invocation and its application session. */
export interface ExtensionInvocation {
  readonly sessionId?: string
  readonly signal: AbortSignal
  readSession(): Promise<JsonValue>
  sendMessage(text: string): Promise<JsonValue>
  callTool(name: string, input: Record<string, JsonValue>): Promise<JsonValue>
  storage(scope: 'global' | 'workspace'): ExtensionStorage
  configuration(scope: 'global' | 'workspace'): ExtensionStorage
  showMessage(message: string, severity?: 'info' | 'warning' | 'error'): Promise<void>
  showProgress(message: string): Promise<void>
  openView(viewId: string): Promise<void>
  setStatusBarItem(id: string, text: string): Promise<void>
  refreshTree(viewId: string): Promise<void>
  postMessage(message: JsonValue): Promise<void>
}
export interface ExtensionApi {
  readonly signal: AbortSignal
  registerCommand(id: string, handler: (context: ExtensionInvocation, ...args: JsonValue[]) => JsonValue | void | Promise<JsonValue | void>): Disposable
  registerTreeDataProvider(viewId: string, provider: (context: ExtensionInvocation, parentId?: string) => ExtensionTreeItem[] | Promise<ExtensionTreeItem[]>): Disposable
  registerWebviewMessageHandler(viewId: string, handler: (context: ExtensionInvocation, message: JsonValue) => JsonValue | void | Promise<JsonValue | void>): Disposable
  onDidChangeConfiguration(listener: (keys: string[]) => void): Disposable
  log(level: 'info' | 'warn' | 'error', message: string): void
}
export interface ExtensionEntrypoint { activate(api: ExtensionApi): void | Disposable | Promise<void | Disposable> }
export interface ExtensionWebviewApi {
  readonly sessionId?: string
  readonly viewId: string
  request(method: 'command' | 'message', input: Record<string, JsonValue>, options?: { signal?: AbortSignal }): Promise<JsonValue>
  readSession(): Promise<JsonValue>
  callTool(name: string, input: Record<string, JsonValue>, options?: { signal?: AbortSignal }): Promise<JsonValue>
  sendMessage(text: string): Promise<JsonValue>
  getState(): JsonValue
  setState(value: JsonValue): void
  setDirty(dirty: boolean): void
  onDidReceiveMessage(listener: (message: JsonValue) => void): Disposable
  onDidChangeConfiguration(listener: (keys: string[]) => void): Disposable
  /** Event notifications contain metadata only. Resync from read_connector_events after reconnect. */
  onConnectorEvent(listener: (event: { type: 'event'; connectorId: string; eventId: string; eventType: string } | { type: 'resync' }) => void): Disposable
  registerSave(handler: () => Promise<void>): Disposable
  /** Document is authoritative on the host; saves use an optimistic content revision. */
  document?: { path: string; read(): Promise<{ content: string; revision: string }>; save(content: string, revision: string): Promise<{ revision: string }> }
}
