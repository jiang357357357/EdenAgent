import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { constrainExtensionAuthor } from './extension-live-tools.mjs'

test('live author tool registration excludes desktop, terminal, messaging and agent delegation', () => {
  const names = ['read_file', 'manage_ui_plugins', 'desktop_click', 'cua_type_text', 'exec_command', 'send_external_email', 'spawn_agent']
  const host = { sessions: { tools: () => names.map(name => ({ name, execute: async () => null })) } }
  constrainExtensionAuthor(host, path.resolve('temporary-workspace'), 'test-plugin')
  assert.deepEqual(host.sessions.tools().map(tool => tool.name), ['read_file', 'manage_ui_plugins'])
})

test('resolved workspace tools cannot read outside the selected temporary directory', async () => {
  let executed = 0
  const definition = { name: 'read_file', execute: async () => { executed++; return 'ok' } }
  definition.resolveCall = input => ({ tool: definition, input })
  const workspace = path.resolve('temporary-workspace'), host = { sessions: { tools: () => [definition] } }
  constrainExtensionAuthor(host, workspace, 'test-plugin')
  const tool = host.sessions.tools()[0]
  const denied = tool.resolveCall({ path: '../outside.txt' })
  await assert.rejects(denied.tool.execute(denied.input, {}), /临时工作区/)
  assert.equal(executed, 0)
  const accepted = tool.resolveCall({ path: 'package/extension.js' })
  assert.equal(await accepted.tool.execute(accepted.input, {}), 'ok'); assert.equal(executed, 1)
})

test('forwarding and package installation cannot bypass the disposable test capability gate', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'eden-extension-gate-'))
  t.after(async () => { assert.equal(path.dirname(root), tmpdir()); await rm(root, { recursive: true, force: true }) })
  let executed = 0
  const manage = { name: 'manage_ui_plugins', execute: async () => { executed++; return {} } }
  const forward = { name: 'load_tools', resolveCall: input => ({ tool: { name: 'desktop_click' }, input }) }
  const host = { sessions: { tools: () => [manage, forward] } }
  constrainExtensionAuthor(host, root, 'test-plugin')
  assert.throws(() => host.sessions.tools().find(tool => tool.name === 'load_tools').resolveCall({}), /未开放/)
  await mkdir(path.join(root, 'package'))
  await writeFile(path.join(root, 'package/plugin.json'), JSON.stringify({ id: 'test-plugin', components: { runtimes: [{ kind: 'mcp_stdio' }] } }))
  await assert.rejects(host.sessions.tools()[0].execute({ action: 'install', id: 'test-plugin' }, {}), /后台进程/)
  assert.equal(executed, 0)
})
