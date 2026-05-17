import { Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { PositiveInt, withStatics } from "@opencode-ai/core/schema"

export const Local = Schema.Struct({
  type: Schema.Literal("local").annotate({ description: "Type of MCP server connection" }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Command and arguments to run the MCP server",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to set when running the MCP server",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
})
  .annotate({ identifier: "McpLocalConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Local = Schema.Schema.Type<typeof Local>

export const OAuth = Schema.Struct({
  clientId: Schema.optional(Schema.String).annotate({
    description: "OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted.",
  }),
  clientSecret: Schema.optional(Schema.String).annotate({
    description: "OAuth client secret (if required by the authorization server)",
  }),
  scope: Schema.optional(Schema.String).annotate({ description: "OAuth scopes to request during authorization" }),
  redirectUri: Schema.optional(Schema.String).annotate({
    description: "OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback).",
  }),
})
  .annotate({ identifier: "McpOAuthConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type OAuth = Schema.Schema.Type<typeof OAuth>

export const MonHubDiscovery = Schema.Struct({
  type: Schema.Literal("monhub").annotate({ description: "Resolve the MCP URL from MonHub service discovery" }),
  serviceName: Schema.optional(Schema.String).annotate({
    description: "MonHub service_name to resolve. Defaults to the MCP config key.",
  }),
  serviceType: Schema.optional(Schema.String).annotate({
    description: "MonHub service_type to query. Defaults to mcp_server.",
  }),
  capabilities: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Required MonHub capabilities.",
  }),
  udpPort: Schema.optional(PositiveInt).annotate({
    description: "MonHub UDP discovery/query port. Defaults to 40053.",
  }),
  broadcastAddress: Schema.optional(Schema.String).annotate({
    description: "UDP broadcast address. Defaults to 255.255.255.255.",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Discovery timeout in ms. Defaults to 3000.",
  }),
})
  .annotate({ identifier: "McpMonHubDiscoveryConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type MonHubDiscovery = Schema.Schema.Type<typeof MonHubDiscovery>

export const Remote = Schema.Struct({
  type: Schema.Literal("remote").annotate({ description: "Type of MCP server connection" }),
  url: Schema.String.annotate({ description: "Fallback URL of the remote MCP server" }),
  discovery: Schema.optional(MonHubDiscovery).annotate({
    description: "Optional service discovery configuration for resolving the remote MCP URL.",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Headers to send with the request",
  }),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])).annotate({
    description: "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
})
  .annotate({ identifier: "McpRemoteConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Remote = Schema.Schema.Type<typeof Remote>

export const Info = Schema.Union([Local, Remote])
  .annotate({ discriminator: "type" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigMCP from "./mcp"
