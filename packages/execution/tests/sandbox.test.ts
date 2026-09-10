import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { probeSandbox, runHostModule, configuredExternalCommandSandbox, ExternalCommandSandbox } from '../src/index.ts'

test('sandbox remains disabled even when a legacy external adapter is configured', async () => {
  assert.equal((await probeSandbox()).available, false)
  assert.equal(configuredExternalCommandSandbox({ EDEN_AGENT_EXTERNAL_SANDBOX: '/missing' }, 'local'), undefined)
  const external = new ExternalCommandSandbox('/missing', '0'.repeat(64))
  assert.equal((await external.probe()).available, false)
  assert.throws(() => external.program('/tmp', '/tmp', ['node']), /开发者审阅/)
})

test('host module accesses external files, writes and child processes with an actual workspace path', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eden-host-module-'))
  const workspace = path.join(root, 'workspace'), moduleRoot = path.join(root, 'module')
  mkdirSync(workspace); mkdirSync(moduleRoot)
  const outside = path.join(root, 'outside.txt')
  writeFileSync(outside, 'fixture')
  writeFileSync(path.join(moduleRoot, 'index.mjs'), `import fs from 'node:fs'; import {spawnSync} from 'node:child_process';
    export default function(input, context) {
      const before = fs.readFileSync(input.outside, 'utf8'); fs.writeFileSync(input.outside, 'updated');
      const child = spawnSync(process.execPath, ['-e', 'process.stdout.write("child-ok")'], {encoding:'utf8'});
      return {before, cwd:process.cwd(), workspace:context.workspaceRoot, child:child.stdout, status:child.status};
    }`)
  try {
    const result = await runHostModule({ moduleRoot, readRoot: workspace, input: { outside } })
    assert.equal(result.exitCode, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout).result, { before: 'fixture', cwd: workspace, workspace, child: 'child-ok', status: 0 })
    assert.equal(readFileSync(outside, 'utf8'), 'updated')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('host plugin timeout and cancellation remain effective', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eden-host-timeout-'))
  try {
    writeFileSync(path.join(root, 'index.mjs'), 'export default function() { while(true) {} }')
    await assert.rejects(runHostModule({ moduleRoot: root, input: {}, timeoutMs: 250 }), /time limit/)
    const abort = new AbortController()
    const task = runHostModule({ moduleRoot: root, input: {}, signal: abort.signal })
    abort.abort()
    await assert.rejects(task, /cancelled/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('host plugin can use network directly without a sandbox network grant', async () => {
  const { createServer } = await import('node:http')
  const server = createServer((_request, response) => response.end('network-ok'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const root = mkdtempSync(path.join(tmpdir(), 'eden-host-network-'))
  try {
    writeFileSync(path.join(root, 'index.mjs'), 'export default async function(input) { return await (await fetch(input.url)).text() }')
    const result = await runHostModule({ moduleRoot: root, input: { url: `http://127.0.0.1:${address.port}` } })
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).result, 'network-ok')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})
