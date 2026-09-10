import { randomUUID } from 'node:crypto'
import { toJson } from '@eden/api'
import type { JsonValue, AttachmentRef, AttachmentSnapshot } from '@eden/api'
import { createRuntime } from '@eden/runtime-pi'
import type { EdenRuntime, RuntimeModel, RuntimeTool } from '@eden/runtime-pi'
import type { AcceptedInput, SessionInput, SessionTurnExtension, SessionBoundary } from './contracts.ts'
import { SessionRepository } from './session-repository.ts'
import { InputRepository } from './input/input-repository.ts'
import { runtimeCallbacks } from './turn/runtime-callbacks.ts'
import { sessionPrompt } from './turn/session-prompt.ts'
import { SignalRepository } from './input/signal-repository.ts'
import { modelDescriptor, assertModelSnapshot } from './turn/model-snapshot.ts'
import { inputAttachments, type AttachmentService } from '../attachments/index.ts'
import { InputAdmissions } from './input/admissions.ts'
import { InputResubmissionRepository } from './input/resubmission-repository.ts'
import type { MemoryRecall } from '../memories/index.ts'

export class SessionService {
  private readonly inputs: InputRepository
  private readonly signals: SignalRepository
  private readonly turns = new Map<string, string>()
  private readonly tasks = new Map<string, Promise<void>>()
  private readonly runtimes = new Map<string, EdenRuntime>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly stopping = new Set<string>()
  private readonly editing = new Set<string>()
  private readonly boundaryWaiting = new Set<string>()
  private descendantStop: ((sessionId: string) => Promise<void>) | undefined
  private closed = false
  private readonly faults = new Map<string, string>()
  private readonly admissions = new InputAdmissions()

  constructor(readonly repository: SessionRepository, private readonly model: RuntimeModel | ((sessionId: string) => RuntimeModel | undefined) | undefined,
    private readonly tools: (sessionId: string, turnId: string) => RuntimeTool[] = () => [],
    private readonly participantsChanged: (sessionId: string) => void = () => { },
    private readonly extension?: SessionTurnExtension, private readonly boundary?: SessionBoundary,
    private readonly attachments?: AttachmentService, private readonly memoryRecall?: MemoryRecall) {
    this.inputs = new InputRepository(repository.database, repository.events)
    this.signals = new SignalRepository(repository.database, repository.events)
    this.signals.interrupt()
    for (const sessionId of this.inputs.interruptedSessions()) this.stopping.add(sessionId)
    this.inputs.recoverInterrupted()
  }

  resumePending(): void {
    if (this.closed) return
    for (const sessionId of new Set([...this.inputs.pendingSessions(), ...this.boundary?.pendingSessions() ?? []])) {
      if (this.stopping.has(sessionId)) continue
      const participants = this.repository.read(sessionId).participants
      const available = participants.length > 1 ? this.extension?.snapshot(sessionId, participants) : this.resolveModel(sessionId)
      if (available) { this.boundaryWaiting.delete(sessionId); this.wake(sessionId) }
    }
  }

  private resolveModel(sessionId: string): RuntimeModel | undefined { return typeof this.model === 'function' ? this.model(sessionId) : this.model }

