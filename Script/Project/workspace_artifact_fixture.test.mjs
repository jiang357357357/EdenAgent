import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { copyArtifactRuntime } from './workspace_artifact_fixture.mjs'

test('a candidate artifact without runtime dependencies cannot borrow them from the source workspace', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'eden-artifact-missing-deps-'))
  context.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('eden-artifact-missing-deps-'))
    await rm(root, { recursive: true, force: true })
  })
  const entry = path.join(root, 'runtime', 'agent', 'server', 'main.mjs')
  const copied = path.join(root, 'copied')
  await mkdir(path.dirname(entry), { recursive: true })
  await writeFile(entry, '// incomplete candidate fixture')
  await assert.rejects(copyArtifactRuntime(entry, copied), /Missing runtime dependencies/)
  assert.equal(existsSync(copied), false)
})
