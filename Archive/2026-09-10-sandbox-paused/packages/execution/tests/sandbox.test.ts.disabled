import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { probeSandbox, runIsolatedModule } from '../src/index.ts'

test('sandbox denies host secrets and writes while exposing only the read root', async context => {
  const probe = await probeSandbox()
  if (!probe.available) {
    await assert.rejects(runIsolatedModule({ moduleRoot: '/missing', input: {} }))
    context.diagnostic(`Real isolation unavailable on this platform: ${probe.detail}`)
    return
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-sandbox-'))
  const moduleRoot = path.join(directory, 'module')
  const readRoot = path.join(directory, 'read')
  mkdirSync(moduleRoot); mkdirSync(readRoot)
  const secret = path.join(directory, 'secret.txt')
  writeFileSync(secret, 'private')
  writeFileSync(path.join(readRoot, 'input.txt'), 'readable')
  writeFileSync(path.join(moduleRoot, 'index.mjs'), `
    import fs from 'node:fs/promises';
    export default async function(input) {
      let secretVisible = true, writeAllowed = true;
      try { await fs.readFile(input.secret); } catch { secretVisible = false; }
      try { await fs.writeFile('/workspace/input.txt', 'changed'); } catch { writeAllowed = false; }
      return { text: await fs.readFile('/workspace/input.txt', 'utf8'), secretVisible, writeAllowed, key: process.env.OPENAI_API_KEY ?? null };
    }`)
  try {
    const result = await runIsolatedModule({ moduleRoot, readRoot, input: { secret } })
    assert.equal(result.exitCode, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout).result, { text: 'readable', secretVisible: false, writeAllowed: false, key: null })
    assert.equal(readFileSync(path.join(readRoot, 'input.txt'), 'utf8'), 'readable')
  } finally { rmSync(directory, { recursive: true }) }
})

test('sandbox kills a plugin exceeding its wall-clock budget', async context => {
  const probe = await probeSandbox()
  if (!probe.available) { context.skip('No OS sandbox; refusal checked separately'); return }
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-timeout-'))
  try {
    writeFileSync(path.join(directory, 'index.mjs'), 'export default function() { while(true) {} }')
    await assert.rejects(runIsolatedModule({ moduleRoot: directory, input: {}, timeoutMs: 200 }), /time limit/)
  } finally { rmSync(directory, { recursive: true }) }
})

test('plugin cannot create child processes or allocate beyond its address-space limit', async context => {
  if (!(await probeSandbox()).available) { context.skip('No OS sandbox'); return }
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-resources-'))
  try {
    writeFileSync(path.join(directory, 'index.mjs'), `import {spawnSync} from 'node:child_process';
      export default function() { let denied = false; try { spawnSync('/bin/true'); } catch { denied = true; } return denied; }`)
    const subprocess = await runIsolatedModule({ moduleRoot: directory, input: {} })
    assert.equal(subprocess.exitCode, 0, subprocess.stderr)
    assert.equal(JSON.parse(subprocess.stdout).result, true)
    writeFileSync(path.join(directory, 'index.mjs'), 'export default function() { return Buffer.alloc(2 * 1024 * 1024 * 1024).length }')
    const allocation = await runIsolatedModule({ moduleRoot: directory, input: {} })
    assert.notEqual(allocation.exitCode, 0)
  } finally { rmSync(directory, { recursive: true }) }
})
