import type { RuntimeOptions, RuntimeTool } from './contracts.ts'
import { isRuntimePersistenceFailure } from './persistence-error.ts'

export type ToolDescription = Pick<RuntimeTool, 'name' | 'description' | 'revision' | 'parameters' | 'executionMode' | 'promptHint'> & { handle: number }
export type ProcessOptions = Omit<RuntimeOptions, 'tools' | 'callbacks' | 'refreshTools'> & { tools: ToolDescription[]; refresh: boolean }
export type ProcessMessage =
  | { type: 'call'; id: number; method: string; args: unknown[] }
  | { type: 'reply'; id: number; value?: unknown; error?: { message: string; name: string; fatal: boolean; code?: string } }
  | { type: 'heartbeat' }

/** One peer per child. Replies are acknowledged before the runtime advances. */
export class ProcessPeer {
  private nextId = 0
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>()
  private failure: Error | undefined
  constructor(private readonly send: (message: ProcessMessage) => void,
    private readonly dispatch: (method: string, args: unknown[]) => Promise<unknown>,
    private readonly fatal: () => boolean = () => false) {}

  call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
      try { this.send({ type: 'call', id, method, args }) }
      catch (error) { this.pending.delete(id); reject(error) }
    })
  }

  receive(message: ProcessMessage): void {
    if (this.failure || message.type === 'heartbeat') return
    if (message.type === 'reply') {
      const pending = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) pending?.reject(Object.assign(new Error(message.error.message), {
        name: message.error.name, fatal: message.error.fatal, ...(message.error.code ? { code: message.error.code } : {}),
      }))
      else pending?.resolve(message.value)
      return
    }
    void this.dispatch(message.method, message.args).then(value => {
      if (!this.failure) this.send({ type: 'reply', id: message.id, value })
    }, error => {
      if (!this.failure) this.send({ type: 'reply', id: message.id,
        error: { message: error instanceof Error ? error.message : String(error), name: error instanceof Error ? error.constructor.name : 'Error', fatal: this.fatal(),
          ...(isRuntimePersistenceFailure(error) ? { code: 'EDEN_RUNTIME_PERSISTENCE' } : {}) } })
    }).catch(error => this.close(error instanceof Error ? error : new Error(String(error))))
  }

  close(error: Error): void {
    this.failure ??= error
    for (const pending of this.pending.values()) pending.reject(this.failure)
    this.pending.clear()
  }
}
