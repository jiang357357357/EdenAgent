import { monServiceIdentity } from './mon-identity.ts'
import type { MonServiceIdentity } from '@eden/integrations'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { z } from 'zod'
import { runtimeOriginSchema, configuredModelSchema } from '@eden/api'
import type { RuntimeOrigin } from '@eden/api'
import type { RuntimeModel } from '@eden/runtime-pi'
import { configuredExternalCommandSandbox } from '@eden/execution'

export interface ServerConfig {
  origin: RuntimeOrigin
  host: '127.0.0.1'
  port: number
  dataRoot: string
  databasePath: string
  token: string
  allowedOrigins: string[]
  model: RuntimeModel | undefined
  monIdentity?: MonServiceIdentity | undefined
  maxBlobBytes?: number
  migrationReview?: boolean
  selection?: { filename: string; revision: string }
  externalCommandSandbox?: ReturnType<typeof configuredExternalCommandSandbox>
  systemSkillRoots?: string[]
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const origin = runtimeOriginSchema.parse(env.EDEN_AGENT_RUNTIME_ORIGIN ?? 'local')
  const migrationReview = z.enum(['0', '1']).parse(env.EDEN_AGENT_MIGRATION_REVIEW ?? '0') === '1'
  if (migrationReview && !env.EDEN_AGENT_V2_DATA_ROOT) throw new Error('Migration review requires an explicit staging data root')
  const defaultPort = (origin === 'mon' ? 40092 : 40093) + (migrationReview ? 100 : 0)
  const port = z.coerce.number().int().min(0).max(65535).parse(env.EDEN_AGENT_PORT ?? defaultPort)
  const dataRoot = path.resolve(env.EDEN_AGENT_V2_DATA_ROOT ?? path.join(cwd, 'Data', 'realms', origin, 'v2'))
  let selection: ServerConfig['selection'] = runtimeSelection(env, migrationReview)
  const token = capabilityToken(env)
  const allowedOrigins = (env.EDEN_AGENT_ALLOWED_ORIGINS ?? 'http://127.0.0.1:40091,http://localhost:40091,edenagent://app').split(',').map(value => value.trim()).filter(Boolean)
  return {
    origin, migrationReview, ...(selection ? { selection } : {}), host: '127.0.0.1', port, dataRoot, databasePath: path.join(dataRoot, migrationReview ? 'agent.sqlite' : 'eden-agent.db'), token,
    allowedOrigins, monIdentity: monServiceIdentity(origin, env), maxBlobBytes: z.coerce.number().int().min(1).max(1024 * 1024 * 1024).parse(env.EDEN_AGENT_MAX_BLOB_BYTES ?? 32 * 1024 * 1024),
    externalCommandSandbox: configuredExternalCommandSandbox(env, origin),
    systemSkillRoots: z.array(z.string().min(1).max(4096).refine(value => path.isAbsolute(value), 'System skill roots must be absolute')).max(16)
      .parse(JSON.parse(env[`EDEN_AGENT_${origin.toUpperCase()}_SYSTEM_SKILL_ROOTS`] ?? '[]')),
    model: origin === 'local' ? localModel(env) : undefined
  }
}

function capabilityToken(env: NodeJS.ProcessEnv) {
  const token = env.EDEN_AGENT_CAPABILITY_TOKEN ?? randomBytes(32).toString('base64url')
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error('Capability token must contain at least 32 URL-safe characters')
  return token
}

function runtimeSelection(env: NodeJS.ProcessEnv, migrationReview: boolean) {
  let selection: ServerConfig['selection']
  if (env.EDEN_AGENT_RUNTIME_SELECTION !== undefined || env.EDEN_AGENT_RUNTIME_SELECTION_REVISION !== undefined) {
    if (!env.EDEN_AGENT_RUNTIME_SELECTION || !path.isAbsolute(env.EDEN_AGENT_RUNTIME_SELECTION)) throw new Error('Runtime selection requires an absolute filename')
    selection = { filename: env.EDEN_AGENT_RUNTIME_SELECTION, revision: z.uuid().parse(env.EDEN_AGENT_RUNTIME_SELECTION_REVISION) }
    if (migrationReview) throw new Error('Migration review must use an explicit staging root without runtime selection')
  }
  return selection
}

function localModel(env: NodeJS.ProcessEnv): RuntimeModel | undefined {
  if (!env.EDEN_AGENT_MODEL) return undefined
  const [provider, ...parts] = env.EDEN_AGENT_MODEL.split('/')
  const id = parts.join('/')
  if (!provider || !id) throw new Error('EDEN_AGENT_MODEL must use provider/model')
  const apiKey = env[`${provider.toUpperCase().replaceAll('-', '_')}_API_KEY`]
  const baseUrl = env.EDEN_AGENT_BASE_URL ?? (provider === 'openai' ? env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1' : undefined)
  if (!baseUrl) throw new Error('Set EDEN_AGENT_BASE_URL explicitly for a non-OpenAI provider')
  return configuredModelSchema.parse({
    provider, id, baseUrl,
    contextWindow: z.coerce.number().int().positive().parse(env.EDEN_AGENT_CONTEXT_WINDOW ?? 32768),
    maxTokens: z.coerce.number().int().positive().parse(env.EDEN_AGENT_MAX_TOKENS ?? 4096),
    ...(env.EDEN_AGENT_MODEL_COST ? { cost: JSON.parse(env.EDEN_AGENT_MODEL_COST) } : {}),
    ...(apiKey ? { apiKey } : {}),
  })
}

export function persistToken(config: ServerConfig): void {
  mkdirSync(config.dataRoot, { recursive: true, mode: 0o700 })
  const temporary = path.join(config.dataRoot, `.capability-${randomBytes(8).toString('hex')}`)
  writeFileSync(temporary, config.token, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path.join(config.dataRoot, 'capability.token'))
}
