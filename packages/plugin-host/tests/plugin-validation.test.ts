import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { PluginService } from '../src/index.ts'

const manifest = { schemaVersion: 1, id: 'validation', name: 'Validation', description: 'Validates source', version: '1.0.0', entry: 'index.ts',
  tool: { name: 'validation', description: 'Test validation', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  permissions: [], tests: [{ input: {}, expected: 1 }],
}

test('source validation rejects type errors, private dependencies, compiler references and non-callable exports', async () => {
  const database = new EdenDatabase(':memory:', 'local')
  const plugins = new PluginService(database)
  try {
    let revision: string | undefined
    for (const [source, error] of [
      ['export default function() { const wrong: number = "text"; return wrong }', /not assignable/],
      ['import secret from "/private/secret"; export default () => secret', /only explicit node/],
      ['/// <reference path="/private/secret" />\nexport default () => 1', /reference directives/],
      ['export default 1', /must be callable/],
    ] as const) {
      revision = plugins.drafts.save(manifest, source, revision).draftRevision
      await assert.rejects(plugins.validate('validation'), error)
    }
    plugins.drafts.save(manifest, 'export default () => 1', revision)
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(plugins.validate('validation', abort.signal), /abort/i)
    assert.equal(plugins.versions.list().length, 0)
  } finally { plugins.close(); database.close() }
})
