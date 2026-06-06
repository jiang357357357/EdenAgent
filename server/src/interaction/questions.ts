import { createID } from "../shared"
import type { EventBus } from "../shared"
import type { PendingQuestion } from "../types"

interface QuestionWaiter {
  request: PendingQuestion
  resolve: (answers: string[][] | undefined) => void
}

export class QuestionBroker {
  private waiters = new Map<string, QuestionWaiter>()

  constructor(private readonly events: EventBus) {}

  list(): PendingQuestion[] {
    return [...this.waiters.values()].map((item) => item.request)
  }

  ask(input: Omit<PendingQuestion, "id">): Promise<string[][] | undefined> {
    const id = createID("que")
    const request: PendingQuestion = {
      ...input,
      id,
    }
    const promise = new Promise<string[][] | undefined>((resolve) => {
      this.waiters.set(id, { request, resolve })
    })
    this.events.emit({ type: "question.asked", properties: request })
    return promise
  }

  reply(requestID: string, answers: string[][]): boolean {
    const waiter = this.waiters.get(requestID)
    if (!waiter) return false
    this.waiters.delete(requestID)
    waiter.resolve(answers)
    this.events.emit({
      type: "question.replied",
      properties: {
        sessionID: waiter.request.sessionID,
        requestID,
        answers,
      },
    })
    return true
  }

  reject(requestID: string): boolean {
    const waiter = this.waiters.get(requestID)
    if (!waiter) return false
    this.waiters.delete(requestID)
    waiter.resolve(undefined)
    this.events.emit({
      type: "question.rejected",
      properties: {
        sessionID: waiter.request.sessionID,
        requestID,
      },
    })
    return true
  }
}
