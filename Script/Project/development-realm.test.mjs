import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolveDevelopmentRealm, assertDevelopmentPortAvailable } from './development-realm.mjs'
import { developmentHost } from './test-fixtures/development-host.mjs'

async function fixture(context) {
  const host = await developmentHost()
  context.after(() => host.close())
  return host
}

test('a compatible externally owned realm keeps its token and accepts only a read-only capability upgrade', async context => {
  const host = await fixture(context)
  const realm = await resolveDevelopmentRealm(host.options)
  assert.equal(realm.owned, false)
  assert.equal(realm.token, host.token)
  assert.equal(realm.tokenFile, host.tokenFile)
  assert.equal(await readFile(host.tokenFile, 'utf8'), host.token)
  assert.equal(host.state.upgrades, 1)
  assert.equal(host.state.rpcMessages, 0, 'A probe must not initialize an account or invoke RPC')
  assert.equal(await (await fetch(`http://127.0.0.1:${host.port}/probe`)).text(), 'alive')
})

for (const [field, value] of [['workspaceId', 'b'.repeat(64)], ['runtimeOrigin', 'local'], ['serverVersion', 'old']]) {
  test(`a ${field} mismatch refuses reuse before sending the capability and preserves the listener`, async context => {
    const host = await fixture(context)
    host.state.health[field] = value
    await assert.rejects(resolveDevelopmentRealm(host.options), /工作区不匹配/)
    assert.equal(host.state.upgrades, 0)
    assert.equal(await (await fetch(`http://127.0.0.1:${host.port}/probe`)).text(), 'alive')
  })
}

test('missing and wrong tokens fail without rotating a running host token or leaking it into diagnostics', async context => {
  const host = await fixture(context)
  await rm(host.tokenFile)
  await assert.rejects(resolveDevelopmentRealm(host.options), /令牌文件/)
  assert.equal(host.state.upgrades, 0)
  const wrong = 'other_fixture_capability_'.padEnd(43, 'y')
  await writeFile(host.tokenFile, wrong)
  await assert.rejects(resolveDevelopmentRealm(host.options), error => {
    assert.match(error.message, /不接受/)
    assert.equal(error.message.includes(wrong), false)
    return true
  })
  assert.equal(await readFile(host.tokenFile, 'utf8'), wrong)
  assert.equal(await (await fetch(`http://127.0.0.1:${host.port}/probe`)).text(), 'alive')
})

test('a stalled occupied port is preserved instead of being taken over', async context => {
  const host = await fixture(context)
  host.state.stall = true
  await assert.rejects(resolveDevelopmentRealm({ ...host.options, timeoutMs: 100 }), /端口.*未停止现有进程/)
  assert.equal(await (await fetch(`http://127.0.0.1:${host.port}/probe`)).text(), 'alive')
  await assert.rejects(assertDevelopmentPortAvailable(host.port, 'Web'), /已被占用/)
})

test('an unused port admits a new owned realm without writing a token or touching data', async context => {
  const host = await fixture(context)
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const realm = await resolveDevelopmentRealm({ ...host.options, port })
  assert.equal(realm.owned, true)
  assert.match(realm.token, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(realm.token, host.token)
  assert.equal(await readFile(host.tokenFile, 'utf8'), host.token)
})
