import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { recordedModel, callbacks } from '../../packages/runtime-pi/tests/recorded-model.ts'

test('bundled runtime resolves and executes its sibling process artifact from a relocated directory', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eden-process-artifact-'))
  const root = fileURLToPath(new URL('../../', import.meta.url))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
    await rm(directory, { recursive: true, force: true })
  })
  await build({ absWorkingDir: root, entryPoints: { facade: 'packages/runtime-pi/src/process-runtime.ts',
    'runtime-process': 'packages/runtime-pi/src/process-entry.ts' }, outdir: directory, outExtension: { '.js': '.mjs' },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', define: { EDEN_BUNDLED_SERVER: 'true' },
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    external: ['@earendil-works/*', 'ws', 'zod', 'typebox', 'esbuild'] })
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const { createIsolatedRuntime } = await import(pathToFileURL(path.join(directory, 'facade.mjs')).href)
  const model = await recordedModel([{ text: 'artifact works' }])
  t.after(() => model.close())
  const captured = callbacks()
  const runtime = createIsolatedRuntime({ sessionId: randomUUID(), model: model.config, systemPrompt: 'fixture', tools: [], callbacks: captured.handlers })
  try {
    await runtime.prompt('verify packaged child')
    assert.equal(model.requests.length, 1)
    assert.ok(captured.checkpoints.length > 0)
  } finally { await runtime.dispose() }
})
