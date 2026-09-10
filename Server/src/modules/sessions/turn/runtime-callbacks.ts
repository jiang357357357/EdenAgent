import { chargeSubagentBudget, assertSubagentTool, recordSubagentRequest, recordSubagentResponse } from '../../subagent-execution/index.ts'
import { randomUUID } from 'node:crypto'
import type { RuntimeCallbacks } from '@eden/runtime-pi'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { SessionInput } from '../contracts.ts'
import type { SessionRepository } from '../session-repository.ts'
import { SignalRepository } from '../input/signal-repository.ts'
import { attachmentMessage } from '../../attachments/index.ts'

export interface RuntimeCallbackScope {
  checkpoint?: RuntimeCallbacks['checkpoint']
  actor?: { assistantID: string | number; planID?: string; beatIndex?: number }
  privateNonAssistantMessages?: boolean
  privateUserInput?: boolean
}

function messageNamespace(kind: string, value: Record<string, JsonValue>, scope: RuntimeCallbackScope, consumed: boolean): string {
  const role = messageRole(value)
  if (scope.privateUserInput && kind.startsWith('message_') && role === 'user' && !consumed) return 'handoff.runtime'
  const hidden = scope.privateNonAssistantMessages && kind.startsWith('message_') && role && role !== 'assistant' && !consumed
  return hidden ? 'actor.runtime' : 'agent'
}

function messageRole(value: Record<string, JsonValue>) {
  const message = value.message
  return message && typeof message === 'object' && !Array.isArray(message) ? message.role : undefined
}

export function runtimeCallbacks(repository: SessionRepository, input: SessionInput, scope: RuntimeCallbackScope = {}): RuntimeCallbacks {
  let messageId: string | undefined
  let initialUserEnded = false
  const signals = new SignalRepository(repository.database, repository.events)
  const append = (kind: string, payload: Parameters<RuntimeCallbacks['event']>[1]) => {
    repository.events.append(input.sessionId, input.turnId, kind, scoped(payload))
  }
  const scoped = (payload: JsonValue): JsonValue => scope.actor ? { ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload }), actor: scope.actor } : payload
  return {
    async checkpoint(snapshot) {
      if (scope.checkpoint) await scope.checkpoint(snapshot)
      else repository.saveCheckpoint(snapshot, input.turnId)
    },
    async event(kind, payload) {
      const consumed = kind === 'message_end' && signals.consume(input.sessionId, input.turnId, payload)
      const value: Record<string, JsonValue> = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? { ...payload } : { value: payload }
      if (kind === 'message_start') messageId = randomUUID()
      if (kind.startsWith('message_') && messageId) value.messageId = messageId
      const namespace = messageNamespace(kind, value, scope, consumed)
      const projected = namespace === 'agent' && !initialUserEnded && !consumed && kind.startsWith('message_') ? attachmentMessage(value, input.metadata) : value
      append(`${namespace}.${kind}`, projected)
      if (kind === 'message_end' && messageRole(value) === 'user') initialUserEnded = true
    },
    async request(snapshot) {
      const event = repository.database.transaction(() => {
        const value = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {}
        chargeSubagentBudget(repository.database, input.sessionId, 'model', value.costConfigured === true)
        recordSubagentRequest(repository.database, input.sessionId, input.turnId, snapshot)
        return repository.events.insert(input.sessionId, input.turnId, 'model.request', scoped(snapshot))
      })
      repository.events.publish(event)
    },
    async response(snapshot) {
      const value = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {}
      const message = value.message && typeof value.message === 'object' && !Array.isArray(value.message) ? value.message : {}
      const event = repository.database.transaction(() => {
        recordSubagentResponse(repository.database, input.sessionId, input.turnId, snapshot)
        return repository.events.insert(input.sessionId, input.turnId, 'model.response', scoped({
          requestId: value.requestId ?? null,
          usage: message.usage ?? null, stopReason: message.stopReason ?? null, costConfigured: value.costConfigured === true
        }))
      })
      repository.events.publish(event)
    },
    async beforeTool(name, callId, revision, args) {
      const event = repository.database.transaction(() => {
        assertSubagentTool(repository.database, input.sessionId, name)
        chargeSubagentBudget(repository.database, input.sessionId, 'tool')
        repository.database.connection.prepare('INSERT INTO tool_operations(id,session_id,turn_id,tool_name,revision,state,result_json,created_at,updated_at,request_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(`${input.turnId}:${callId}`, input.sessionId, input.turnId, name, revision, 'running', null, Date.now(), Date.now(), JSON.stringify(toJson(args)))
        return repository.events.insert(input.sessionId, input.turnId, 'operation.started', scoped({ callId, name, revision, args: toJson(args) }))
      })
      repository.events.publish(event)
    },
    async afterTool(callId, result, failed) {
      const event = repository.database.transaction(() => {
        repository.database.connection.prepare('UPDATE tool_operations SET state=?, result_json=?, error_json=?, updated_at=? WHERE id=?')
          .run(failed ? 'failed' : 'completed', JSON.stringify(result), failed ? JSON.stringify(result) : null, Date.now(), `${input.turnId}:${callId}`)
        return repository.events.insert(input.sessionId, input.turnId, 'operation.completed', scoped({ callId, result, failed }))
      })
      repository.events.publish(event)
    },
  }
}
