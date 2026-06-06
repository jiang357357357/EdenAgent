import type { ApiEvent } from "../types"

type SseController = ReadableStreamDefaultController<string>

export class EventBus {
  private clients = new Set<SseController>()

  emit(event: ApiEvent) {
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const client of [...this.clients]) {
      try {
        client.enqueue(frame)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  stream(signal: AbortSignal) {
    let current: SseController | undefined
    return new ReadableStream<string>({
      start: (controller) => {
        current = controller
        this.clients.add(controller)
        controller.enqueue(`data: ${JSON.stringify({ type: "connected", properties: { time: Date.now() } })}\n\n`)
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(`data: ${JSON.stringify({ type: "heartbeat", properties: { time: Date.now() } })}\n\n`)
          } catch {
            clearInterval(heartbeat)
            this.clients.delete(controller)
          }
        }, 15000)
        signal.addEventListener("abort", () => {
          clearInterval(heartbeat)
          this.clients.delete(controller)
        })
      },
      cancel: () => {
        if (current) this.clients.delete(current)
      },
    })
  }
}
