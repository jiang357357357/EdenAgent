import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EdenDatabase } from '@eden/store'
import { SkillRepository, SkillService, SystemSkillCatalog } from '../src/modules/skills/index.ts'

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-catalog-test-'))
  const db = new EdenDatabase(':memory:', 'local')
  const first = path.join(root, 'first'), second = path.join(root, 'second')
  await mkdir(first); await mkdir(second)
  let workspace = first
  const catalog = new SystemSkillCatalog(() => [path.join(workspace, '.agents/skills')], true)
  const repository = new SkillRepository(db, () => workspace, undefined, undefined, undefined, () => catalog.list())
  const service = new SkillService(repository, undefined, catalog)
  t.after(async () => { await service.close(); db.close(); await rm(root, { recursive: true, force: true }) })
  async function skill(project: string, name: string, body: string) {
    const directory = path.join(project, '.agents/skills', name)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Catalog regression\n---\n${body}`)
  }
  return { root, first, second, repository, service, skill, switch(project: string) { workspace = project } }
}

test('refresh publishes edits and removals, rejects stale revisions, and retains the last valid snapshot after a broken edit', async t => {
  const f = await fixture(t)
  await f.skill(f.first, 'sample', 'first body'); await f.service.refresh()
  const original = f.repository.read('sample')
  await f.skill(f.first, 'sample', 'second body'); await f.service.refresh()
  assert.match(f.repository.read('sample').content!, /second body/)
  assert.throws(() => f.repository.read('sample', true, { expectedContentHash: original.contentHash }), /changed/)
  await writeFile(path.join(f.first, '.agents/skills/sample/SKILL.md'), '---\nunterminated')
  await assert.rejects(f.service.refresh(), /frontmatter/)
  assert.match(f.service.status().error!, /frontmatter/)
  assert.match(f.repository.read('sample').content!, /second body/)
  await rm(path.join(f.first, '.agents/skills/sample'), { recursive: true }); await f.service.refresh()
  assert.deepEqual(f.repository.list(), []); assert.equal(f.service.status().error, null)
})

test('workspace switch immediately invalidates discovery and persists enablement per workspace', async t => {
  const f = await fixture(t)
  await f.skill(f.first, 'shared', 'first'); await f.skill(f.second, 'shared', 'second')
  await f.service.refresh(); f.repository.enable('shared', false)
  assert.throws(() => f.repository.uninstall('shared'), /Discovered/)
  f.switch(f.second)
  assert.deepEqual(f.repository.list(), [])
  await f.service.refresh(); assert.equal(f.repository.read('shared').enabled, true)
  assert.match(f.repository.read('shared').content!, /second/)
  f.switch(f.first); await f.service.refresh(); assert.equal(f.repository.read('shared').enabled, false)
})

test('workspace discovery rejects symlink packages without publishing partial contents', async t => {
  const f = await fixture(t)
  await f.skill(f.first, 'safe', 'safe'); await f.service.refresh()
  await symlink(f.second, path.join(f.first, '.agents/skills/redirect'), 'dir')
  await assert.rejects(f.service.refresh(), /redirected/)
  assert.deepEqual(f.repository.list().map(skill => skill.name), ['safe'])
})
