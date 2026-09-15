import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { discoverTestFiles } from './discover_tests.mjs'

test('discovers flat and nested test files in stable order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-test-discovery-'))
  try {
    await mkdir(path.join(root, 'tests', 'unit', 'mon'), { recursive: true })
    await writeFile(path.join(root, 'tests', 'root.test.ts'), '')
    await writeFile(path.join(root, 'tests', 'unit', 'mon', 'device-tools.test.ts'), '')
    await writeFile(path.join(root, 'tests', 'unit', 'mon', 'helper.ts'), '')

    const discovered = await discoverTestFiles(['tests'], root)
    assert.deepEqual(
      discovered.map(file => path.relative(root, file)),
      ['tests/root.test.ts', 'tests/unit/mon/device-tools.test.ts'],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the server test command uses recursive discovery', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.match(packageJson.scripts['test:server'], /Script\/Test\/run_typescript_tests\.mjs/u)
  assert.doesNotMatch(packageJson.scripts['test:server'], /Server\/tests\/\*\.test\.ts/u)
})

