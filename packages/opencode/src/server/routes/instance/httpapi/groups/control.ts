import { Auth } from "@/auth"
import { ProviderID } from "@/provider/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import type { MoncoreAuthStatus } from "@/integrations/moncore/types"

const AuthParams = Schema.Struct({
  providerID: ProviderID,
})

const LogQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
})

export const LogInput = Schema.Struct({
  service: Schema.String.annotate({ description: "Service name for the log entry" }),
  level: Schema.Union([
    Schema.Literal("debug"),
    Schema.Literal("info"),
    Schema.Literal("error"),
    Schema.Literal("warn"),
  ]).annotate({ description: "Log level" }),
  message: Schema.String.annotate({ description: "Log message" }),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Additional metadata for the log entry",
  }),
})

const MoncoreID = Schema.Union([Schema.Number, Schema.String]).annotate({ identifier: "MoncoreID" })

const MoncoreAuthStatusSchema: Schema.Schema<MoncoreAuthStatus> = Schema.Struct({
  authenticated: Schema.Boolean,
  tokenPresent: Schema.Boolean,
  baseUrl: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  userID: Schema.optional(MoncoreID),
  role: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
}).annotate({ identifier: "MoncoreAuthStatus" })

const MoncoreLoginInput = Schema.Struct({
  baseUrl: Schema.String,
  username: Schema.String,
  password: Schema.String,
})

export const ControlPaths = {
  auth: "/auth/:providerID",
  moncoreAuth: "/moncore/auth",
  moncoreLogin: "/moncore/login",
  log: "/log",
} as const

export const ControlApi = HttpApi.make("control").add(
  HttpApiGroup.make("control")
    .add(
      HttpApiEndpoint.put("authSet", ControlPaths.auth, {
        params: AuthParams,
        payload: Auth.Info,
        success: described(Schema.Boolean, "Successfully set authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.set",
          summary: "Set auth credentials",
          description: "Set authentication credentials",
        }),
      ),
      HttpApiEndpoint.delete("authRemove", ControlPaths.auth, {
        params: AuthParams,
        success: described(Schema.Boolean, "Successfully removed authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.remove",
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
        }),
      ),
      HttpApiEndpoint.get("moncoreAuthGet", ControlPaths.moncoreAuth, {
        success: described(MoncoreAuthStatusSchema, "Current MonCore login status"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "moncore.auth.get",
          summary: "Get MonCore auth status",
          description: "Retrieve the locally stored MonCore login state used by opencode.",
        }),
      ),
      HttpApiEndpoint.post("moncoreLogin", ControlPaths.moncoreLogin, {
        payload: MoncoreLoginInput,
        success: described(MoncoreAuthStatusSchema, "MonCore login status after successful login"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "moncore.login",
          summary: "Log in to MonCore",
          description: "Authenticate against MonCore with username and password and persist the resulting token locally.",
        }),
      ),
      HttpApiEndpoint.delete("moncoreAuthDelete", ControlPaths.moncoreAuth, {
        success: described(Schema.Boolean, "Successfully removed MonCore login state"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "moncore.auth.delete",
          summary: "Log out from MonCore",
          description: "Remove the locally stored MonCore token and login state.",
        }),
      ),
      HttpApiEndpoint.post("log", ControlPaths.log, {
        query: LogQuery,
        payload: LogInput,
        success: described(Schema.Boolean, "Log entry written successfully"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "app.log",
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "control", description: "Control plane routes." })),
)
