import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadConfig } from '../src/bootstrap/config.ts'
import { startServer } from '../src/bootstrap/container.ts'
import { EdenAgentRpcClient } from '../../frontend/web/src/generated/eden-agent-rpc.ts'

test('existing generated Web client initializes and consumes session events', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-generated-client-'))
  const config = loadConfig({ EDEN_AGENT_V2_DATA_ROOT: directory, EDEN_AGENT_PORT: '0' })
  const server = await startServer(config)
  const client = new EdenAgentRpcClient()
  try {
    const initialized = await client.connect(`ws://127.0.0.1:${server.port}/rpc`, config.token, 'migration-test', 'local')
    assert.equal(initialized.runtimeOrigin, 'local')
    const seen: string[] = []
    client.on('session.event', event => { seen.push(event.eventType) })
    const session = await client.request('session.create', { title: 'Generated client', participants: [] })
    const sessions = await client.request('session.list', { limit: 10, includeClosed: false })
    assert.equal(sessions[0]?.id, session.id)
    assert.ok(seen.includes('session.created'))
  } finally { client.close(); await server.close(); rmSync(directory, { recursive: true }) }
})
