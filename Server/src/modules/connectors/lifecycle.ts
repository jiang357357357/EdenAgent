import { launchNative } from './launch-native.ts'
import type { ConnectorCatalog } from './catalog.ts'
import type { ConnectorRepository } from './repository.ts'
import type { ConnectorPermissions } from './permissions.ts'
import type { ConnectorEventRepository } from './event-repository.ts'
import { launchObserver } from './launch-observer.ts'
import { launchOpenTtd } from './launch-openttd.ts'
import { launchLichess } from './launch-lichess.ts'
import type { ConnectorCredentials } from './credentials.ts'
export class ConnectorLifecycle {
  private readonly abort = new AbortController()
  private readonly active = new Map<string, Awaited<ReturnType<typeof launchObserver>>>()
  private readonly retry = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | undefined
  private task: Promise<void> | undefined
  constructor(private readonly dataRoot: string, private readonly repository: ConnectorRepository, private readonly catalog: ConnectorCatalog,
    private readonly permissions: ConnectorPermissions, private readonly events: ConnectorEventRepository, private readonly credentials: ConnectorCredentials) {}
  async invoke(id: string, generation: string, method: 'query' | 'execute', capability: string, payload: import('@eden/api').JsonValue, operationId: string, signal: AbortSignal) {
    const running = this.active.get(id)
    if (!running || running.generation !== generation) throw new Error('Connector worker is not active for this generation')
    const grants = this.permissions.read(id)
    if (!grants.ready || grants.revision !== running.revision) throw new Error('Connector grants changed before invocation')
    return running.runtime.invoke(method, capability, payload, operationId, signal)
  }
  start() {
    if (this.timer || this.abort.signal.aborted) return
    const tick = () => {
      if (this.task) return
      this.task = this.reconcile().catch(() => { process.stderr.write('Connector lifecycle reconciliation failed\n') }).finally(() => { this.task = undefined })
    }
    this.timer = setInterval(tick, 2000); this.timer.unref(); tick()
  }
  private async reconcile() {
    const connectors = this.repository.list(), present = new Set(connectors.map(item => item.id))
    for (const [id, running] of this.active) if (!present.has(id)) {
      try { await running.runtime.close(); this.active.delete(id); this.retry.delete(id) }
      catch { process.stderr.write('Removed connector termination failed; retaining process ownership\n') }
    }
    for (const connector of connectors) {
      if (this.abort.signal.aborted) return
      try { await this.reconcileConnector(connector) }
      catch {
        const running = this.active.get(connector.id)
        if (running) {
          try { await running.runtime.close(); this.active.delete(connector.id) }
          catch { process.stderr.write('Connector termination failed; retaining process ownership\n') }
        }
        this.retry.set(connector.id, Date.now() + 30000)
        try { this.repository.runtimeState(connector.id, connector.generation, 'error', 'Connector permission, artifact or transport is unavailable') }
        catch { /* The owning configuration may have been removed during termination. */ }
      }
    }
  }
  private async reconcileConnector(connector: ReturnType<ConnectorRepository['read']>) {
    const running = this.active.get(connector.id), grants = this.permissions.read(connector.id)
    if (running && (running.generation !== connector.generation || connector.desiredState !== 'connected' || !grants.ready || grants.revision !== running.revision)) {
      await running.runtime.close(); this.active.delete(connector.id)
    }
    if (this.active.has(connector.id) || connector.desiredState !== 'connected' || (this.retry.get(connector.id) ?? 0) > Date.now() || this.active.size >= 4) return
    if (!grants.ready) throw new Error('Connector permissions are not ready')
    const descriptor = this.catalog.descriptor(connector.connectorKey)
    const launched = descriptor.manifest.id === 'openttd'
      ? await launchOpenTtd(connector.id, this.dataRoot, this.repository, this.catalog, this.permissions, this.events, this.credentials, this.abort.signal)
      : descriptor.manifest.id === 'lichess'
      ? await launchLichess(connector.id, this.dataRoot, this.repository, this.catalog, this.permissions, this.events, this.credentials, this.abort.signal)
      : descriptor.native
      ? await launchNative(connector.id, this.dataRoot, this.repository, this.catalog, this.permissions, this.events, this.abort.signal)
      : await launchObserver(connector.id, this.dataRoot, this.repository, this.catalog, this.permissions, this.events, this.abort.signal)
    this.active.set(connector.id, launched)
    void launched.exited.finally(() => {
      if (this.active.get(connector.id) === launched) {
        this.active.delete(connector.id)
        this.retry.set(connector.id, Date.now() + 30000)
      }
    }).catch(() => { process.stderr.write('Connector exit cleanup failed\n') })
  }
  async close() {
    if (this.timer) clearInterval(this.timer)
    this.abort.abort(); await this.task
    const entries = [...this.active.entries()]
    const results = await Promise.allSettled(entries.map(async ([id, item]) => { await item.runtime.close(); this.active.delete(id) }))
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length) throw new AggregateError(failures, 'Some connector workers did not terminate')
  }
}
