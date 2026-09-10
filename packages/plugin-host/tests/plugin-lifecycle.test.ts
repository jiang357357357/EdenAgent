import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { probeHostExecution } from '@eden/execution'
import { PluginService } from '../src/index.ts'

function manifest(version = '1.0.0', read = false) {
  return { schemaVersion: 1, id: 'word-count', name: 'Word count', description: 'Counts words', version, entry: 'index.ts',
    tool: { name: 'word_count', description: 'Count words in text', parameters: { type: 'object', properties: { text: { type: 'string' }, ...(read ? { file: { type: 'string' } } : {}) }, required: read ? [] : ['text'], additionalProperties: false } },
    permissions: read ? [{ capability: 'workspace.read', description: 'Read a user-selected document' }] : [],
    tests: [{ input: { text: 'one two three' }, expected: { words: 3 } }],
  }
}
const source = `export default function(input: {text:string}) { return {words: input.text.trim().split(/\\s+/).length}; }`

test('draft, host tests, install, activation, restart, and rollback preserve revisions', async context => {
  const probe = await probeHostExecution()
  if (!probe.available) { context.skip('Requires host runtime'); return }
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-plugin-lifecycle-'))
  let database = new EdenDatabase(path.join(directory, 'state.db'), 'local')
  let plugins = new PluginService(database)
  try {
    plugins.drafts.save(manifest(), source)
    const report = await plugins.test('word-count')
    assert.equal(report.passed, true, JSON.stringify(report))
    await plugins.install('word-count', report.revision)
    await plugins.activate('word-count', report.revision)
    assert.deepEqual(await plugins.invoke('word-count', report.revision, { text: 'hello world' }), { words: 2 })
    database.close()
    database = new EdenDatabase(path.join(directory, 'state.db'), 'local')
    plugins = new PluginService(database)
    assert.deepEqual(await plugins.invoke('word-count', report.revision, { text: 'still works' }), { words: 2 })
    plugins.drafts.save(manifest('1.0.1'), source + '\n// Updated revision', plugins.drafts.read('word-count').draftRevision)
    const next = await plugins.test('word-count')
    await plugins.install('word-count', next.revision)
    await plugins.activate('word-count', next.revision)
    await assert.rejects(plugins.invoke('word-count', report.revision, { text: 'old' }), /not active/)
    await plugins.activate('word-count', report.revision)
    assert.deepEqual(await plugins.invoke('word-count', report.revision, { text: 'rolled back' }), { words: 2 })
  } finally { plugins.close(); database.close(); rmSync(directory, { recursive: true }) }
})

test('changed drafts and failed tests cannot replace the installed version', async context => {
  if (!(await probeHostExecution()).available) { context.skip('Requires host runtime'); return }
  const database = new EdenDatabase(':memory:', 'local')
  const plugins = new PluginService(database)
  try {
    plugins.drafts.save(manifest(), source)
    const first = await plugins.test('word-count')
    plugins.drafts.save(manifest(), 'export default () => ({words:0})', plugins.drafts.read('word-count').draftRevision)
    await assert.rejects(plugins.install('word-count', first.revision), /changed/)
    const failure = await plugins.test('word-count')
    assert.equal(failure.passed, false)
    await assert.rejects(plugins.install('word-count', failure.revision), /passing tests/)
    assert.equal(plugins.versions.list().length, 0)
  } finally { plugins.close(); database.close() }
})

test('workspace capability requires a user grant tied to revision', async context => {
  if (!(await probeHostExecution()).available) { context.skip('Requires host runtime'); return }
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-plugin-grant-'))
  const database = new EdenDatabase(':memory:', 'local')
  const plugins = new PluginService(database)
  const reader = `import fs from 'node:fs/promises';
    export default async function(input: {text:string,file?:string}, ctx: {workspaceRoot:string}) {
      const text = input.file ? await fs.readFile(ctx.workspaceRoot + '/' + input.file, 'utf8') : input.text;
      return {words: text.trim().split(/\\s+/).length};
    }`
  try {
    writeFileSync(path.join(directory, 'document.md'), 'one two three four')
    plugins.drafts.save(manifest('1.0.0', true), reader)
    const report = await plugins.test('word-count')
    await plugins.install('word-count', report.revision)
    await assert.rejects(plugins.activate('word-count', report.revision, directory), /authorization/)
    plugins.activations.grant('word-count', report.revision, directory, true)
    await plugins.activate('word-count', report.revision, directory)
    assert.deepEqual(await plugins.invoke('word-count', report.revision, { file: 'document.md' }), { words: 4 })
    plugins.drafts.save(manifest('1.0.1', true), reader + '\n// next', plugins.drafts.read('word-count').draftRevision)
    const next = await plugins.test('word-count')
    await plugins.install('word-count', next.revision)
    await assert.rejects(plugins.activate('word-count', next.revision, directory), /authorization/)
  } finally { plugins.close(); database.close(); rmSync(directory, { recursive: true }) }
})
