import type { ExternalCommandSandbox } from '@eden/execution'
import type { InstalledPackageRepository } from '../plugin-market/index.ts'
import { connectMcpStdio } from './stdio-runtime.ts'
import { connectMcpHttp } from './http-runtime.ts'
import { McpToolCatalog } from './tool-catalog.ts'
type Runtime = Awaited<ReturnType<typeof connectMcpStdio>> | Awaited<ReturnType<typeof connectMcpHttp>>
type Component = ReturnType<InstalledPackageRepository['runtimePlan']>['runtimes'][number]
export class McpLifecycle {
  readonly catalog = new McpToolCatalog()
  private readonly abort = new AbortController()
  private readonly active = new Map<string, Runtime>()
  private readonly errors = new Map<string, string>()
  private readonly retry = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | undefined
  private task: Promise<void> | undefined
  constructor(private readonly packages: InstalledPackageRepository, private readonly external?: ExternalCommandSandbox) { }
  list() {
    return {
      runtimes: [...this.active].map(([id, runtime]) => ({
        id, pluginId: runtime.component.pluginId, componentId: runtime.component.componentId,
        revision: runtime.component.revision, kind: runtime.component.kind,
        server: runtime.server.serverInfo
      })), errors: [...this.errors].map(([id, error]) => ({ id, error }))
    }
  }
  get(id: string, revision?: string) {
    const runtime = this.active.get(id)
    if (!runtime || (revision && runtime.component.revision !== revision)) throw new Error('MCP runtime is not available for this version')
    this.authorize(runtime.component)
    return runtime
  }
  start() {
    if (this.timer || this.abort.signal.aborted) return
    const tick = () => {
      if (this.task) return
      this.task = this.reconcile().catch(() => { process.stderr.write('MCP lifecycle reconciliation failed\n') }).finally(() => { this.task = undefined })
    }
    this.timer = setInterval(tick, 2000); this.timer.unref(); tick()
  }
  private authorize(component: Component) {
    this.abort.signal.throwIfAborted()
    if (!this.packages.runtimeSelections().some(row => row.id === component.pluginId && row.revision === component.revision)) throw new Error('MCP package version is not active')
    const plan = this.packages.runtimePlan(component.pluginId, component.revision)
    if (!plan.runtimes.some(item => item.componentId === component.componentId && item.kind === component.kind)) throw new Error('MCP component is disabled')
  }
  private async reconcile() {
    const selected = this.packages.runtimeSelections()
    for (const id of this.errors.keys()) if (!selected.some(item => id === item.id || id.startsWith(`${item.id}:`))) {
      this.errors.delete(id); this.retry.delete(id)
    }
    for (const [id, runtime] of this.active) {
      try { this.authorize(runtime.component); if (runtime.takeCatalogChange()) await this.refreshCatalog(id, runtime) }
      catch { await runtime.close(); this.active.delete(id); this.catalog.remove(id) }
    }
    for (const selection of selected) {
      if (this.abort.signal.aborted) return
      let plan: ReturnType<InstalledPackageRepository['runtimePlan']>
      try { plan = this.packages.runtimePlan(selection.id, selection.revision); this.errors.delete(selection.id) }
      catch { this.errors.set(selection.id, 'MCP package integrity, descriptor or permission is unavailable'); continue }
      await this.connectComponents(plan)
    }

  }
  private async refreshCatalog(id: string, runtime: Runtime) {
    const definitions = await runtime.client.tools(this.abort.signal)
    this.authorize(runtime.component)
    this.catalog.replace(id, runtime.component.revision, runtime.component.pluginId, runtime.component.componentId, definitions)
  }
  async close() {
    if (this.timer) clearInterval(this.timer)
    this.abort.abort(); await this.task
    await Promise.allSettled([...this.active.values()].map(runtime => runtime.close()))
    for (const id of this.active.keys()) this.catalog.remove(id)
    this.active.clear()
  }

  private async connectComponents(plan: ReturnType<InstalledPackageRepository['runtimePlan']>) {

    for (const component of plan.runtimes) {
      const id = `${component.pluginId}:${component.componentId}`
      if (this.active.has(id) || this.active.size >= 8 || (this.retry.get(id) ?? 0) > Date.now()) continue
      try {
        const authorize = () => this.authorize(component)
        const runtime = component.kind === 'mcp_stdio'
          ? await connectMcpStdio(component, plan.files, authorize, this.abort.signal, this.external)
          : await connectMcpHttp(component, authorize, this.abort.signal)
        try { await this.refreshCatalog(id, runtime); authorize() } catch (error) { this.catalog.remove(id); await runtime.close(); throw error }
        this.active.set(id, runtime); this.errors.delete(id)
        void runtime.exited.finally(() => {
          if (this.active.get(id) === runtime) { this.active.delete(id); this.catalog.remove(id) }
          this.retry.set(id, Date.now() + 15000)
        }).catch(() => { process.stderr.write('MCP runtime exit cleanup failed\n') })
      } catch { this.retry.set(id, Date.now() + 15000); this.errors.set(id, 'MCP initialization failed; check component configuration and permissions') }
    }

  }
}
