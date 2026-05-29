import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import * as Prompt from "../effect/prompt"
import { UI } from "../ui"
import { Effect, Option } from "effect"
import { getMoncoreAuthStatus, loginMoncore, logoutMoncore } from "@/integrations/moncore/auth"
import { getMoncoreConfig } from "@/integrations/moncore/config"

const println = (msg: string) => Effect.sync(() => UI.println(msg))

const promptRequired = Effect.fn("Moncore.promptRequired")(function* (label: string, current?: string, secret = false) {
  if (current) return current
  const result = yield* (secret
    ? Prompt.password({ message: label })
    : Prompt.text({ message: label }))
  if (Option.isNone(result) || !String(result.value).trim()) {
    throw new Error(`${label} is required`)
  }
  return String(result.value).trim()
})

const loginEffect = Effect.fn("Moncore.login")(function* (args: {
  baseUrl?: string
  username?: string
  password?: string
}) {
  yield* Prompt.intro("MonCore login")
  const config = getMoncoreConfig()
  const status = yield* Effect.promise(() => getMoncoreAuthStatus())
  const baseUrl = yield* promptRequired("MonCore base URL", args.baseUrl ?? status.baseUrl ?? config.baseUrl)
  const username = yield* promptRequired("Username", args.username ?? status.username)
  const password = yield* promptRequired("Password", args.password, true)
  const spinner = Prompt.spinner()
  yield* spinner.start("Logging in to MonCore...")
  const next = yield* Effect.promise(() => loginMoncore({ baseUrl, username, password }))
  yield* spinner.stop(`Logged in as ${next.username ?? username}`)
  yield* Prompt.outro("Done")
})

const statusEffect = Effect.fn("Moncore.status")(function* () {
  const status = yield* Effect.promise(() => getMoncoreAuthStatus())
  if (!status.authenticated) {
    yield* println("MonCore: not logged in")
    return
  }
  yield* println(`MonCore: logged in as ${status.username}`)
  if (status.baseUrl) yield* println(`Base URL: ${status.baseUrl}`)
  if (status.role) yield* println(`Role: ${status.role}`)
  if (status.expiresAt) yield* println(`Expires at: ${status.expiresAt}`)
})

const logoutEffect = Effect.fn("Moncore.logout")(function* () {
  yield* Effect.promise(() => logoutMoncore())
  yield* Prompt.outro("Logged out from MonCore")
})

export const MoncoreLoginCommand = effectCmd({
  command: "login [baseUrl]",
  describe: false,
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("baseUrl", {
        describe: "MonCore base URL",
        type: "string",
      })
      .option("username", {
        describe: "MonCore username",
        type: "string",
      })
      .option("password", {
        describe: "MonCore password",
        type: "string",
      }),
  handler: Effect.fn("Cli.moncore.login")(function* (args) {
    UI.empty()
    yield* Effect.orDie(loginEffect(args))
  }),
})

export const MoncoreStatusCommand = effectCmd({
  command: "status",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.moncore.status")(function* () {
    UI.empty()
    yield* Effect.orDie(statusEffect())
  }),
})

export const MoncoreLogoutCommand = effectCmd({
  command: "logout",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.moncore.logout")(function* () {
    UI.empty()
    yield* Effect.orDie(logoutEffect())
  }),
})

export const MoncoreCommand = cmd({
  command: "moncore",
  describe: false,
  builder: (yargs) =>
    yargs
      .command({
        ...MoncoreLoginCommand,
        describe: "log in to MonCore",
      })
      .command({
        ...MoncoreStatusCommand,
        describe: "show MonCore login status",
      })
      .command({
        ...MoncoreLogoutCommand,
        describe: "log out from MonCore",
      })
      .demandCommand(),
  async handler() {},
})
