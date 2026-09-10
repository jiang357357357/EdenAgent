import { z } from 'zod'
import { memoCreateSchema, toJson } from '@eden/api'
import type { JsonValue, MemoInfo } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { PermissionService } from '../permissions/index.ts'
import type { MemoRepository } from './repository.ts'
import { memoToolSchemas as schemas } from './tool-schemas.ts'
import type { MemoToolName } from './tool-schemas.ts'

export function memoTools(repository: MemoRepository, permissions: PermissionService, sessionId: string, turnId: string): RuntimeTool[] {
  return (Object.keys(schemas) as MemoToolName[]).map(name => ({
    name, revision: 'eden.memo.v1', executionMode: 'sequential',
    description: `${name}: manage durable notes, todos and reminders in the current world. Timestamps use milliseconds or ISO dates. Mutations require memo.write approval. A due-list is not proof that a reminder was delivered.`,
    parameters: toJson(z.toJSONSchema(schemas[name], { io: 'input' })) as Record<string, JsonValue>,
    async execute(raw, context) {
      context.signal.throwIfAborted()
      const input = schemas[name].parse(raw)
      if (name === 'list_memos') {
        const value = schemas.list_memos.parse(input)
        return toJson(repository.list(value.limit, value.query))
      }
      if (name === 'list_due_memos') {
        const value = schemas.list_due_memos.parse(input)
        return toJson(repository.due(value.before, value.limit))
      }
      if (name === 'get_next_memo_wake') {
        const value = schemas.get_next_memo_wake.parse(input)
        const memo = repository.next(value.after)
        return toJson({ nextWakeAt: memoWakeAt(memo), memo })
      }
      const previous = 'id' in input ? repository.read(input.id) : undefined
      const dispatch = name === 'dispatch_due_memos' ? schemas.dispatch_due_memos.parse(input) : undefined
      const due = dispatch ? repository.due(dispatch.before, dispatch.limit) : []
      if (!dispatch || dispatch.markDispatched) {
        await permissions.request({ ...context, sessionId, turnId }, 'memo.write', String(previous?.id ?? (dispatch ? 'due' : 'new')),
          toJson({ action: name, input, previous: previous ?? null, ...(dispatch ? { memos: due } : {}) }))
        context.signal.throwIfAborted()
      }
      if (dispatch) {
        return dispatchDueMemos(repository, dispatch, due)
      }
      return toJson(mutate(repository, name, input, previous, sessionId, `${sessionId}:${turnId}:${context.callId}`))
    },
  }))
}

function mutate(repository: MemoRepository, name: MemoToolName, input: unknown, previous: MemoInfo | undefined, sessionId: string, operationKey: string): MemoInfo {
  if (name === 'create_memo' || name === 'create_reminder') {
    const value = schemas.create_memo.parse(input)
    return repository.create(memoCreateSchema.parse({ ...value, relatedSessionId: sessionId, ...(name === 'create_reminder' ? { kind: 'reminder' } : {}) }), operationKey)
  }
  if (!previous) throw new Error('Memo mutation requires an existing memo')
  if (name === 'mark_memo_triggered') return repository.markTriggered([previous])[0]!
  if (name === 'snooze_memo') {
    const value = schemas.snooze_memo.parse(input)
    return repository.update(previous.id, { snoozedUntil: value.until ?? Date.now() + value.minutes! * 60000, status: 'active' }, previous.updatedAt)
  }
  if (name === 'update_memo') return repository.update(previous.id, schemas.update_memo.parse(input).patch, previous.updatedAt)
  return repository.update(previous.id, { status: name === 'complete_memo' ? 'done' : 'archived' }, previous.updatedAt)
}

function dispatchDueMemos(repository: MemoRepository, dispatch: z.output<typeof schemas.dispatch_due_memos>, due: MemoInfo[]) {
  if (dispatch.markDispatched) repository.markTriggered(due)
  const next = repository.next(dispatch.before)
  return toJson({
    memos: due, dispatchedCount: dispatch.markDispatched ? due.length : 0,
    markDispatched: dispatch.markDispatched, nextWakeAt: next?.snoozedUntil ?? next?.remindAt ?? next?.dueAt ?? null, nextMemo: next
  })
}

function memoWakeAt(memo: MemoInfo | null | undefined) { return memo?.snoozedUntil ?? memo?.remindAt ?? memo?.dueAt ?? null }
