import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { realmEnvironment } from './runtime_children.mjs'

test('both realms retain the explicitly configured shared broker root without sharing model credentials', () => {
  const root = path.join(tmpdir(), 'eden-configured-broker')
  const base = { EDEN_AGENT_DESKTOP_BROKER_ROOT: root, EDEN_AGENT_MODEL: 'openai/fixture', OPENAI_API_KEY: 'fixture-local-secret' }
  const mon = realmEnvironment(base, 'mon', 'fixture-mon-token', 40192)
  const local = realmEnvironment(base, 'local', 'fixture-local-token', 40193)
  assert.equal(mon.EDEN_AGENT_DESKTOP_BROKER_ROOT, root)
  assert.equal(local.EDEN_AGENT_DESKTOP_BROKER_ROOT, root)
  assert.equal(mon.OPENAI_API_KEY, undefined)
  assert.equal(local.OPENAI_API_KEY, base.OPENAI_API_KEY)
})

test('an unspecified broker root keeps the current default rather than silently moving control state', () => {
  for (const origin of ['mon', 'local'])
    assert.equal(Object.hasOwn(realmEnvironment({}, origin, 'fixture-token', 40192), 'EDEN_AGENT_DESKTOP_BROKER_ROOT'), false)
})
