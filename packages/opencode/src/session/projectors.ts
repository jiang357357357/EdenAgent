import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { SyncEvent } from "@/sync"
import * as Session from "./session"
import { getMoncoreConfig } from "@/integrations/moncore/config"
import {
  createSessionMap,
  updateSessionMap,
  deleteSessionMap,
  createMessageMap,
  updateMessageMap,
  deleteMessageMap,
  getSessionMap,
  listMessageMaps,
} from "@/integrations/moncore"
import { GlobalBus } from "@/bus/global"

export function initMoncoreSync() {
  GlobalBus.on("event", (event) => {
    const { payload } = event
    const config = getMoncoreConfig()
    if (!config.enabled) return

    try {
      handleBusEvent(payload)
    } catch (err) {
      console.error("[MonCoreSync] error handling event", err)
    }
  })
}

function handleBusEvent(payload: { type: string; properties: Record<string, unknown> }) {
  const { type, properties } = payload

  switch (type) {
    case "session.created": {
      const sessionID = String(properties.sessionID)
      const info = properties.info as Record<string, unknown> | undefined
      if (!info) return
      createSessionMap({
        source: "opencode",
        external_session_id: sessionID,
        title: String(info.title ?? ""),
        session_payload: info as Record<string, unknown>,
        status: "active",
      }).catch((err) => console.error("[MonCoreSync] create session failed", err))
      break
    }

    case "session.updated": {
      const sessionID = String(properties.sessionID)
      const info = properties.info as Record<string, unknown> | undefined
      if (!info) return
      getSessionMap(sessionID).then((existing) => {
        return updateSessionMap(existing.id, {
          title: String(info.title ?? ""),
          session_payload: info as Record<string, unknown>,
        })
      }).catch((err) => console.error("[MonCoreSync] update session failed", err))
      break
    }

    case "session.deleted": {
      const sessionID = String(properties.sessionID)
      getSessionMap(sessionID).then((existing) => {
        return deleteSessionMap(existing.id)
      }).catch(() => {})
      break
    }

    case "message.updated": {
      const sessionID = String(properties.sessionID)
      const info = properties.info as Record<string, unknown> | undefined
      if (!info) return
      createMessageMap(sessionID, {
        external_message_id: String(info.id),
        kind: String(info.role ?? "assistant"),
        message_payload: { info, parts: [] } as Record<string, unknown>,
        external_parent_message_id: info.parentID ? String(info.parentID) : undefined,
        sync_status: "synced",
      }).catch((err) => console.error("[MonCoreSync] create message failed", err))
      break
    }

    case "message.removed": {
      const sessionID = String(properties.sessionID)
      const messageID = String(properties.messageID)
      listMessageMaps(sessionID).then((messages) => {
        const found = messages.find((m) => m.external_message_id === messageID)
        if (found) return deleteMessageMap(sessionID, found.id)
      }).catch(() => {})
      break
    }

    case "message.part.updated": {
      const sessionID = String(properties.sessionID)
      const part = properties.part as Record<string, unknown> | undefined
      if (!part) return
      const messageID = String(part.messageID)
      listMessageMaps(sessionID).then((messages) => {
        const found = messages.find((m) => m.external_message_id === messageID)
        if (!found) return null
        const payload = (found.message_payload ?? {}) as Record<string, unknown>
        const parts = (payload.parts ?? []) as Array<Record<string, unknown>>
        const existingIdx = parts.findIndex((p) => p.id === part.id)
        if (existingIdx >= 0) {
          parts[existingIdx] = part as Record<string, unknown>
        } else {
          parts.push(part as Record<string, unknown>)
        }
        payload.parts = parts
        return updateMessageMap(sessionID, found.id, { message_payload: payload })
      }).catch((err) => console.error("[MonCoreSync] part update failed", err))
      break
    }

    case "message.part.removed": {
      const sessionID = String(properties.sessionID)
      const messageID = String(properties.messageID)
      const partID = String(properties.partID)
      listMessageMaps(sessionID).then((messages) => {
        const found = messages.find((m) => m.external_message_id === messageID)
        if (!found) return null
        const payload = (found.message_payload ?? {}) as Record<string, unknown>
        const parts = ((payload.parts ?? []) as Array<Record<string, unknown>>).filter((p) => p.id !== partID)
        payload.parts = parts
        return updateMessageMap(sessionID, found.id, { message_payload: payload })
      }).catch((err) => console.error("[MonCoreSync] part remove failed", err))
      break
    }
  }
}

export default [
  SyncEvent.project(Session.Event.Created, (_db, data) => {
    if (data.info.workspaceID) {
      import("@/storage/db").then(({ Database }) => {
        import("drizzle-orm").then(({ eq }) => {
          Database.use((db) => db.update(WorkspaceTable).set({ time_used: Date.now() }).where(eq(WorkspaceTable.id, data.info.workspaceID)).run())
        })
      })
    }
  }),
]
