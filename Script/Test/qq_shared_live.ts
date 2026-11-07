import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { qqSharedMessageSchema } from '@eden/api'
import type { RuntimeModel } from '@eden/runtime-pi'
import { SessionRepository, SessionService } from '../../Server/src/modules/sessions/index.ts'
import { withAccount, accountKey } from '../../Server/src/modules/accounts/index.ts'
import { QqSharedRepository } from '../../Server/src/modules/qq-channel/shared-repository.ts'
import { QqSharedBridge } from '../../Server/src/modules/qq-channel/shared-bridge.ts'
import type { MonBindingService } from '../../Server/src/modules/mon/index.ts'

function connection(): RuntimeModel {
  const accounts = path.resolve('Data/realms/mon/accounts')
  const selected = readdirSync(accounts).find(name => name.startsWith('f84d1e941b8c'))
  if (!selected) throw new Error('Previously selected provider configuration is unavailable')
  const source = new DatabaseSync(path.join(accounts, selected, 'storage/eden-agent.db'), { readOnly: true })
  try {
    source.exec('PRAGMA query_only=ON')
    for (const row of source.prepare('SELECT snapshot_json FROM model_bindings ORDER BY rowid DESC').all()) {
      const model = JSON.parse(String(row.snapshot_json)).main?.model as RuntimeModel | undefined
      if (model?.provider === 'deepseek' && model.id === 'deepseek-flash' && model.apiKey
        && new URL(model.baseUrl).origin === 'https://api.deepseek.com')
        return { ...model, reasoning: 'off', maxTokens: 128, sampling: { temperature: 0 } }
    }
    throw new Error('Verified official DeepSeek Flash connection is unavailable')
  } finally { source.close() }
}

const model = connection(), database = new EdenDatabase(':memory:', 'mon')
const identity = { userId: '7', coreBaseUrl: 'https://synthetic.invalid', secret: 'synthetic-local-only' }
const account = { key: accountKey(identity.coreBaseUrl, '7'), userId: '7', coreBaseUrl: identity.coreBaseUrl }
const repository = new SessionRepository(database, 'mon')
const session = withAccount(account, () => repository.create('Synthetic shared group cache check', [{ assistantId: 1, characterId: 2,
  profile: { character: { name: 'Alice', system_prompt: 'You are a public group helper. Answer briefly in Chinese using the public budget.' } } }],
  { sourceChannel: 'qq', channelAudience: 'qq_group', botQq: '100001', groupQq: '300001', locale: 'zh-CN', timezone: 'Asia/Shanghai' },
  { purpose: 'user_chat', sourceChannel: 'qq' }))
new QqSharedRepository(database).bind(session.id, '100001', '300001')
new QqSharedRepository(database).ingest(session.id, [qqSharedMessageSchema.parse({ source_key: 'synthetic-background', sequence: 1,
  message_id: 'public-budget', role: 'user', sender_qq: '200003', sender_name: 'C', sender_permission: 'allowed', timestamp: '2026-11-06T00:00:00Z',
  content: 'Public project budget: 500 yuan. ' + Array.from({ length: 35 }, (_, i) => `Public note ${i}: the group is planning a simple picnic; keep spending within the shared budget, choose ordinary food and leave some funds for water.`).join('\n') })])
const sessions = new SessionService(repository, model)
const mon = { catalog: async () => { throw new Error('Unexpected external Core access') } } as unknown as MonBindingService
const bridge = new QqSharedBridge(identity, database, sessions, mon, new AbortController().signal)
try {
  const results = []
  for (const [index, operator] of ['200001', '200002', '200001'].entries()) {
    const sequence = index + 2
    const accepted = await bridge.submit({ user_id: '7', bot_qq: '100001', group_qq: '300001', contact_qq: operator,
      assistant_id: 1, character_id: 2, schema_version: 'qq-group-turn.v5', message_id: `live-${sequence}`,
      text: ['预算是多少？给一句野餐建议。', '沿用刚才的预算，留多少买水合适？', '请概括刚才两位的计划。'][index],
      context: { schema_version: 'qq-group-shared.v1', bot_qq: '100001', group_qq: '300001', operator_qq: operator,
        speaker_name: operator === '200001' ? 'A' : 'B', speaker_permission: operator === '200001' ? 'super_admin' : 'allowed',
        source_key: `synthetic-${sequence}`, sequence, previous_source_key: index ? `synthetic-${sequence - 1}` : null, messages: [] } }) as { input_id: string; turn_id: string }
    await sessions.waitForIdle(session.id)
    const state = database.connection.prepare('SELECT state FROM inputs WHERE id=?').get(accepted.input_id)?.state
    assert.equal(state, 'completed')
    const response = database.connection.prepare("SELECT payload_json FROM events WHERE turn_id=? AND kind='model.response' ORDER BY seq DESC LIMIT 1").get(accepted.turn_id)
    const value = JSON.parse(String(response?.payload_json))
    assert.equal(value.errorMessage, null)
    results.push({ speaker: index === 1 ? 'B' : 'A', state, usage: value.usage,
      commonPrefixMessages: value.contextEstimate?.commonPrefixMessageCount, stopReason: value.stopReason })
    process.stdout.write(JSON.stringify(results.at(-1)) + '\n')
  }
  const requests = database.connection.prepare("SELECT payload_json FROM events WHERE kind='model.request' ORDER BY seq").all().map(row => JSON.parse(String(row.payload_json)))
  for (let index = 1; index < requests.length; index++) {
    assert.deepEqual(requests[index].payload.messages.slice(0, requests[index - 1].payload.messages.length), requests[index - 1].payload.messages)
    assert.deepEqual(requests[index].payload.tools, requests[index - 1].payload.tools)
  }
  assert.equal(requests.length, 3)
  const report = { provider: model.provider, model: model.id, syntheticData: true, liveQqMessages: 0,
    stablePreviousPrefixes: true, results, cacheReadTotal: results.reduce((sum, item) => sum + (item.usage?.cacheRead ?? 0), 0) }
  mkdirSync('.run/logs', { recursive: true })
  writeFileSync('.run/logs/qq-shared-live.json', JSON.stringify(report, null, 2) + '\n')
} finally { await bridge.close(); await sessions.close(); database.close() }
