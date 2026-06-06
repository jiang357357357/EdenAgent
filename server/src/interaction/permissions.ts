import { createID } from "../shared"
import type { EventBus } from "../shared"
import type { PendingPermission, PermissionReply } from "../types"

interface PermissionWaiter {
  request: PendingPermission
  resolve: (reply: PermissionReply) => void
}

type PermissionAskInput = Omit<PendingPermission, "id" | "always"> & {
  always?: string[]
}

export class PermissionBroker {
  private waiters = new Map<string, PermissionWaiter>()
  private alwaysAllowed = new Set<string>()

  constructor(private readonly events: EventBus) {}

  list(): PendingPermission[] {
    return [...this.waiters.values()].map((item) => item.request)
  }

  isAlwaysAllowed(permission: string, pattern: string) {
    return this.alwaysAllowed.has(`${permission}:${pattern}`) || this.alwaysAllowed.has(`${permission}:*`)
  }

  ask(input: PermissionAskInput): Promise<PermissionReply> {
    const id = createID("per")
    const request: PendingPermission = {
      ...input,
      id,
      always: input.always ?? [],
    }
    const promise = new Promise<PermissionReply>((resolve) => {
      this.waiters.set(id, { request, resolve })
    })
    this.events.emit({ type: "permission.asked", properties: request })
    return promise
  }

  reply(requestID: string, reply: PermissionReply, message?: string): boolean {
    const waiter = this.waiters.get(requestID)
    if (!waiter) return false
    this.waiters.delete(requestID)
    if (reply === "always") {
      const rememberedPatterns = waiter.request.always.length ? waiter.request.always : waiter.request.patterns
      for (const pattern of rememberedPatterns) {
        this.alwaysAllowed.add(`${waiter.request.permission}:${pattern}`)
      }
    }
    if (message) {
      waiter.request.metadata.userMessage = message
    }
    waiter.resolve(reply)
    this.events.emit({
      type: "permission.replied",
      properties: {
        sessionID: waiter.request.sessionID,
        requestID,
        reply,
      },
    })
    return true
  }
}
