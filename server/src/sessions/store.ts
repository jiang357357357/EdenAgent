import type { AgentMessage } from "@earendil-works/pi-agent-core"
import { createID } from "../shared"
import type { ApiMessage, ApiMessageInfo, ApiPart, ApiSession, StoredSession } from "../types"

export class SessionStore {
  private sessions = new Map<string, StoredSession>()

  constructor() {}

  listSessions(limit = 50): ApiSession[] {
    return [...this.sessions.values()]
      .map((session) => session.info)
      .sort((left, right) => right.time.updated - left.time.updated)
      .slice(0, limit)
  }

  createSession(title = ""): ApiSession {
    const now = Date.now()
    const info: ApiSession = {
      id: createID("ses"),
      title: title || "新会话",
      time: {
        created: now,
        updated: now,
      },
    }
    this.sessions.set(info.id, {
      info,
      messages: [],
      agentMessages: [],
    })
    return info
  }

  upsertSessionInfo(info: ApiSession): ApiSession {
    const existing = this.sessions.get(info.id)
    this.sessions.set(info.id, {
      info: {
        ...existing?.info,
        ...info,
        time: {
          ...existing?.info.time,
          ...info.time,
        },
      },
      messages: existing?.messages ?? [],
      agentMessages: existing?.agentMessages ?? [],
    })
    return info
  }

  requireSession(sessionID: string): StoredSession {
    const session = this.sessions.get(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)
    return session
  }

  listMessages(sessionID: string, limit = 100): ApiMessage[] {
    const session = this.requireSession(sessionID)
    return session.messages.slice(-limit)
  }

  hydrateMessages(sessionID: string, messages: ApiMessage[]) {
    const session = this.requireSession(sessionID)
    session.messages = [...messages].sort((left, right) => left.info.time.created - right.info.time.created)
    session.agentMessages = toAgentMessages(messages)
    const latest = messages.reduce((max, message) => Math.max(max, message.info.time.created), 0)
    if (latest) {
      session.info.time.updated = Math.max(session.info.time.updated, latest)
    }
    if (!session.info.title || session.info.title === "新会话") {
      const title = titleFromMessages(session.messages)
      if (title) session.info.title = title
    }
  }

  upsertMessage(sessionID: string, info: ApiMessageInfo): ApiMessage {
    const session = this.requireSession(sessionID)
    let message = session.messages.find((item) => item.info.id === info.id)
    if (!message) {
      message = { info, parts: [] }
      session.messages.push(message)
    } else {
      message.info = {
        ...message.info,
        ...info,
        time: {
          ...message.info.time,
          ...info.time,
        },
      }
    }
    this.touch(session)
    return message
  }

  upsertPart(sessionID: string, part: ApiPart): ApiPart {
    const session = this.requireSession(sessionID)
    const existing = session.messages.find((item) => item.info.id === part.messageID)
    const message = this.upsertMessage(sessionID, {
      id: part.messageID,
      role: existing?.info.role ?? "assistant",
      time: {
        created: existing?.info.time.created ?? Date.now(),
      },
    })
    const index = message.parts.findIndex((item) => item.id === part.id)
    if (index >= 0) {
      message.parts[index] = part
    } else {
      message.parts.push(part)
    }
    return part
  }

  appendUserMessage(sessionID: string, text: string, files: Array<{ url: string; mime: string; filename?: string }>): ApiMessage {
    const now = Date.now()
    const id = createID("msg")
    const parts: ApiPart[] = []
    if (text.trim()) {
      parts.push({
        id: `${id}_text_0`,
        messageID: id,
        sessionID,
        type: "text",
        text,
        time: { start: now, end: now },
      })
    }
    for (const [index, file] of files.entries()) {
      parts.push({
        id: `${id}_file_${index}`,
        messageID: id,
        sessionID,
        type: "file",
        mime: file.mime,
        url: file.url,
        filename: file.filename,
      })
    }
    const message: ApiMessage = {
      info: {
        id,
        role: "user",
        time: {
          created: now,
          completed: now,
        },
      },
      parts,
    }
    const session = this.requireSession(sessionID)
    session.messages.push(message)
    this.touch(session)
    return message
  }

  setAgentMessages(sessionID: string, messages: AgentMessage[]) {
    const session = this.requireSession(sessionID)
    session.agentMessages = messages
    this.touch(session)
  }

  private touch(session: StoredSession) {
    session.info.time.updated = Date.now()
    if (!session.info.title || session.info.title === "新会话") {
      const title = titleFromMessages(session.messages)
      if (title) session.info.title = title
    }
  }
}

function titleFromMessages(messages: ApiMessage[]) {
  const firstUser = messages.find((message) => message.info.role === "user")
  const text = firstUser?.parts.find((part) => part.type === "text")?.text.trim()
  if (!text) return undefined
  return text.length > 24 ? `${text.slice(0, 24)}...` : text
}

function textFromMessage(message: ApiMessage) {
  return message.parts
    .filter((part): part is Extract<ApiPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function toAgentMessages(messages: ApiMessage[]): AgentMessage[] {
  return messages.flatMap((message) => {
    const text = textFromMessage(message)
    if (!text) return []

    if (message.info.role === "user") {
      return [
        {
          role: "user",
          timestamp: message.info.time.created,
          content: [{ type: "text", text }],
        } satisfies AgentMessage,
      ]
    }

    return [
      {
        role: "assistant",
        timestamp: message.info.time.created,
        content: [{ type: "text", text }],
        api: "openai-completions",
        provider: message.info.providerID || "openai",
        model: message.info.modelID || "unknown",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: message.info.error ? "error" : "stop",
        errorMessage: message.info.error?.message,
      } as AgentMessage,
    ]
  })
}