  start(sessionId: string, text: string, idempotencyKey: string = randomUUID(), environment?: JsonValue, kind: 'prompt' | 'compact' = 'prompt'): AcceptedInput {
    return this.accept(sessionId, text, idempotencyKey, environment, kind)
  }
  resubmissionPreview(sessionId: string, sourceId: string) {
    const { snapshots: _snapshots, ...source } = new InputResubmissionRepository(this.repository).source(sessionId, sourceId)
    return source
  }
  resubmit(sessionId: string, sourceId: string, fingerprint: string, note: string): Promise<AcceptedInput> {
    const recovery = new InputResubmissionRepository(this.repository)
    const previous = recovery.existing(sessionId, sourceId, fingerprint, note)
    if (previous) return Promise.resolve(previous)
    const source = recovery.source(sessionId, sourceId)
    if (source.fingerprint !== fingerprint) return Promise.reject(new Error('Source input changed; preview again'))
    this.repository.assertContextReady(sessionId)
    const captured = JSON.stringify(this.inputMetadata(sessionId, source.environment))
    return this.admissions.submit(sessionId, async signal => {
      if (source.attachments.length && !this.attachments) throw new Error('Attachment service unavailable')
      const snapshots = source.attachments.length ? await this.attachments!.snapshot(source.attachments) : []
      if (source.snapshots.length && JSON.stringify(snapshots) !== JSON.stringify(source.snapshots)) throw new Error('Original attachment snapshots no longer match')
      signal.throwIfAborted()
      const existing = recovery.existing(sessionId, sourceId, fingerprint, note)
      if (existing) return existing
      if (JSON.stringify(this.inputMetadata(sessionId, source.environment)) !== captured) throw new Error('Current session configuration changed; preview again')
      return this.accept(sessionId, source.text, `resubmit:${sourceId}`, source.environment, source.kind, snapshots,
        accepted => recovery.record(sessionId, sourceId, fingerprint, note, accepted))
    })
  }

  submitJob(sessionId: string, text: string, jobId: string, jobKind: string, onCommit: (input: AcceptedInput) => void): AcceptedInput {
    const metadata = { ...this.inputMetadata(sessionId), job: { id: jobId, kind: jobKind } }
    const accepted = this.inputs.enqueue(sessionId, text, `job:${jobId}`, metadata, 'prompt', undefined, onCommit)
    this.stopping.delete(sessionId)
    this.boundaryWaiting.delete(sessionId)
    this.wake(sessionId)
    return accepted
  }

  startWithAttachments(sessionId: string, text: string, references: readonly AttachmentRef[], idempotencyKey: string = randomUUID(), environment?: JsonValue): Promise<AcceptedInput> {
    const captured = structuredClone(this.inputMetadata(sessionId, environment))
    if (!this.attachments) return Promise.reject(new Error('Attachment service unavailable'))
    const refs = structuredClone(references)
    const savedEnvironment = environment === undefined ? undefined : structuredClone(environment)
    return this.admissions.submit(sessionId, async signal => {
      const snapshots = await this.attachments!.snapshot(refs)
      signal.throwIfAborted()
      if (JSON.stringify(this.inputMetadata(sessionId, savedEnvironment)) !== JSON.stringify(captured)) throw new Error('Session configuration changed during attachment validation; resubmit')
      return this.accept(sessionId, text, idempotencyKey, savedEnvironment, 'prompt', snapshots)
    })
  }

  private inputMetadata(sessionId: string, environment?: JsonValue) {
    if (this.closed) throw new Error('Server is shutting down')
    if (this.editing.has(sessionId)) throw new Error('Session is being closed or deleted')
    if (this.faults.has(sessionId)) throw new Error('Session storage failed; restart after repairing the failure')
    const session = this.repository.read(sessionId)
    if (session.status !== 'active') throw new Error('Session is closed')
    return { participants: session.participants, environment: environment === undefined ? session.environment : environment, ...this.executionSnapshot(sessionId, session.participants) }
  }

  private accept(sessionId: string, text: string, idempotencyKey: string, environment: JsonValue | undefined, kind: 'prompt' | 'compact', attachments: AttachmentSnapshot[] = [], onCommit?: (input: AcceptedInput) => void): AcceptedInput {
    const metadata = { ...this.inputMetadata(sessionId, environment), ...(attachments.length ? { attachments: toJson(attachments) } : {}) }
    const result = this.inputs.enqueue(sessionId, text, idempotencyKey, metadata, kind,
      environment === undefined ? undefined : { participants: metadata.participants, environment }, onCommit)
    this.stopping.delete(sessionId)
    this.boundaryWaiting.delete(sessionId)
    this.wake(sessionId)
    return result
  }

