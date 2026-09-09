import { PermissionModeStore } from './permission-mode.ts'
import { randomUUID } from 'node:crypto'
import type { PermissionMode, JsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { PermissionContext, PermissionRequest, PermissionEventSink } from './contracts.ts'
import { PermissionRepository } from './permission-repository.ts'

interface Waiter { resolve(): void; reject(error: Error): void }

export class PermissionService {
  private readonly pending = new Map<string, Waiter>()
  private readonly modeStore: PermissionModeStore
  private readonly repository: PermissionRepository
  constructor(database: EdenDatabase, events: PermissionEventSink) {
    this.modeStore = new PermissionModeStore(database)
    this.modeStore.read()
    this.repository = new PermissionRepository(database, events)
    for (const request of this.list().filter(item => item.state === 'pending')) {
      this.repository.events.publish(this.repository.finish(request, 'interrupted'))
    }
  }

  async request(context: PermissionContext, capability: string, resource: string, details: JsonValue): Promise<void> {
    await this.requestWithId(context, capability, resource, details)
  }

  async requestWithId(context: PermissionContext, capability: string, resource: string, details: JsonValue): Promise<string> {
    context.signal.throwIfAborted()
    const request: PermissionRequest = { id: randomUUID(), sessionId: context.sessionId, turnId: context.turnId,
      operationId: `${context.turnId}:${context.callId}`, capability, resource, details, state: 'pending', createdAt: Date.now() }
    if (this.modeStore.allows(capability) || this.repository.granted(request)) request.state = 'allowed'
    const event = this.repository.insert(request)
    if (request.state === 'allowed') { this.repository.events.publish(event); return request.id }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        try { this.resolve(request.id, false, 'cancelled') }
        catch (error) { this.pending.delete(request.id); cleanup(); reject(error) }
      }
      const cleanup = () => context.signal.removeEventListener('abort', abort)
      this.pending.set(request.id, {
        resolve: () => { cleanup(); resolve() }, reject: error => { cleanup(); reject(error) },
      })
      context.signal.addEventListener('abort', abort, { once: true })
      this.repository.events.publish(event)
      if (context.signal.aborted && this.pending.has(request.id)) abort()
    })
    return request.id
  }

  mode(): PermissionMode { return this.modeStore.read() }

  setMode(mode: PermissionMode): PermissionMode { return this.modeStore.set(mode) }

  list(sessionId?: string): PermissionRequest[] { return this.repository.list(sessionId) }

  resolve(id: string, allowed: boolean, deniedState = 'denied', persistGrant = false, message: string | null = null): void {
    const request = this.find(id)
    if (request.state !== 'pending') throw new Error('Permission request already resolved')
    if (persistGrant && !allowed) throw new Error('Only an allowed request can create a grant')
    const event = this.repository.finish(request, allowed ? 'allowed' : deniedState, persistGrant, message)
    const waiter = this.pending.get(id)
    this.pending.delete(id)
    if (allowed) waiter?.resolve()
    else waiter?.reject(new Error(`Permission ${deniedState}: ${request.capability}`))
    this.repository.events.publish(event)
  }

  revoke(id: string): void { this.repository.revoke(this.find(id)) }

  private find(id: string): PermissionRequest {
    const request = this.list().find(item => item.id === id)
    if (!request) throw new Error('Permission request not found')
    return request
  }
}
