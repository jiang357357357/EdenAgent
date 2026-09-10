import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { copyConnectorResources } from './connector_resources.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'eden-connector-distribution-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'dist/connectors/weather.custom')
  await mkdir(source, { recursive: true })
  const files = { 'connector.json': JSON.stringify({ id: 'weather.custom', version: '1', runtime: 'node', entrypoints: { node: { path: 'worker.mjs' } } }),
    'worker.mjs': 'process.exit(0)\n' }
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(source, name), bytes)
  await writeFile(path.join(source, 'checksums.json'), JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]))))
  return { root, source, output: path.join(root, 'distribution') }
}
test('distribution discovers an arbitrary package name and uses the portable Node entrypoint', async t => {
  const f = await fixture(t), packages = await copyConnectorResources(f.root, f.output)
  assert.deepEqual(packages.map(item => ({ id: item.id, entry: item.entry })), [{ id: 'weather.custom', entry: 'worker.mjs' }])
  assert.equal(await readFile(path.join(f.output, 'connectors/weather.custom/worker.mjs'), 'utf8'), 'process.exit(0)\n')
})
test('distribution refuses connector bytes that no longer match their package inventory', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.source, 'worker.mjs'), 'changed')
  await assert.rejects(copyConnectorResources(f.root, f.output), /checksum mismatch/)
})
