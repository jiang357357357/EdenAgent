import { executeContactAction } from './contact-action.ts'
import { desktopReminderCreateSchema, memoCreateSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { PermissionService } from '../permissions/index.ts'
import type { SessionRepository } from '../sessions/index.ts'
import type { MemoRepository } from '../memos/index.ts'
import type { DesktopReminderRepository } from '../notifications/index.ts'
import type { QuestionService } from '../questions/index.ts'
import { SelfAwakeActionRepository } from './action-repository.ts'

type Action = NonNullable<ReturnType<SelfAwakeActionRepository['claim']>>

export class SelfAwakeActions {
  readonly repository: SelfAwakeActionRepository
  private readonly active = new Map<string, { controller: AbortController; task: Promise<void> }>()
  private started = false
  private closed = false
  private error: string | undefined
  constructor(private readonly sessions: SessionRepository, private readonly permissions: PermissionService,
    private readonly memos: MemoRepository, private readonly reminders: DesktopReminderRepository, private readonly questions: QuestionService,
    private readonly contact: (channel: 'email' | 'qq', sessionId: string, input: { requestId: string; title: string; message: string }, signal: AbortSignal) => Promise<JsonValue>) {
    this.repository = new SelfAwakeActionRepository(sessions)
  }
  get fault(): string | undefined { return this.error }
  start(): void { if (this.started || this.closed) return; this.repository.recover(); this.started = true; this.wake() }
  async close(): Promise<void> { this.closed = true; for (const value of this.active.values()) value.controller.abort(); await Promise.all([...this.active.values()].map(value => value.task)) }
  wake(): void {
    if (!this.started || this.closed || this.error) return
    try {
      while (this.active.size < 2) {
        const action = this.repository.claim()
        if (!action) break
        const controller = new AbortController()
        const task = Promise.resolve().then(() => this.execute(action, controller.signal)).then(result => {
          this.repository.finish(action.id, result)
        }, error => {
          this.repository.finish(action.id, null, error instanceof Error ? error.message.slice(0, 4000) : String(error))
        }).catch(error => {
          this.error = error instanceof Error ? error.message : String(error)
          process.stderr.write(`Self-awake action storage failed: ${this.error}\n`)
        }).finally(() => { this.active.delete(action.id); this.wake() })
        this.active.set(action.id, { controller, task })
      }
    } catch (error) { this.error = error instanceof Error ? error.message : String(error) }
  }

  private async execute(action: Action, signal: AbortSignal): Promise<JsonValue> {
    const decision = action.decision, payload = object(decision.action_payload)
    if (decision.action === 'run_safe_check' || decision.action === 'sync_context') {
      signal.throwIfAborted()
      const session = this.sessions.read(action.sessionId)
      if (session.status !== 'active' || session.participants.length > 1 || JSON.stringify(session.participants[0] ?? {}) !== JSON.stringify(action.author)) throw new Error('Self-awake author changed before recording the decision')
      return {
        status: 'requested', action: decision.action, scope: 'local_runtime',
        note: 'Decision marker only. Actual checks or synchronization require corresponding approved tools and their execution receipts.'
      }
    }
    if (['chat_user', 'remind_user', 'ask_user'].includes(decision.action) && !decision.should_interrupt_user) return { status: 'not_requested' }
    if (['chat_user', 'remind_user', 'ask_user'].includes(decision.action)) {
      return executeContactAction(action, decision.action_payload, this.sessions, this.permissions, this.contact, async () => {
        if (decision.action === 'ask_user') return toJson({
          answers: await this.questions.ask(action.sessionId, action.turnId,
            { questions: [{ header: '自醒确认', question: payload.message }] }, signal)
        })
        const reminder = desktopReminderCreateSchema.parse({ title: payload.title ?? '角色消息', message: payload.message })
        return toJson({ reminder: this.reminders.create(action.sessionId, action.turnId, reminder, `self-awake:${action.id}:contact`) })
      }, signal)
    }
    const capability = decision.action === 'create_task' ? 'memo.write' : 'desktop.notify'
    const context = { sessionId: action.sessionId, turnId: action.turnId, callId: `self-awake:${action.id}`, signal }
    await this.permissions.request(context, capability, action.sessionId, toJson({ runId: action.id, action: decision.action, payload, author: action.author }))
    signal.throwIfAborted()
    const session = this.sessions.read(action.sessionId)
    if (session.status !== 'active' || JSON.stringify(session.participants[0] ?? {}) !== JSON.stringify(action.author)) throw new Error('Self-awake author changed during approval')
    if (decision.action === 'create_task') {
      return this.createTask(action, payload)
    }
    throw new Error('Unsupported self-awake action')

  }

  private createTask(action: Action, payload: Record<string, JsonValue>) {

    const due = payload.due_at
    const dueAt = typeof due === 'string' && !/^\d+$/.test(due) ? Date.parse(due) : due ?? null
    return toJson({
      memo: this.memos.create(memoCreateSchema.parse({
        title: payload.title, content: payload.content ?? payload.message ?? '', kind: 'todo',
        dueAt, relatedSessionId: action.sessionId, metadata: { runId: action.id }
      }), `self-awake:${action.id}:create_task`)
    })

  }
}
function object(value: JsonValue): Record<string, JsonValue> { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