  private executionSnapshot(sessionId: string, participants: JsonValue[]) {
    if (participants.length > 1) {
      const companion = this.extension?.snapshot(sessionId, participants)
      if (!companion) throw new Error('No model configured for all session actors')
      return { companion }
    }
    const model = this.resolveModel(sessionId)
    if (!model) throw new Error('No model configured for this session')
    return { model: modelDescriptor(model) }
  }

  private wake(sessionId: string): void {
    if (this.tasks.has(sessionId)) return
    const task = Promise.resolve().then(() => this.drain(sessionId)).catch(error => {
      const reason = error instanceof Error ? error.message : String(error)
      this.faults.set(sessionId, reason)
      process.stderr.write(`Session ${sessionId} halted: ${reason}\n`)
    }).finally(() => {
      this.tasks.delete(sessionId)
      if (!this.closed && !this.stopping.has(sessionId) && !this.boundaryWaiting.has(sessionId) && !this.faults.has(sessionId) && this.inputs.hasPending(sessionId)) this.wake(sessionId)
    })
    this.tasks.set(sessionId, task)
  }

  private async drain(sessionId: string): Promise<void> {
    while (!this.closed && !this.stopping.has(sessionId)) {
      if (!await this.beforeNextInput(sessionId)) return
      if (this.closed || this.stopping.has(sessionId)) return
      const input = this.inputs.claim(sessionId)
      if (!input) break
      await this.execute(input)
    }
  }

  private async beforeNextInput(sessionId: string): Promise<boolean> {
    if (!this.boundary) return true
    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    try {
      const ready = await this.boundary.run(sessionId, controller.signal)
      if (!ready) this.boundaryWaiting.add(sessionId)
      return ready
    } finally { this.controllers.delete(sessionId) }
  }

