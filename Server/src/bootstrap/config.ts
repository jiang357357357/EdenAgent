import { monServiceIdentity } from './mon-identity.ts'
import type { MonServiceIdentity } from '@eden/integrations'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { z } from 'zod'
import { runtimeOriginSchema, configuredModelSchema } from '@eden/api'
import type { RuntimeOrigin } from '@eden/api'
import type { RuntimeModel } from '@eden/runtime-pi'

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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const origin = runtimeOriginSchema.parse(env.EDEN_AGENT_RUNTIME_ORIGIN ?? 'local')
  const migrationReview = env.EDEN_AGENT_MIGRATION_REVIEW === '1'
  if (migrationReview && !env.EDEN_AGENT_V2_DATA_ROOT) throw new Error('Migration review requires an explicit staging data root')
  const port = z.coerce.number().int().min(0).max(65535).parse(env.EDEN_AGENT_PORT ?? (origin === 'mon' ? 40092 : 40093))
  const dataRoot = path.resolve(env.EDEN_AGENT_V2_DATA_ROOT ?? path.join(cwd, 'Data', 'realms', origin, 'v2'))
  const token = env.EDEN_AGENT_CAPABILITY_TOKEN ?? randomBytes(32).toString('base64url')
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error('Capability token must contain at least 32 URL-safe characters')
  const allowedOrigins = (env.EDEN_AGENT_ALLOWED_ORIGINS ?? 'http://127.0.0.1:40091,http://localhost:40091,edenagent://app').split(',').map(value => value.trim()).filter(Boolean)
  return { origin, migrationReview, host: '127.0.0.1', port, dataRoot, databasePath: path.join(dataRoot, migrationReview ? 'agent.sqlite' : 'eden-agent.db'), token,
    allowedOrigins, monIdentity: monServiceIdentity(origin, env), maxBlobBytes: z.coerce.number().int().min(1).max(1024 * 1024 * 1024).parse(env.EDEN_AGENT_MAX_BLOB_BYTES ?? 32 * 1024 * 1024),
    model: origin === 'local' ? localModel(env) : undefined }
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
