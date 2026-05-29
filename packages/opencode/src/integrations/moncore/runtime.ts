import { Database } from "@/storage/db"
import { Bus } from "@/bus"
import { Session, type Info as SessionInfo } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionTable } from "@/session/session.sql"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Stream } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { getMoncoreConfig } from "./config"
import { toMoncoreMessageCreate, toMoncoreSessionCreate } from "./mapper"
import { createMessageMap, createSessionMap } from "./sessions"
import type { MoncoreSessionMap } from "./types"

const log = Log.create({ service: "moncore.sync" })

export interface Interface {
  readonly ready: true
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MoncoreSync") {}

function readLocalSession(sessionID: string) {
  const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
  if (!row) return
  return Session.fromRow(row)
}

function shouldSyncSessions() {
  const config = getMoncoreConfig()
  return config.enabled && (config.opencodeSettings?.enable_history_sync ?? true)
}

function shouldSyncMessages() {
  const config = getMoncoreConfig()
  return shouldSyncSessions() && (config.opencodeSettings?.enable_message_persistence ?? true)
}

async function upsertRemoteSession(info: SessionInfo): Promise<MoncoreSessionMap | undefined> {
  if (!shouldSyncSessions()) return

  const config = getMoncoreConfig()

  return createSessionMap(
    toMoncoreSessionCreate({
      sessionID: info.id,
      title: info.title,
      assistantID: config.opencodeSettings?.default_assistant ?? null,
      characterID: config.opencodeSettings?.default_character ?? null,
      sessionPayload: info,
    }),
  )
}

async function upsertRemoteMessage(sessionID: string, messageID: string) {
  if (!shouldSyncMessages()) return

  const session = readLocalSession(sessionID)
  if (!session) {
    log.warn("skipping MonCore message sync because local session was not found", { sessionID, messageID })
    return
  }

  const remoteSession = await upsertRemoteSession(session)
  if (!remoteSession) return

  const message = MessageV2.get({ sessionID, messageID })
  const toolPart = message.parts.find((part): part is MessageV2.ToolPart => part.type === "tool")

  await createMessageMap(
    remoteSession.id,
    toMoncoreMessageCreate({
      messageID: message.info.id,
      parentMessageID: message.info.role === "assistant" ? message.info.parentID : undefined,
      kind: message.info.role,
      messagePayload: message,
      toolCallID: toolPart?.callID,
    }),
  )
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const watch = <D extends { type: string }>(
      def: D,
      fn: (evt: { properties: any }) => Promise<void> | void,
    ) =>
      bus.subscribe(def as never).pipe(
        Stream.runForEach((evt) =>
          Effect.tryPromise({
            try: () => Promise.resolve(fn(evt)),
            catch: (cause) => {
              log.error("MonCore sync subscriber failed", { type: def.type, cause })
            },
          }),
        ),
        Effect.forkScoped,
      )

    yield* watch(Session.Event.Created, (evt) => upsertRemoteSession(evt.properties.info))
    yield* watch(Session.Event.Updated, (evt) => upsertRemoteSession(evt.properties.info))
    yield* watch(MessageV2.Event.Updated, (evt) => upsertRemoteMessage(evt.properties.info.sessionID, evt.properties.info.id))
    yield* watch(MessageV2.Event.PartUpdated, (evt) =>
      upsertRemoteMessage(evt.properties.part.sessionID, evt.properties.part.messageID),
    )

    return Service.of({ ready: true })
  }),
)

export const defaultLayer = layer
