import { Auth } from "@/auth"
import { getMoncoreAuthStatus, loginMoncore, logoutMoncore } from "@/integrations/moncore/auth"
import { ProviderID } from "@/provider/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: { params: { providerID: ProviderID } }) {
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      return true
    })

    const moncoreAuthGet = Effect.fn("ControlHttpApi.moncoreAuthGet")(function* () {
      return yield* Effect.promise(() => getMoncoreAuthStatus())
    })

    const moncoreLogin = Effect.fn("ControlHttpApi.moncoreLogin")(function* (ctx: {
      payload: { baseUrl: string; username: string; password: string }
    }) {
      return yield* Effect.promise(() => loginMoncore(ctx.payload))
    })

    const moncoreAuthDelete = Effect.fn("ControlHttpApi.moncoreAuthDelete")(function* () {
      yield* Effect.promise(() => logoutMoncore())
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const logger = Log.create({ service: ctx.payload.service })
      logger[ctx.payload.level](ctx.payload.message, ctx.payload.extra)
      return true
    })

    return handlers
      .handle("authSet", authSet)
      .handle("authRemove", authRemove)
      .handle("moncoreAuthGet", moncoreAuthGet)
      .handle("moncoreLogin", moncoreLogin)
      .handle("moncoreAuthDelete", moncoreAuthDelete)
      .handle("log", log)
  }),
)