  private async execute(input: SessionInput): Promise<void> {
    let reason: string | undefined
    let failure: unknown
    const controller = new AbortController()
    this.controllers.set(input.sessionId, controller)
    try {
      if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) && Object.hasOwn(input.metadata, 'companion')) {
        if (!this.extension) throw new Error('Multi-actor execution is unavailable')
        this.turns.set(input.sessionId, input.turnId)
        await this.extension.execute(input, controller.signal)
      } else reason = await this.executeSingle(input)
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
      if (error !== controller.signal.reason) failure = error
    } finally { this.runtimes.delete(input.sessionId); this.turns.delete(input.sessionId); this.controllers.delete(input.sessionId) }
    this.signals.interrupt(input.turnId)
    this.inputs.finish(input, reason)
    if (failure) throw failure
  }

  private async executeSingle(input: SessionInput): Promise<string | undefined> {
    const model = this.resolveModel(input.sessionId)
    if (!model) throw new Error('No model configured for this session')
    assertModelSnapshot(input.metadata, model)
    const transientInput = Boolean(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) && input.metadata.internalHandoff === true)
    const checkpoint = this.repository.checkpoint(input.sessionId)
    const images = await this.imagesFor(input)
    this.controllers.get(input.sessionId)?.signal.throwIfAborted()
    const runtime = createRuntime({
      sessionId: input.sessionId, systemPrompt: sessionPrompt(input.metadata ?? {}) + (this.memoryRecall?.prompt(input.sessionId, input.turnId, input.text) ?? ''),
      model, tools: this.tools(input.sessionId, input.turnId), refreshTools: () => this.tools(input.sessionId, input.turnId), transientInput,
      callbacks: runtimeCallbacks(this.repository, input, { privateUserInput: transientInput }),
      ...(checkpoint ? { checkpoint } : {}),
    })
    this.runtimes.set(input.sessionId, runtime)
    this.turns.set(input.sessionId, input.turnId)
    const response = input.kind === 'compact' ? await runtime.compact(input.text) : await runtime.prompt(input.text, images)
    const value = typeof response === 'object' && response !== null && !Array.isArray(response) ? response : {}
    return value.stopReason === 'error' || value.stopReason === 'aborted' ? String(value.errorMessage ?? value.stopReason) : undefined
  }

  private async imagesFor(input: SessionInput) {
    const snapshots = inputAttachments(input.metadata)
    if (!snapshots.length) return []
    if (!this.attachments) throw new Error('Attachment service unavailable')
    return this.attachments.images(snapshots)
  }

  setDescendantStop(handler: (sessionId: string) => Promise<void>): void { this.descendantStop = handler }

  async cancel(sessionId: string): Promise<boolean> {
    this.repository.read(sessionId)
    await this.descendantStop?.(sessionId)
    const admissionCancelled = this.admissions.cancel(sessionId)
    if (!this.tasks.has(sessionId)) return admissionCancelled
    this.stopping.add(sessionId)
    this.controllers.get(sessionId)?.abort()
    await this.runtimes.get(sessionId)?.abort()
    return true
  }

  async endSession(sessionId: string, state: 'closed' | 'deleted'): Promise<void> {
    if (this.editing.has(sessionId)) throw new Error('Session mutation already running')
    this.editing.add(sessionId)
    try {
      await this.cancel(sessionId)
      await this.waitForIdle(sessionId)
      this.repository.setStatus(sessionId, state)
    } finally { this.editing.delete(sessionId) }
  }

  async configureWhileIdle<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    this.repository.read(sessionId)
    if (this.closed || this.tasks.has(sessionId) || this.admissions.has(sessionId) || this.editing.has(sessionId)) throw new Error('Wait for the session to become idle before configuration')
    this.editing.add(sessionId)
    try { return await work() }
    finally { this.editing.delete(sessionId) }
  }

  async setParticipants(sessionId: string, participants: JsonValue[]) {
    return this.configureWhileIdle(sessionId, async () => {
      const session = this.repository.setMetadata(sessionId, participants)
      this.participantsChanged(sessionId)
      return session
    })
  }

  async inject(sessionId: string, text: string, kind: 'steer' | 'follow_up'): Promise<AcceptedInput> {
    if (this.closed || this.editing.has(sessionId) || (this.stopping.has(sessionId) && this.tasks.has(sessionId))) throw new Error('Session is closing')
    const runtime = this.runtimes.get(sessionId)
    const turnId = this.turns.get(sessionId)
    if (!turnId) return this.start(sessionId, text)
    const inputId = this.signals.create(sessionId, turnId, kind, text)
    try {
      if (runtime) {
        if (kind === 'steer') await runtime.steer(text)
        else await runtime.followUp(text)
      } else if (!await this.extension?.inject?.(sessionId, text, kind)) {
        this.signals.setState(inputId, 'rejected')
        return this.start(sessionId, text)
      }
      this.signals.setState(inputId, 'injected')
      return { sessionId, turnId, inputId, state: 'queued' }
    } catch (error) { this.signals.setState(inputId, 'rejected'); throw error }
  }

  async waitForIdle(sessionId: string): Promise<void> {
    await this.admissions.wait(sessionId)
    while (this.tasks.has(sessionId)) await this.tasks.get(sessionId)
  }
  isRunning(sessionId: string): boolean { return this.tasks.has(sessionId) }
  runningCount(): number { return this.tasks.size }
  faultCount(): number { return this.faults.size }
  toolCatalog() {
    return this.tools('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000').map(tool => ({
      name: tool.name, label: tool.name, description: tool.description, parameters: tool.parameters,
      source: tool.name.startsWith('plugin_') ? 'plugin' : 'builtin', version: tool.revision,
      namespace: tool.name.startsWith('plugin_') ? 'plugin' : 'eden', executionMode: tool.executionMode ?? 'parallel', exposure: 'direct',
    }))
  }
  async close(): Promise<void> {
    this.closed = true
    const admissions = this.admissions.close()
    for (const controller of this.controllers.values()) controller.abort()
    const aborts = await Promise.allSettled([...this.runtimes.values()].map(runtime => runtime.abort()))
    await Promise.all(this.tasks.values())
    await admissions
    const failures = aborts.filter(result => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Runtime abort reported persistence failures')
  }
}
