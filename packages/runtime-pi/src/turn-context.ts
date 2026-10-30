import type { AgentMessage } from '@earendil-works/pi-agent-core'

/** Insert after the initiating user message, preserving the tool-loop prefix. */
export class TurnContext {
  private anchor: string | undefined
  private readonly reference: AgentMessage | undefined
  constructor(content: string | undefined) {
    this.reference = content ? { role: 'user', content: [{ type: 'text', text: content }], timestamp: 0 } : undefined
  }

  reset(): void { this.anchor = undefined }

  apply(messages: AgentMessage[]): AgentMessage[] {
    if (!this.reference) return messages
    let index = this.anchor === undefined ? -1 : messages.findLastIndex(message => JSON.stringify(message) === this.anchor)
    if (index < 0) {
      index = messages.findLastIndex(message => message.role === 'user')
      this.anchor = index < 0 ? undefined : JSON.stringify(messages[index])
    }
    return [...messages.slice(0, index + 1), this.reference, ...messages.slice(index + 1)]
  }
}
