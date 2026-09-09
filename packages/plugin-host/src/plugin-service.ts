import type { EdenDatabase } from '@eden/store'
import type { JsonValue } from '@eden/api'
import { probeSandbox } from '@eden/execution'
import { DraftRepository } from './drafts/draft-repository.ts'
import { buildPlugin } from './builds/build-plugin.ts'
import { testPlugin } from './testing/test-plugin.ts'
import { ReportRepository } from './testing/report-repository.ts'
import { VersionRepository } from './installation/version-repository.ts'
import { ActivationRepository } from './activation/activation-repository.ts'
import { invokePlugin } from './runtime/invoke-plugin.ts'
import { pluginGuide } from './drafts/plugin-guide.ts'

export class PluginService {
  readonly drafts: DraftRepository
  readonly versions: VersionRepository
  readonly activations: ActivationRepository
  private readonly activeCalls = new Map<string, Set<AbortController>>()
  private readonly activeTasks = new Set<Promise<unknown>>()
  private closed = false
  private readonly reports: ReportRepository

  constructor(database: EdenDatabase, protectedRoots: readonly string[] = []) {
    this.drafts = new DraftRepository(database)
    this.versions = new VersionRepository(database)
    this.activations = new ActivationRepository(database, this.versions, protectedRoots)
    this.reports = new ReportRepository(database)
  }

  async validate(id: string, signal?: AbortSignal) { return this.track(id, inner => buildPlugin(this.drafts.read(id), inner), signal) }
  describe() { return pluginGuide() }

  async test(id: string, signal?: AbortSignal, expectedRevision?: string) {
    return this.track(id, async inner => {
      const built = await buildPlugin(this.drafts.read(id), inner)
      if (expectedRevision && built.revision !== expectedRevision) throw new Error('Draft changed after permission request')
      const report = await testPlugin(built, inner)
      this.reports.save(id, report)
      return report
    }, signal)
  }

  async install(id: string, expectedRevision: string, signal?: AbortSignal) {
    const built = await this.validate(id, signal)
    signal?.throwIfAborted()
    if (built.revision !== expectedRevision) throw new Error('Draft changed after testing')
    this.versions.install(built, this.reports.read(id, built.revision))
    return { id, revision: built.revision }
  }

  async activate(id: string, revision: string, readRoot?: string) {
    if (this.activeCalls.get(id)?.size) throw new Error('Plugin has active calls; wait before activating another version')
    return this.track(id, async signal => {
      const sandbox = await probeSandbox()
      signal.throwIfAborted()
      if (!sandbox.available) throw new Error('OS sandbox unavailable; activation refused')
      if ((this.activeCalls.get(id)?.size ?? 0) > 1) throw new Error('Plugin has active calls; activation refused')
      return this.activations.activate(id, revision, readRoot)
    })
  }

  disable(id: string): void {
    this.activations.disable(id)
    for (const controller of this.activeCalls.get(id) ?? []) controller.abort()
  }

  async invoke(id: string, revision: string, input: JsonValue, signal?: AbortSignal): Promise<JsonValue> {
    signal?.throwIfAborted()
    const active = this.activations.list().find(item => item.id === id && item.revision === revision)
    if (!active) throw new Error('Plugin revision is not active')
    const canonical = this.activations.assertScope(id, revision, active.readRoot)
    if (canonical !== active.readRoot) throw new Error('Granted workspace path changed; grant it again')
    return this.track(id, inner => invokePlugin(this.versions.read(id, revision), input, active.readRoot, inner), signal)
  }

  private async track<T>(id: string, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new Error('Plugin host is shutting down')
    signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const calls = this.activeCalls.get(id) ?? new Set<AbortController>()
    this.activeCalls.set(id, calls)
    calls.add(controller)
    const task = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal) })
    this.activeTasks.add(task)
    try { return await task }
    finally {
      signal?.removeEventListener('abort', abort)
      calls.delete(controller)
      this.activeTasks.delete(task)
      if (!calls.size) this.activeCalls.delete(id)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    for (const calls of this.activeCalls.values()) for (const controller of calls) controller.abort()
    await Promise.allSettled(this.activeTasks)
  }
}
